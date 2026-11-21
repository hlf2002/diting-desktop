/**
 * Embedded RSSHub engine — lets the desktop client fetch feeds itself instead of requiring a
 * user-installed RSSHub on 127.0.0.1:1200.
 *
 * Responsibilities:
 * - resolve and load the vendored RSSHub package (`dist-lib/pkg.mjs`, produced by `npm run build:lib`)
 * - keep an Obscura CDP browser alive for `features.requirePuppeteer` routes
 * - expose `fetchRouteXml` / `fetchRouteData` to the worker and future renderer-facing IPC
 *
 * The module deliberately does not import electron, so it stays testable from plain Node.
 */

import type { ChildProcess } from "node:child_process"
import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { pathToFileURL } from "node:url"

import { join } from "pathe"

const DEFAULT_OBSCURA_PORT = 9223
const OBSCURA_START_TIMEOUT_MS = 15_000
const OBSCURA_PROBE_TIMEOUT_MS = 1_000

export interface RSSHubEngineOptions {
  /** Directory holding `pkg.mjs` and the route chunks (usually `<pkg>/dist-lib`). */
  distDir?: string
  /** Obscura binary path; discovered from known locations when omitted. */
  obscuraBinary?: string
  obscuraPort?: number
  /** Extra config forwarded to RSSHub `init()` (login cookies, UA, …). */
  config?: Record<string, unknown>
  log?: (message: string) => void
}

interface RSSHubPackage {
  init: (config?: Record<string, unknown>) => Promise<void>
  request: (path: string) => Promise<unknown>
  requestXml: (path: string) => Promise<string>
}

let options: RSSHubEngineOptions = {}
let rsshubPromise: Promise<RSSHubPackage> | null = null
let obscuraProcess: ChildProcess | null = null
let obscuraPort = DEFAULT_OBSCURA_PORT

function log(message: string): void {
  const sink = options.log ?? ((line: string) => console.info(line))
  sink(`[rsshub-engine] ${message}`)
}

/** `rsshub://weibo/user/123` and `/weibo/user/123` are both accepted. */
function normalizeRoute(route: string): string {
  const trimmed = route.trim()
  if (!trimmed) {
    throw new Error("[rsshub-engine] empty route")
  }
  return trimmed.startsWith("rsshub://") ? `/${trimmed.slice("rsshub://".length)}` : trimmed
}

/** Packaged resources directory name for the vendored RSSHub runtime. */
const RUNTIME_DIR_NAME = "rsshub-runtime"

/** Electron exposes `process.resourcesPath`; plain Node (tests) does not. */
function bundledRuntimeDir(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  return resourcesPath ? join(resourcesPath, RUNTIME_DIR_NAME) : null
}

function resolveDistDir(): string {
  const bundled = bundledRuntimeDir()
  const candidates = [
    options.distDir,
    process.env.DITING_RSSHUB_DIST,
    bundled ? join(bundled, "dist-lib") : "",
    join(homedir(), "rsshub-app", "dist-lib"),
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(join(candidate, "pkg.mjs"))) {
      return candidate
    }
  }

  throw new Error(
    `[rsshub-engine] cannot find RSSHub package; looked for pkg.mjs in: ${candidates.filter(Boolean).join(", ")}. ` +
      `Run "npm run build:lib" in the RSSHub checkout, or set DITING_RSSHUB_DIST.`,
  )
}

function resolveObscuraBinary(): string | null {
  const bundled = bundledRuntimeDir()
  const candidates = [
    options.obscuraBinary,
    process.env.DITING_OBSCURA_BIN,
    bundled ? join(bundled, "bin", "obscura") : "",
    join(homedir(), ".local", "bin", "obscura"),
    "/opt/homebrew/bin/obscura",
    "/usr/local/bin/obscura",
  ]

  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

async function isObscuraListening(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(OBSCURA_PROBE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

async function waitForObscura(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isObscuraListening(port)) {
      return true
    }
    await new Promise((done) => setTimeout(done, 250))
  }
  return false
}

/**
 * Ensures a CDP browser is reachable on `port`, spawning Obscura when nothing answers.
 * Returns false when no binary is available — RSSHub then falls back to its bundled Chromium
 * (or fails on browser routes), which must not abort engine startup.
 */
async function ensureObscura(): Promise<boolean> {
  if (await isObscuraListening(obscuraPort)) {
    log(`obscura already listening on ${obscuraPort}`)
    return true
  }

  const binary = resolveObscuraBinary()
  if (!binary) {
    log("obscura binary not found; browser routes will fall back to the bundled Chromium")
    return false
  }

  const child = spawn(binary, ["serve", "--port", String(obscuraPort), "--allow-private-network"], {
    stdio: ["ignore", "pipe", "pipe"],
  })
  obscuraProcess = child

  child.stdout?.on("data", (chunk: Buffer) => log(`obscura: ${chunk.toString().trimEnd()}`))
  child.stderr?.on("data", (chunk: Buffer) => log(`obscura(stderr): ${chunk.toString().trimEnd()}`))
  child.on("exit", (code, signal) => {
    log(`obscura exited code=${code ?? "null"} signal=${signal ?? "null"}`)
    if (obscuraProcess === child) {
      obscuraProcess = null
    }
  })

  const ready = await waitForObscura(obscuraPort, OBSCURA_START_TIMEOUT_MS)
  if (!ready) {
    log(`obscura did not answer on ${obscuraPort} within ${OBSCURA_START_TIMEOUT_MS}ms`)
    child.kill()
    obscuraProcess = null
    return false
  }

  log(`obscura started on ${obscuraPort} (pid ${child.pid ?? "unknown"})`)
  return true
}

async function loadRSSHubPackage(): Promise<RSSHubPackage> {
  const distDir = resolveDistDir()
  const entryFile = join(distDir, "pkg.mjs")

  // `pkg.mjs` imports '../assets/build/routes.js' — shipping dist-lib without it fails at load.
  const routesFile = join(distDir, "..", "assets", "build", "routes.js")
  if (!existsSync(routesFile)) {
    throw new Error(
      `[rsshub-engine] missing ${routesFile}; copy assets/build/routes.js next to ${distDir} ` +
        `(the generated route table is required by pkg.mjs).`,
    )
  }

  const browserReady = await ensureObscura()
  if (browserReady) {
    process.env.PLAYWRIGHT_CDP_ENDPOINT = `http://127.0.0.1:${obscuraPort}`
  }

  const mod = (await import(pathToFileURL(entryFile).href)) as RSSHubPackage
  if (typeof mod.init !== "function" || typeof mod.requestXml !== "function") {
    throw new TypeError(
      `[rsshub-engine] ${entryFile} does not export init/requestXml; rebuild with npm run build:lib`,
    )
  }

  await mod.init(options.config ?? {})
  log(`RSSHub engine ready (dist=${distDir})`)
  return mod
}

/** Idempotent; concurrent callers share one startup promise. */
export async function startRSSHubEngine(nextOptions: RSSHubEngineOptions = {}): Promise<void> {
  options = nextOptions
  obscuraPort =
    nextOptions.obscuraPort ?? Number(process.env.DITING_OBSCURA_PORT ?? DEFAULT_OBSCURA_PORT)
  if (Number.isNaN(obscuraPort) || obscuraPort <= 0) {
    throw new Error(
      `[rsshub-engine] invalid obscura port: ${nextOptions.obscuraPort ?? process.env.DITING_OBSCURA_PORT}`,
    )
  }

  rsshubPromise ??= loadRSSHubPackage()
  try {
    await rsshubPromise
  } catch (error) {
    // Allow a later call to retry after a failed start (e.g. dist rebuilt while the app was running).
    rsshubPromise = null
    throw error
  }
}

export function isRSSHubEngineReady(): boolean {
  return rsshubPromise !== null
}

async function requirePackage(): Promise<RSSHubPackage> {
  if (!rsshubPromise) {
    throw new Error("[rsshub-engine] engine not started; call startRSSHubEngine() first")
  }
  return rsshubPromise
}

/** Feed XML, matching what a user-installed RSSHub would return over HTTP. */
export async function fetchRouteXml(route: string): Promise<string> {
  const mod = await requirePackage()
  return mod.requestXml(normalizeRoute(route))
}

/** Feed JSON data object (`item[]` for entries), for renderer-friendly consumption. */
export async function fetchRouteData(route: string): Promise<unknown> {
  const mod = await requirePackage()
  return mod.request(normalizeRoute(route))
}

export async function stopRSSHubEngine(): Promise<void> {
  rsshubPromise = null

  if (obscuraProcess) {
    const child = obscuraProcess
    obscuraProcess = null
    child.kill()
    log("obscura stopped")
  }
}

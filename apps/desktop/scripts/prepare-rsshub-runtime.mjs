#!/usr/bin/env node
/**
 * Prepares `apps/desktop/rsshub-runtime`, the vendored RSSHub engine that ships inside the app.
 *
 * Layout produced (consumed by modules/rsshub-engine.ts via process.resourcesPath):
 *
 *   rsshub-runtime/
 *     dist-lib/                  pkg.mjs + route chunks (from `npm run build:lib`)
 *     assets/build/routes.js     route table pkg.mjs imports at runtime
 *     node_modules/              flattened production dependencies
 *     bin/obscura                CDP browser binary for the current platform
 *
 * Run this before `electron-forge make`; the directory is git-ignored and ~330MB.
 */

import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { arch, homedir, platform } from "node:os"
import { fileURLToPath } from "node:url"

import { dirname, join } from "pathe"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = join(scriptDir, "..")
const runtimeDir = join(appDir, "rsshub-runtime")

const rsshubDir = process.env.RSSHUB_SOURCE_DIR ?? join(homedir(), "rsshub-app")
const distLibDir = join(rsshubDir, "dist-lib")
const routesFile = join(rsshubDir, "assets", "build", "routes.js")

/**
 * Telemetry and build-time packages the client never executes.
 *
 * Keep this empty unless every excluded package is re-verified: RSSHub's registry chunk imports
 * `@opentelemetry/exporter-prometheus` statically, so trimming it breaks engine startup with
 * `ERR_MODULE_NOT_FOUND`. Trim only after a successful end-to-end fetch.
 */
const DROP_PACKAGES = []

/** Declared dependencies dropped from the install; same caveat as DROP_PACKAGES. */
const EXCLUDED_DEPENDENCIES = []

function obscuraBinaryName() {
  return platform() === "win32" ? "obscura.exe" : "obscura"
}

function obscuraCandidates() {
  const name = obscuraBinaryName()
  return [
    process.env.OBSCURA_BIN,
    join(homedir(), ".local", "bin", name),
    "/opt/homebrew/bin/obscura",
    "/usr/local/bin/obscura",
  ].filter((candidate) => Boolean(candidate))
}

async function main() {
  if (!existsSync(distLibDir)) {
    throw new Error(`${distLibDir} is missing — run "npm run build:lib" in ${rsshubDir} first.`)
  }
  if (!existsSync(routesFile)) {
    throw new Error(`${routesFile} is missing — "npm run build:lib" generates it as a side effect.`)
  }

  console.log(`[prepare-rsshub-runtime] source: ${rsshubDir}`)
  await rm(runtimeDir, { recursive: true, force: true })
  await mkdir(runtimeDir, { recursive: true })

  console.log("[prepare-rsshub-runtime] copying dist-lib …")
  await cp(distLibDir, join(runtimeDir, "dist-lib"), { recursive: true })

  await mkdir(join(runtimeDir, "assets", "build"), { recursive: true })
  await cp(routesFile, join(runtimeDir, "assets", "build", "routes.js"))
  console.log("[prepare-rsshub-runtime] copying assets/build/routes.js …")

  const rsshubPackageJson = JSON.parse(await readFile(join(rsshubDir, "package.json"), "utf8"))
  const dependencies = { ...(rsshubPackageJson.dependencies ?? {}) }
  for (const name of EXCLUDED_DEPENDENCIES) {
    delete dependencies[name]
  }
  await writeFile(
    join(runtimeDir, "package.json"),
    `${JSON.stringify({ name: "diting-rsshub-runtime", version: "1.0.0", private: true, type: "module", dependencies }, null, 2)}\n`,
  )

  console.log("[prepare-rsshub-runtime] installing production dependencies (npm, isolated) …")
  // npm, not pnpm: this directory lives inside the pnpm workspace, and `pnpm install` there
  // retargets the whole workspace (`Scope: all N workspace projects`), which prunes the parent
  // project's devDependencies. npm treats the directory as a standalone package.
  execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: runtimeDir,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
  })

  for (const pkg of DROP_PACKAGES) {
    const target = join(runtimeDir, "node_modules", pkg)
    if (existsSync(target)) {
      console.log(`[prepare-rsshub-runtime] dropping ${pkg}`)
      await rm(target, { recursive: true, force: true })
    }
  }

  const obscura = obscuraCandidates().find((candidate) => existsSync(candidate))
  if (!obscura) {
    throw new Error(
      `obscura binary not found for ${platform()}-${arch()} — set OBSCURA_BIN to its path.`,
    )
  }
  await mkdir(join(runtimeDir, "bin"), { recursive: true })
  await cp(obscura, join(runtimeDir, "bin", obscuraBinaryName()))
  console.log(`[prepare-rsshub-runtime] obscura: ${obscura}`)

  const size = execFileSync("du", ["-sh", runtimeDir], { encoding: "utf8" }).split("\t")[0]
  console.log(`[prepare-rsshub-runtime] ready: ${runtimeDir} (${size})`)
}

await main()

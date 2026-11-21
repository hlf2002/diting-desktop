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
import { arch, homedir, platform, tmpdir } from "node:os"
import { fileURLToPath } from "node:url"

import fg from "fast-glob"
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
  console.log(
    "[prepare-rsshub-runtime] installing production dependencies (pnpm, outside the workspace) …",
  )
  // Install in a temp dir **outside** the pnpm workspace: `pnpm install` under the workspace tree
  // retargets every workspace project and prunes the parent app's devDependencies. npm never
  // retargets, but its flat tree pulls ~90 extra packages (~219MB) that pnpm's production closure
  // does not ship, so pnpm is worth the extra copy step.
  const depDir = join(tmpdir(), `diting-rsshub-deps-${process.pid}`)
  await rm(depDir, { recursive: true, force: true })
  await mkdir(depDir, { recursive: true })
  await writeFile(
    join(depDir, "package.json"),
    `${JSON.stringify({ name: "diting-rsshub-deps", version: "1.0.0", private: true, type: "module", dependencies }, null, 2)}\n`,
  )
  // RSSHub depends on `difflib` via a git URL; pnpm's security default rejects exotic subdeps.
  // pnpm 12 reads settings from pnpm-workspace.yaml, not .npmrc, so declare a standalone workspace.
  await writeFile(join(depDir, "pnpm-workspace.yaml"), "packages: []\nblockExoticSubdeps: false\n")
  execFileSync(
    "pnpm",
    ["install", "--prod", "--node-linker=hoisted", "--ignore-scripts", "--no-frozen-lockfile"],
    {
      cwd: depDir,
      stdio: "inherit",
      env: { ...process.env, CI: "1" },
    },
  )
  console.log("[prepare-rsshub-runtime] copying node_modules …")
  await cp(join(depDir, "node_modules"), join(runtimeDir, "node_modules"), { recursive: true })
  await rm(depDir, { recursive: true, force: true })

  await writeFile(
    join(runtimeDir, "package.json"),
    `${JSON.stringify({ name: "diting-rsshub-runtime", version: "1.0.0", private: true, type: "module", dependencies }, null, 2)}\n`,
  )

  for (const pkg of DROP_PACKAGES) {
    const target = join(runtimeDir, "node_modules", pkg)
    if (existsSync(target)) {
      console.log(`[prepare-rsshub-runtime] dropping ${pkg}`)
      await rm(target, { recursive: true, force: true })
    }
  }

  // Runtime-only payload: type declarations, source maps and test/doc fixtures never execute.
  // Everything here is derived data, so dropping it cannot change runtime behaviour.
  console.log("[prepare-rsshub-runtime] pruning non-runtime files …")
  const nodeModulesDir = join(runtimeDir, "node_modules")
  const prunePatterns = [
    "**/*.d.ts",
    "**/*.d.mts",
    "**/*.d.cts",
    "**/*.map",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/docs/**",
    "**/example/**",
    "**/examples/**",
  ]
  const victims = await fg(prunePatterns, {
    cwd: nodeModulesDir,
    absolute: true,
    onlyFiles: false,
    dot: false,
  })
  for (const victim of victims) {
    await rm(victim, { recursive: true, force: true })
  }
  console.log(`[prepare-rsshub-runtime] pruned ${victims.length} entries`)

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

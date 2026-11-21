import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"

import { join } from "pathe"
import { afterEach, describe, expect, it } from "vitest"

import {
  fetchRouteXml,
  isRSSHubEngineReady,
  startRSSHubEngine,
  stopRSSHubEngine,
} from "./rsshub-engine"

afterEach(async () => {
  await stopRSSHubEngine()
})

describe("rsshub-engine", () => {
  it("rejects fetching before the engine is started", async () => {
    expect(isRSSHubEngineReady()).toBe(false)
    await expect(fetchRouteXml("/nasa/apod")).rejects.toThrow(/engine not started/)
  })

  it("fails with an actionable error when assets/build/routes.js is missing", async () => {
    const dir = join(tmpdir(), `rsshub-engine-test-${Date.now()}`)
    await mkdir(join(dir, "dist-lib"), { recursive: true })
    await writeFile(join(dir, "dist-lib", "pkg.mjs"), "export const init = () => {}\n")

    expect(existsSync(join(dir, "assets", "build", "routes.js"))).toBe(false)
    await expect(startRSSHubEngine({ distDir: join(dir, "dist-lib") })).rejects.toThrow(
      /missing .*routes\.js/,
    )
    expect(isRSSHubEngineReady()).toBe(false)
  })

  // Real end-to-end verification lives outside vitest: under NODE_ENV=test RSSHub's registry loads
  // route modules from the filesystem instead of the packaged route table, so a fetch here tests
  // the wrong code path. Verify with tsx instead (NODE_ENV=production):
  //   DITING_RSSHUB_DIST=<runtime>/dist-lib tsx -e 'await import("./rsshub-engine").then(async m => { await m.startRSSHubEngine(); console.log(await m.fetchRouteXml("/nasa/apod")) })'
})

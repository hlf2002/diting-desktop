import { app, protocol } from "electron"
import path from "pathe"

import { e2eUserDataDir } from "./env"

if (e2eUserDataDir) {
  app.setPath("userData", e2eUserDataDir)
} else if (import.meta.env.DEV) {
  app.setPath("userData", path.join(app.getPath("appData"), "Folo(dev)"))
}

// 本地调试：设置 FOLO_DEBUG_CDP=9222 即可开启远程调试端口，
// 并把渲染进程的 console 转发到主进程 stdout（方便排查白屏/点不动）。
if (process.env.FOLO_DEBUG_CDP) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.FOLO_DEBUG_CDP)

  app.on("web-contents-created", (_event, webContents) => {
    webContents.on("console-message", (...args: any[]) => {
      const detail = args[1]
      if (detail && typeof detail === "object" && "message" in detail) {
        console.log(`[renderer:${(detail as any).level}] ${(detail as any).message}`)
      } else {
        console.log(`[renderer:${args[1]}] ${args[2]} (${args[4]}:${args[3]})`)
      }
    })
    webContents.on("render-process-gone", (_e, details) => {
      console.error("[renderer-gone]", details)
    })
    webContents.on("preload-error", (_e, preloadPath, error) => {
      console.error("[preload-error]", preloadPath, error)
    })
  })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      bypassCSP: true,
      supportFetchAPI: true,
      secure: true,
    },
  },
])

import { bindings, defineConfig, triggers } from "cf/config"

// diting.7373.com.cn
const zone = "115ea8e6a7865dbfc1cf4530d5f87f63"

// Paths that the SSR Worker serves in front of the web app
const routePaths = [
  "/share/*",
  "/dist-external/*",
  "/og/*",
  "/login*",
  "/register*",
  "/forget-password*",
  "/reset-password*",
  "/feed/*",
  "/list/*",
  "/profile/*",
]

// `cf deploy --mode dev` deploys diting-ssr-dev on dev.diting.7373.com.cn. Any other mode deploys diting-ssr on
// diting.7373.com.cn. Run `pnpm run build:worker` (after the desktop `build:web`) before `cf build`: the
// entrypoint is the prebuilt dist/worker/worker-entry.mjs and the assets come from the desktop web
// build (see wrangler.config.ts).
export default defineConfig(({ mode }) => {
  const isDev = mode === "dev"
  const host = isDev ? "dev.diting.7373.com.cn" : "diting.7373.com.cn"

  return {
    accountId: "1f1d1678a2413a54c944b3081bab5c84",
    worker: {
      name: isDev ? "diting-ssr-dev" : "diting-ssr",
      compatibilityDate: "2026-02-01",
      compatibilityFlags: [
        "nodejs_compat",
        // The SSR Worker fetches api.diting.7373.com.cn, another Worker Route in the same zone.
        "global_fetch_strictly_public",
      ],
      entrypoint: "dist/worker/worker-entry.mjs",
      workersDev: true,
      placement: {
        mode: "smart",
      },
      limits: {
        cpuMs: 30000,
      },
      observability: {
        logs: {
          enabled: true,
          invocationLogs: true,
        },
        traces: {
          enabled: true,
        },
      },
      assets: {
        htmlHandling: "none",
        notFoundHandling: "none",
      },
      triggers: routePaths.map((path) => triggers.fetch({ pattern: `${host}${path}`, zone })),
      env: {
        VITE_API_URL: bindings.text(
          isDev ? "https://api.dev.diting.7373.com.cn" : "https://api.diting.7373.com.cn",
        ),
        VITE_WEB_URL: bindings.text(`https://${host}`),
        VITE_SENTRY_DSN: bindings.text(
          "https://e5bccf7428aa4e881ed5cb713fdff181@o4507542488023040.ingest.us.sentry.io/4507570439979008",
        ),
        FONTS_BUCKET: bindings.r2({
          name: "follow",
        }),
        ASSETS: bindings.assets(),
      },
    },
  }
})

import { session } from "electron"
import { ProxyAgent, setGlobalDispatcher } from "undici"

import { logger } from "../logger"
import { store } from "./store"

// Sets up the proxy configuration for the app.
//
// See https://www.electronjs.org/docs/latest/api/session#sessetproxyconfig
// for more information about the proxy API.
//
// The open-source project [poooi/poi](https://github.com/poooi/poi) is doing well in proxy configuration
// refer the following files for more details:
//
// https://github.com/poooi/poi/blob/5741d0d02c0a08626dd53196b094223457014491/lib/proxy.ts#L36
// https://github.com/poooi/poi/blob/5741d0d02c0a08626dd53196b094223457014491/views/components/settings/network/index.es

export const setProxyConfig = (inputProxy: string) => {
  const proxyUri = normalizeProxyUri(inputProxy)
  if (!proxyUri) {
    store.delete("proxy")
    return false
  }
  store.set("proxy", proxyUri)
  return true
}

export const getProxyConfig = () => {
  const proxyConfig = store.get("proxy")
  if (!proxyConfig) {
    return
  }
  const proxyUri = normalizeProxyUri(proxyConfig)
  return proxyUri
}

const URL_SCHEME = new Set(["http:", "https:", "ftp:", "socks:", "socks4:", "socks5:"])

const normalizeProxyUri = (userProxy: string) => {
  if (!userProxy) {
    return
  }
  // Only use the first proxy if there are multiple urls
  const firstInput = userProxy.split(",")[0]!

  try {
    const proxyUrl = new URL(firstInput)
    if (!URL_SCHEME.has(proxyUrl.protocol) || !proxyUrl.hostname) {
      return
    }
    // There are multiple ways to specify a proxy in Electron,
    // but for security reasons, we only support simple proxy URLs for now.
    return `${proxyUrl.protocol}//${proxyUrl.hostname}${proxyUrl.port ? `:${proxyUrl.port}` : ""}`
  } catch {
    return
  }
}

const BYPASS_RULES = ["<local>", "localhost", "127.0.0.1", "[::1]"].join(";")

export const updateProxy = () => {
  // 本地自建后端（http://localhost:3000）必须直连，不能走系统/环境代理，
  // 否则 Chromium 会把 localhost 请求也发给代理，导致 net::ERR_FAILED。
  // 因此：无显式代理配置时改为 direct（而非 system），并在有代理时始终绕过本机地址。
  const proxyUri =
    getProxyConfig() ?? normalizeProxyUri(process.env.HTTPS_PROXY || process.env.HTTP_PROXY || "")

  if (!proxyUri) {
    session.defaultSession.setProxy({
      mode: "direct",
    })
    return
  }
  const proxyRules = [
    proxyUri,
    // Failing over to using no proxy if the proxy is unavailable
    "direct://",
  ].join(",")

  logger.log(`Loading proxy: ${proxyRules}`)
  session.defaultSession.setProxy({
    proxyRules,
    proxyBypassRules: BYPASS_RULES,
  })

  // https://github.com/nodejs/undici/issues/2224
  // Error occurred in handler for 'setProxyConfig': InvalidArgumentError: Invalid URL protocol: the URL must start with `http:` or `https:`.
  const { protocol } = new URL(proxyUri)
  if (protocol !== "http:" && protocol !== "https:") {
    // undici doesn't support socks proxy
    logger.warn("undici only supports http and https proxy, skipping undici proxy setup")
    return
  }
  // The app's own requests go through `net.fetch` and follow the session proxy above. Node's
  // native fetch, still used by third-party code such as the readability package, knows
  // nothing about it, so an explicit proxy is handed to undici as well; the system proxy
  // cannot be, which is why those requests only follow a proxy set in the app.
  // Refer to https://stackoverflow.com/a/76503362/14676508
  const dispatcher = new ProxyAgent({ uri: new URL(proxyUri).toString() })
  setGlobalDispatcher(dispatcher)
}

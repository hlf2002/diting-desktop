/**
 * RSSHub 私有服务 token 管理
 *
 * 流程：
 * 1. 用户登录后，自动调 /better-auth/rsshub-token 拿 token
 * 2. token 存到 localStorage（7天有效期，和服务端一致）
 * 3. 拼 RSSHub 订阅链接时自动加 ?token=xxx
 */

import { env } from "@follow/shared/env.desktop"

const TOKEN_STORAGE_KEY = "diting:rsshub:token"

let cachedToken: string | null = null
let fetchPromise: Promise<string | null> | null = null

/** 从 localStorage 读 token */
function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return null
  }
}

/** 写 token 到 localStorage */
function storeToken(token: string) {
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
  } catch {
    // ignore
  }
}

/** 清除 token（登出时调） */
export function clearRSSHubToken() {
  cachedToken = null
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    // ignore
  }
}

/**
 * 从 diting-server 获取最新 token（带缓存和并发锁）
 * 未登录时返回 null，不抛错。
 */
export async function fetchRSSHubToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh && cachedToken) {
    return cachedToken
  }

  const stored = readStoredToken()
  if (!forceRefresh && stored) {
    cachedToken = stored
    return cachedToken
  }

  // 并发锁：多个调用同时发起时只请求一次
  if (fetchPromise) {
    return fetchPromise
  }

  fetchPromise = (async () => {
    try {
      const res = await fetch(`${env.VITE_API_URL}/better-auth/rsshub-token`, {
        credentials: "include",
        cache: "no-store",
      })

      if (!res.ok) {
        return null
      }

      const data = await res.json()
      if (data?.code === 0 && data?.token) {
        cachedToken = data.token
        storeToken(data.token)
        return cachedToken
      }
      return null
    } catch {
      return null
    } finally {
      // 清理锁，5 秒内不重复请求
      setTimeout(() => {
        fetchPromise = null
      }, 5_000)
    }
  })()

  return fetchPromise
}

/**
 * 给 RSSHub 订阅链接自动拼 token
 *
 * 用法：
 *   const url = withRSSHubToken("https://rsshub.7373.com.cn/weibo/user/123")
 *   // → https://rsshub.7373.com.cn/weibo/user/123?token=xxx
 *
 * 只对 rsshub.7373.com.cn 域名生效，其他 URL 原样返回。
 * 如果没拿到 token，也原样返回（会 401 但不影响开发调试）。
 */
export async function withRSSHubToken(url: string): Promise<string> {
  if (!url) return url

  // 只处理我们的私有 RSSHub 域名
  if (!url.includes("rsshub.7373.com.cn")) {
    return url
  }

  try {
    const token = await fetchRSSHubToken()
    if (!token) return url

    const u = new URL(url)
    u.searchParams.set("token", token)
    return u.toString()
  } catch {
    return url
  }
}

/**
 * 同步版本：如果 token 已缓存就直接用，否则返回原 URL。
 * 用于不需要异步等待的 UI 展示场景。
 */
export function withRSSHubTokenSync(url: string): string {
  if (!url || !url.includes("rsshub.7373.com.cn")) return url

  const token = cachedToken || readStoredToken()
  if (!token) return url

  try {
    const u = new URL(url)
    u.searchParams.set("token", token)
    return u.toString()
  } catch {
    return url
  }
}

import { env } from "@follow/shared/env.desktop"

import { apiFetch } from "./api-client"
import { setAuthSessionToken } from "./client-session"

/**
 * Q助理扫码登录（与后端 /api/auth/qzhuli/* 交互）。
 *
 * 流程：authorize 拿授权地址 -> 系统浏览器打开（Q助理 App 扫码）
 * -> 平台回调后端 -> 轮询 status 拿一次性 session token -> 建立本地登录态。
 */

export type QzhuliLoginPhase = "idle" | "starting" | "waiting" | "success" | "error"

export interface QzhuliLoginStatus {
  status: "pending" | "success" | "error" | "expired"
  error?: string
  token?: string
  user?: {
    id: string
    name: string | null
    image: string | null
    handle: string | null
  }
}

interface QzhuliApiEnvelope<T> {
  code: number
  message?: string
  data?: T
}

export const isElectronRuntime = () => typeof window !== "undefined" && !!window.electron

async function qzApiGet<T>(path: string): Promise<QzhuliApiEnvelope<T>> {
  const request = new Request(`${env.VITE_API_URL}${path}`, { cache: "no-store" })
  const res = await apiFetch(request)
  try {
    return (await res.json()) as QzhuliApiEnvelope<T>
  } catch {
    return { code: 1, message: `服务响应异常（HTTP ${res.status}）` }
  }
}

/** 发起登录：返回 { state, authorizeUrl } */
export async function qzhuliStartLogin(): Promise<{
  state: string
  authorizeUrl: string
}> {
  const mode = isElectronRuntime() ? "app" : "web"
  const result = await qzApiGet<{ state: string; authorizeUrl: string }>(
    `/api/auth/qzhuli/authorize?mode=${mode}`,
  )
  if (result.code !== 0 || !result.data?.state || !result.data?.authorizeUrl) {
    throw new Error(result.message || "无法发起 Q助理登录")
  }
  return result.data
}

/** 轮询登录结果 */
export async function qzhuliPollStatus(state: string): Promise<QzhuliLoginStatus> {
  const result = await qzApiGet<QzhuliLoginStatus>(
    `/api/auth/qzhuli/status?state=${encodeURIComponent(state)}`,
  )
  if (result.code !== 0 || !result.data) {
    return { status: "error", error: result.message || "查询登录状态失败" }
  }
  return result.data
}

/**
 * 登录成功后落地会话：
 * - Electron：把 token 存 localStorage（getAuthSessionToken），沿用既有刷新流程
 * - 浏览器：直接写 better-auth cookie 后刷新页面
 */
export function qzhuliCompleteLogin(token: string) {
  setAuthSessionToken(token)

  if (isElectronRuntime()) {
    // handleSessionChanges 会清理查询缓存并 reload
    void import("~/queries/auth").then(({ handleSessionChanges }) => handleSessionChanges())
    return
  }

  document.cookie = `better-auth.session_token=${token}; path=/; max-age=${60 * 60 * 24 * 30}`
  window.location.reload()
}

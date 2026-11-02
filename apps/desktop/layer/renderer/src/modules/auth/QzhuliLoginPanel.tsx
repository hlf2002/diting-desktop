import { MotionButtonBase } from "@follow/components/ui/button/index.js"
import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import type { QzhuliLoginPhase } from "~/lib/qzhuli-auth"
import { qzhuliCompleteLogin, qzhuliPollStatus, qzhuliStartLogin } from "~/lib/qzhuli-auth"

const POLL_INTERVAL = 1500

/** 把服务端错误码映射为可读文案 */
const useQzhuliErrorText = () => {
  const { t } = useTranslation(["app", "common"])
  return (kind: string | undefined, fallback: string) => {
    if (kind === "denied") return t("login.qzhuli.denied")
    if (kind === "state_invalid" || kind === "reused" || kind === "expired") {
      return t("login.qzhuli.expired")
    }
    if (kind === "server_error") return t("login.qzhuli.failed")
    return fallback
  }
}

/**
 * Q助理扫码登录面板。
 *
 * 授权页面由系统浏览器打开（Q助理 App 扫码确认），结果由客户端轮询后端获得；
 * 成功后写入 better-auth 会话 token 并刷新，即完成登录。
 */
export const QzhuliLoginPanel = () => {
  const { t } = useTranslation(["app", "common"])
  const errorText = useQzhuliErrorText()

  const [phase, setPhase] = useState<QzhuliLoginPhase>("idle")
  const [error, setError] = useState<string | null>(null)

  const pollRef = useRef<number | null>(null)
  const mountedRef = useRef(true)

  const stopPolling = () => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      stopPolling()
    }
  }, [])

  const start = async () => {
    setError(null)
    setPhase("starting")
    try {
      const { state, authorizeUrl } = await qzhuliStartLogin()

      // Electron 下 window.open(http/https) 会被主进程转交给系统浏览器打开
      window.open(authorizeUrl, "_blank")

      setPhase("waiting")
      stopPolling()
      pollRef.current = window.setInterval(async () => {
        try {
          const status = await qzhuliPollStatus(state)

          if (status.status === "success" && status.token) {
            stopPolling()
            if (!mountedRef.current) return
            setPhase("success")
            qzhuliCompleteLogin(status.token)
            return
          }

          if (status.status === "error" || status.status === "expired") {
            stopPolling()
            if (!mountedRef.current) return
            setPhase("error")
            setError(errorText(status.error, t("login.qzhuli.failed")))
          }
        } catch {
          // 网络抖动等瞬时失败：继续轮询，等待下一个周期
        }
      }, POLL_INTERVAL)
    } catch (e) {
      if (!mountedRef.current) return
      setPhase("error")
      setError(e instanceof Error ? e.message : t("login.qzhuli.failed"))
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      {/* 扫码占位视觉 */}
      <div className="relative flex size-36 items-center justify-center rounded-2xl border border-border bg-material-medium">
        <i className="i-mgc-qr-code-cute-re size-16 text-text-secondary" aria-hidden />
        {phase === "waiting" && (
          <span className="absolute inset-0 animate-pulse rounded-2xl bg-folo/5" />
        )}
      </div>

      {phase === "waiting" ? (
        <div className="flex items-center gap-2 text-sm text-text-secondary">
          <i className="i-mgc-loading-3-cute-re size-4 animate-spin" aria-hidden />
          <span>{t("login.qzhuli.waiting")}</span>
        </div>
      ) : phase === "success" ? (
        <div className="flex items-center gap-2 text-sm font-medium text-green-600">
          <i className="i-mgc-check-cute-re size-4" aria-hidden />
          <span>{t("login.qzhuli.success")}</span>
        </div>
      ) : (
        <p className="text-center text-sm leading-relaxed text-text-tertiary">
          {t("login.qzhuli.hint")}
        </p>
      )}

      {error && (
        <p className="text-center text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      {phase !== "success" && (
        <MotionButtonBase
          data-testid="login-provider-qzhuli"
          type="button"
          disabled={phase === "starting" || phase === "waiting"}
          onClick={() => void start()}
          className="center relative w-full gap-2 rounded-xl border border-border bg-material-medium py-3.5 pl-5 font-medium backdrop-blur-sm transition-colors duration-200 hover:border-folo/30 hover:bg-folo/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <i className="i-mgc-qr-code-cute-re pointer-events-none absolute left-7 size-5 text-text-secondary" />
          <span className="relative z-10">
            {phase === "waiting"
              ? t("login.qzhuli.waiting_button")
              : phase === "starting"
                ? t("login.qzhuli.starting")
                : t("login.qzhuli.action")}
          </span>
        </MotionButtonBase>
      )}
    </div>
  )
}

import { Spring } from "@follow/components/constants/spring.js"
import { useMobile } from "@follow/components/hooks/useMobile.js"
import { Logo } from "@follow/components/icons/logo.js"
import { IN_ELECTRON } from "@follow/shared"
import type { LoginRuntime } from "@follow/shared/auth"
import { stopPropagation } from "@follow/utils/dom"
import { m } from "motion/react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { useCurrentModal } from "~/components/ui/modal/stacked/hooks"
import { useSession } from "~/queries/auth"

import { QzhuliLoginPanel } from "./QzhuliLoginPanel"

interface LoginModalContentProps {
  runtime: LoginRuntime
  canClose?: boolean
}

/**
 * 登录弹窗：仅支持 Q助理扫码登录（邮箱密码 / 注册入口已移除）。
 */
export const LoginModalContent = (props: LoginModalContentProps) => {
  const modal = useCurrentModal()

  const { canClose = true } = props

  const { t } = useTranslation(["app", "common"])
  const { status } = useSession()

  const isMobile = useMobile()

  const handleOpenLegal = (type: "privacy" | "tos") => {
    const path = {
      privacy: "privacy-policy",
      tos: "terms-of-service",
    }

    window.open(`https://diting.7373.com.cn/${path[type]}`, "_blank")
  }

  useEffect(() => {
    if (status === "authenticated") {
      modal.dismiss()
    }
  }, [modal, status])

  const Inner = (
    <>
      {/* Header Section */}
      <div className="mb-6 flex flex-col items-center gap-3">
        <m.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={Spring.presets.smooth}
        >
          <Logo className="size-16" />
        </m.div>
        <m.div
          className="flex flex-col items-center gap-2"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={Spring.presets.smooth}
        >
          <h1 className="text-2xl font-semibold">{t("login.title")}</h1>
          <span className="text-sm text-text-tertiary">{t("login.qzhuli.subtitle")}</span>
        </m.div>
      </div>
      {!IN_ELECTRON && (
        <button
          type="button"
          aria-label={t("words.close", { ns: "common" })}
          className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-lg border-0 bg-transparent transition-colors hover:bg-fill/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
          onClick={modal.dismiss}
        >
          <i aria-hidden className="i-mgc-close-cute-re pointer-events-none size-4" />
        </button>
      )}

      <m.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={Spring.presets.smooth}
      >
        <QzhuliLoginPanel />
      </m.div>

      <div className="mt-6 text-center text-xs leading-relaxed text-text-tertiary">
        <span>{t("login.agree_to")} </span>
        <button
          type="button"
          onClick={() => handleOpenLegal("tos")}
          className="text-accent transition-colors hover:text-accent/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
        >
          {t("login.terms")}
        </button>
        <span> & </span>
        <button
          type="button"
          onClick={() => handleOpenLegal("privacy")}
          className="text-accent transition-colors hover:text-accent/80 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2"
        >
          {t("login.privacy")}
        </button>
      </div>
    </>
  )
  if (isMobile) {
    return Inner
  }

  return (
    <div className="center flex h-full" onClick={canClose ? modal.dismiss : undefined}>
      <m.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.95 }}
        transition={Spring.presets.smooth}
      >
        <div
          onClick={stopPropagation}
          tabIndex={-1}
          data-testid="login-modal"
          className="relative w-[28rem] overflow-hidden rounded-2xl border border-folo/20 bg-background p-6 shadow-2xl shadow-folo/10 backdrop-blur-xl"
        >
          {/* Inner glow layer */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 50% 0%, rgba(255, 92, 0, 0.08), transparent 60%)",
            }}
          />

          {/* Content */}
          <div className="relative">{Inner}</div>
        </div>
      </m.div>
    </div>
  )
}

import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipTrigger,
} from "@follow/components/ui/tooltip/index.js"
import dayjs from "dayjs"
import { useTranslation } from "react-i18next"

export function ErrorTooltip({
  errorAt,
  errorMessage,
  children,
  showWhenError = false,
  side = "top",
}: {
  errorMessage?: string | null
  errorAt?: string | null
  children: React.ReactNode
  showWhenError?: boolean
  side?: React.ComponentProps<typeof TooltipContent>["side"]
}) {
  const { t } = useTranslation()
  if (!errorAt || !errorMessage) {
    return showWhenError ? children : null
  }
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipPortal>
        <TooltipContent side={side}>
          <div className="flex items-center gap-1">
            <i className="i-mgc-time-cute-re" />
            {t("feed_item.error_since")}{" "}
            {dayjs.duration(dayjs(errorAt).diff(dayjs(), "minute"), "minute").humanize(true)}
          </div>
          {!!errorMessage && (
            <div className="flex items-center gap-1">
              <i className="i-mgc-bug-cute-re" />
              {errorMessage}
            </div>
          )}
        </TooltipContent>
      </TooltipPortal>
    </Tooltip>
  )
}

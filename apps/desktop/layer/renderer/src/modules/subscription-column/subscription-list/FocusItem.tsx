import { cn } from "@follow/utils"
import { memo } from "react"
import { useTranslation } from "react-i18next"

import focusIcon from "~/assets/focus-icon.svg"
import { ROUTE_VIEW_FOCUS } from "~/constants"
import { useNavigateEntry } from "~/hooks/biz/useNavigateEntry"
import { useRouteParamsSelector } from "~/hooks/biz/useRouteParams"

import { feedColumnStyles } from "../styles"

export const FocusItem = memo(() => {
  const timelineId = useRouteParamsSelector((s) => s.timelineId)
  const navigateEntry = useNavigateEntry()
  const { t } = useTranslation()

  return (
    <div
      data-sub={ROUTE_VIEW_FOCUS}
      data-active={timelineId === ROUTE_VIEW_FOCUS}
      className={cn(
        "mt-1 flex h-8 w-full shrink-0 cursor-menu items-center gap-2 rounded-md px-2.5",
        feedColumnStyles.item,
      )}
      onClick={(e) => {
        e.stopPropagation()
        navigateEntry({
          entryId: null,
          feedId: null,
          timelineId: ROUTE_VIEW_FOCUS,
        })
      }}
    >
      <img src={focusIcon} alt="" className="size-4 -translate-y-px" />
      {t("sidebar.timeline_tabs.focus")}
    </div>
  )
})
FocusItem.displayName = "FocusItem"

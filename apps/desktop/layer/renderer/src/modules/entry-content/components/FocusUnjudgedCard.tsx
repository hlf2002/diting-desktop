import { MotionButtonBase } from "@follow/components/ui/button/index.js"
import {
  useAnalyzedEntryIds,
  useFocusEntryIds,
  useUnjudgedEntryIds,
} from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"
import { useSettingModal } from "~/modules/settings/modal/useSettingModal"

/**
 * "未判定" placeholder card rendered at the END of the article body for entries
 * that arrived before the user configured focus criteria / BYOK provider.
 *
 * Renders ONLY for entries that are unjudged AND not analyzed AND not focus.
 * Clicking the card opens AI settings (tab="ai") so the user can configure
 * criteria/provider, after which a retro trigger re-analyzes this entry.
 */
export function FocusUnjudgedCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const analyzed = useAnalyzedEntryIds().has(entryId)
  const isFocus = useFocusEntryIds().has(entryId)
  const isUnjudged = useUnjudgedEntryIds().has(entryId)
  const openSettings = useSettingModal()

  if (analyzed || isFocus || !isUnjudged) return null

  const content = t("entry_content.focus_unjudged_hint")

  return (
    <MotionButtonBase
      type="button"
      onClick={() => openSettings("ai")}
      className="block w-full text-left"
    >
      <AISummaryCardBase
        className="my-8"
        title={t("entry_content.focus_unjudged")}
        content={content}
        showCopyButton={false}
        footerContent={
          <div className="mt-3 flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400">
            <span>{t("entry_content.focus_unjudged_cta")}</span>
            <i className="i-mgc-right-cute-re text-sm" />
          </div>
        }
      />
    </MotionButtonBase>
  )
}

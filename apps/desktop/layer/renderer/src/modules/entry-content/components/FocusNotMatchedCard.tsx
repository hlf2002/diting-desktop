import { useAnalyzedEntryIds, useFocusEntryIds, useFocusScore } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"
import { useSettingModal } from "~/modules/settings/modal/useSettingModal"

/**
 * "未进入重点关注" card rendered at the END of the article body: shows the
 * decision-model score for entries the AI analyzed but did NOT flag as focus.
 *
 * Only renders for analyzed, non-focus entries. Chat-model fallback rows carry
 * no numeric score — in that case the card still shows the verdict title with
 * a generic no-score copy so the "analyzed but not focus" state is always visible.
 */
export function FocusNotMatchedCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const analyzed = useAnalyzedEntryIds().has(entryId)
  const isFocus = useFocusEntryIds().has(entryId)
  const score = useFocusScore(entryId)
  const openSettings = useSettingModal()

  if (!analyzed || isFocus) return null

  const content =
    score != null
      ? t("entry_content.focus_score", { score: Math.round(score * 100) })
      : t("entry_content.focus_no_score")
  return (
    <AISummaryCardBase
      className="my-8"
      title={t("entry_content.focus_not_matched")}
      content={content}
      showCopyButton={false}
      footerContent={
        <button
          type="button"
          onClick={() => openSettings("ai")}
          className="mt-3 flex items-center gap-1 text-xs font-medium text-purple-600 dark:text-purple-400"
        >
          <i className="i-mgc-settings-7-cute-re text-base" />
          <span>{t("entry_content.focus_settings_cta")}</span>
        </button>
      }
    />
  )
}

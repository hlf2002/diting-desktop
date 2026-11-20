import { useAnalyzedEntryIds, useFocusEntryIds, useFocusScore } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"

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
    />
  )
}

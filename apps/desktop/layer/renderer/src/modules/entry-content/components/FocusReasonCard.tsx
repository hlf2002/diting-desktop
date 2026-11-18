import { useFocusEntryIds, useFocusReason } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"

/**
 * "重点关注" card rendered above the AI summary in the reader: shows why the
 * on-device AI flagged this entry as matching the user's focus criteria.
 *
 * A focus mark always carries a concrete reason (marks without one are dropped
 * by the analyzer), so there is no fallback copy — if there is no reason, the
 * card does not render.
 */
export function FocusReasonCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const isFocus = useFocusEntryIds().has(entryId)
  const reason = useFocusReason(entryId)

  if (!isFocus || !reason) return null

  return (
    <AISummaryCardBase
      className="my-8"
      title={t("entry_content.focus_reason")}
      content={reason}
      showCopyButton={false}
    />
  )
}

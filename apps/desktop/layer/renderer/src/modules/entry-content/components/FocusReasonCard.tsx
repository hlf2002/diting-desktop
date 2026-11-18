import { useFocusEntryIds, useFocusReason } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"

/**
 * "重点关注" card rendered above the AI summary in the reader: shows why the
 * on-device AI flagged this entry as matching the user's focus criteria.
 *
 * Only visible for entries with a focus mark; legacy marks scored before
 * reasons existed fall back to a generic message.
 */
export function FocusReasonCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const isFocus = useFocusEntryIds().has(entryId)
  const reason = useFocusReason(entryId)

  if (!isFocus) return null

  return (
    <AISummaryCardBase
      className="my-8"
      title={t("entry_content.focus_reason")}
      content={reason || t("entry_content.focus_reason_fallback")}
      showCopyButton={false}
    />
  )
}

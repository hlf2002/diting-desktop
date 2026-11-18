import { useFocusEntryIds, useFocusReason } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { getAISettings } from "~/atoms/settings/ai"
import { AISummaryCardBase } from "~/components/ui/ai-summary-card"
import { extractPlainText } from "~/modules/focus/focus-analyzer"

const CRITERIA_PREVIEW_LIMIT = 80

/**
 * "重点关注" card rendered above the AI summary in the reader: shows why the
 * on-device AI flagged this entry as matching the user's focus criteria.
 *
 * Only visible for entries with a focus mark; legacy marks scored before
 * reasons existed fall back to a preview of the user's own criteria (or a
 * generic message when no criteria are set).
 */
export function FocusReasonCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const isFocus = useFocusEntryIds().has(entryId)
  const reason = useFocusReason(entryId)

  if (!isFocus) return null

  const criteria = extractPlainText(getAISettings().personalizePrompt)
  const fallback = criteria
    ? t("entry_content.focus_reason_fallback", {
        criteria:
          criteria.length > CRITERIA_PREVIEW_LIMIT
            ? `${criteria.slice(0, CRITERIA_PREVIEW_LIMIT)}…`
            : criteria,
      })
    : t("entry_content.focus_reason_fallback_generic")

  return (
    <AISummaryCardBase
      className="my-8"
      title={t("entry_content.focus_reason")}
      content={reason || fallback}
      showCopyButton={false}
    />
  )
}

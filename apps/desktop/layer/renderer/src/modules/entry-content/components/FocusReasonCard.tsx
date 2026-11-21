import { useFocusEntryIds, useFocusReason, useFocusScore } from "@follow/store/focus/hooks"
import { useTranslation } from "react-i18next"

import { AISummaryCardBase } from "~/components/ui/ai-summary-card"
import { useSettingModal } from "~/modules/settings/modal/useSettingModal"

/**
 * "重点关注" card rendered above the AI summary in the reader: shows why the
 * on-device AI flagged this entry as matching the user's focus criteria.
 *
 * A focus mark always carries a concrete reason (marks without one are dropped
 * by the analyzer), so there is no fallback copy — if there is no reason, the
 * card does not render. When a decision-model score exists it is shown together
 * with the reason; chat-model fallback rows carry no numeric score.
 */
export function FocusReasonCard({ entryId }: { entryId: string }) {
  const { t } = useTranslation()
  const isFocus = useFocusEntryIds().has(entryId)
  const reason = useFocusReason(entryId)
  const score = useFocusScore(entryId)
  const openSettings = useSettingModal()

  if (!isFocus || !reason) return null

  // 决策数据与原因分开显示：评分行以句号收尾，再换行显示判断原因（否则两行
  // 贴在一起，复制或朗读时都分不清是两段内容）。
  const scoreLine =
    score != null ? `${t("entry_content.focus_score", { score: Math.round(score * 100) })}。\n` : ""
  return (
    <AISummaryCardBase
      className="my-8"
      title={t("entry_content.focus_reason")}
      content={`${scoreLine}${reason}`}
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

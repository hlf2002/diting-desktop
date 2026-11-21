import { Spring } from "@follow/components/constants/spring.js"
import { Button } from "@follow/components/ui/button/index.js"
import { LexicalRichEditorTextArea } from "@follow/components/ui/lexical-rich-editor/index.js"
import { useAtomValue, useSetAtom } from "jotai"
import { AnimatePresence } from "motion/react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { setAISetting, useAISettingValue } from "~/atoms/settings/ai"
import { m } from "~/components/common/Motion"
import { MentionPlugin } from "~/modules/ai-chat/editor"
import {
  focusFullReanalyzeTriggerAtom,
  focusReanalyzeProgressAtom,
  focusRetroAnalyzeTriggerAtom,
} from "~/modules/focus/useFocusAnalyzer"

import { SettingDescription } from "../../control"
import { SettingModalContentPortal } from "../../modal/layout"

// Kept outside the section, which unmounts on a tab switch or when Preferences closes,
// so an unsaved draft is still there when the user comes back
let unsavedDraft: string | null = null

export const PersonalizePromptSection = () => {
  const { t } = useTranslation("ai")
  const aiSettings = useAISettingValue()
  const setRetroTrigger = useSetAtom(focusRetroAnalyzeTriggerAtom)
  const setFullReanalyzeTrigger = useSetAtom(focusFullReanalyzeTriggerAtom)
  const reanalyzeProgress = useAtomValue(focusReanalyzeProgressAtom)
  const [initialValue] = useState(() => unsavedDraft ?? aiSettings.personalizePrompt)
  const promptRef = useRef(unsavedDraft ?? "")
  const [isSaving, setIsSaving] = useState(false)
  const [currentLength, setCurrentLength] = useState(0)
  const [hasChanges, setHasChanges] = useState(unsavedDraft !== null)

  const MAX_CHARACTERS = 500
  const isOverLimit = currentLength > MAX_CHARACTERS

  const handleEditorChange = (_value: string, textLength: number, textContent: string) => {
    // The editor also reports selection changes, and an empty editor serializes to a
    // non-empty state, so compare text when nothing is stored yet
    const storedPrompt = aiSettings.personalizePrompt
    // Store the plain text (not the Lexical serialized JSON) so the focus analyzer
    // and any other consumer receive the user's actual words.
    promptRef.current = textLength === 0 ? "" : textContent
    setCurrentLength(textLength)
    const changed = storedPrompt ? promptRef.current !== storedPrompt : textLength > 0
    setHasChanges(changed)
    unsavedDraft = changed ? promptRef.current : null
  }

  const handleSave = async () => {
    if (isOverLimit) {
      toast.error(t("prompt_editor.too_long", { max: MAX_CHARACTERS }))
      return
    }

    setIsSaving(true)
    try {
      const savedPrompt = promptRef.current
      setAISetting("personalizePrompt", savedPrompt)
      // Re-score the most recent entries so the change shows up in the
      // 重点关注 tab right away, not only when new entries arrive.
      // Fire on every save with a non-empty prompt (not only when the value
      // changed): the user clicking 保存 expects the backfill to run, and
      // opening the editor after a JSON->plain-text migration always looks
      // unchanged even though the stored value differs.
      if (savedPrompt) {
        setRetroTrigger((v) => v + 1)
      }
      toast.success(t("personalize.saved"))
      setHasChanges(false)
      unsavedDraft = null
    } finally {
      setIsSaving(false)
    }
  }

  const handleReanalyzeAll = () => {
    if (reanalyzeProgress.running) return
    setFullReanalyzeTrigger((v) => v + 1)
    toast.success(t("personalize.reanalyze_all_started"))
  }

  // Progress covers processed entries (scored + failed): a provider outage used
  // to freeze the bar at the last `done` percent while every batch kept failing.
  const reanalyzeProcessed = reanalyzeProgress.done + reanalyzeProgress.failed
  const reanalyzePercent =
    reanalyzeProgress.total > 0
      ? Math.min(100, Math.round((reanalyzeProcessed / reanalyzeProgress.total) * 100))
      : 0

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <SettingDescription className="w-full flex-1">
            {t("personalize.prompt.help")}
            {isOverLimit && (
              <span className="mt-1 block text-red">
                {t("prompt_editor.over_limit", { max: MAX_CHARACTERS })}
              </span>
            )}
          </SettingDescription>
          <Button
            size="sm"
            buttonClassName="shrink-0 whitespace-nowrap"
            disabled={reanalyzeProgress.running}
            onClick={handleReanalyzeAll}
          >
            {t("personalize.reanalyze_all_button")}
          </Button>
        </div>
        <div className="relative -ml-3">
          <LexicalRichEditorTextArea
            initialValue={initialValue}
            onValueChange={handleEditorChange}
            // Also reports the length of the text the editor opens with
            onLengthChange={setCurrentLength}
            plugins={[MentionPlugin]}
            namespace="PersonalizePromptEditor"
            placeholder={t("personalize.prompt.placeholder")}
            className={`min-h-[80px] resize-none text-sm ${
              isOverLimit ? "border-red focus:border-red" : ""
            }`}
          />
          <div
            className={`absolute bottom-2 right-2 text-xs ${
              isOverLimit
                ? "text-red"
                : currentLength > MAX_CHARACTERS * 0.8
                  ? "text-yellow"
                  : "text-text-tertiary"
            }`}
          >
            {currentLength}/{MAX_CHARACTERS}
          </div>
        </div>
        {reanalyzeProgress.total > 0 && (
          <div className="space-y-1 pt-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-fill-secondary">
              <div
                className={`h-full rounded-full transition-[width] duration-300 ease-out ${
                  reanalyzeProgress.running ? "bg-accent" : "bg-green"
                }`}
                style={{ width: `${reanalyzePercent}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <span>
                {reanalyzeProgress.running
                  ? t("personalize.reanalyze_progress", {
                      done: reanalyzeProgress.done.toLocaleString(),
                      total: reanalyzeProgress.total.toLocaleString(),
                    })
                  : t("personalize.reanalyze_done", {
                      done: reanalyzeProgress.done.toLocaleString(),
                      total: reanalyzeProgress.total.toLocaleString(),
                    })}
              </span>
              <span>
                {reanalyzePercent}%
                {reanalyzeProgress.failed > 0 &&
                  ` · ${t("personalize.reanalyze_failed", { count: reanalyzeProgress.failed })}`}
                {reanalyzeProgress.lastError && ` · ${reanalyzeProgress.lastError}`}
              </span>
            </div>
          </div>
        )}
      </div>

      <AnimatePresence>
        {hasChanges && (
          <SettingModalContentPortal>
            <m.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={Spring.presets.snappy}
              className="absolute inset-x-0 bottom-3 z-10 flex justify-center px-3"
            >
              <div
                className="relative overflow-hidden rounded-full backdrop-blur-2xl"
                style={{
                  backgroundImage:
                    "linear-gradient(to bottom right, rgba(var(--color-background) / 0.98), rgba(var(--color-background) / 0.95))",
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor: "hsl(var(--fo-a) / 0.2)",
                  boxShadow:
                    "0 8px 32px hsl(var(--fo-a) / 0.08), 0 4px 16px hsl(var(--fo-a) / 0.06), 0 2px 8px rgba(0, 0, 0, 0.1)",
                }}
              >
                {/* Inner glow layer */}
                <div
                  className="absolute inset-0 rounded-2xl"
                  style={{
                    background:
                      "linear-gradient(to bottom right, hsl(var(--fo-a) / 0.05), transparent, hsl(var(--fo-a) / 0.05))",
                  }}
                />

                {/* Content */}
                <div className="relative flex w-fit max-w-full items-center justify-between gap-3 px-5 py-3">
                  <span className="whitespace-nowrap text-xs text-text-secondary sm:text-sm">
                    {t("words.unsaved_changes", { ns: "common" })}
                  </span>
                  <Button
                    buttonClassName="bg-accent rounded-full"
                    size="sm"
                    onClick={handleSave}
                    disabled={isSaving || isOverLimit}
                  >
                    {isSaving ? t("prompt_editor.saving") : t("words.save", { ns: "common" })}
                  </Button>
                </div>
              </div>
            </m.div>
          </SettingModalContentPortal>
        )}
      </AnimatePresence>
    </div>
  )
}

import { Button } from "@follow/components/ui/button/index.js"
import { Label } from "@follow/components/ui/label/index.jsx"
import { Switch } from "@follow/components/ui/switch/index.jsx"
import type { UserByokProviderConfig } from "@follow/shared/settings/interface"
import { useUserRole } from "@follow/store/user/hooks"
import { useId } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { useIsPaymentEnabled, useServerConfigs } from "~/atoms/server-configs"
import { getAISettings, setAISetting, useAISettingValue } from "~/atoms/settings/ai"
import { useDialog, useModalStack } from "~/components/ui/modal/stacked/hooks"
import { useSetSettingTab } from "~/modules/settings/modal/context"

import { ByokProviderItem } from "./ByokProviderItem"
import { ByokProviderModalContent } from "./ByokProviderModalContent"
import { isDecisionProviderConfig } from "./constants"

/** Whether the user's plan includes BYOK, or undefined while the plan is unknown */
const usePlanIncludesByok = () => {
  const role = useUserRole()
  const serverConfigs = useServerConfigs()
  return (serverConfigs?.PAYMENT_PLAN_LIST ?? []).find((plan) => plan.role === role)?.limit
    .AI_BRING_YOUR_OWN_KEY
}

export const ByokSection = () => {
  const { t } = useTranslation("ai")
  const aiSettings = useAISettingValue()
  const byok = aiSettings.byok ?? { enabled: false, providers: [] }
  const { present } = useModalStack()
  const { ask } = useDialog()
  const enabledSwitchId = useId()
  // The server ignores the keys of a plan without BYOK. Keys saved before stay listed so they
  // can be removed, and BYOK can still be turned off.
  const isNotInPlan = usePlanIncludesByok() === false
  const isPaymentEnabled = useIsPaymentEnabled()
  const setTab = useSetSettingTab()

  const handleToggleEnabled = (enabled: boolean) => {
    setAISetting("byok", {
      ...byok,
      enabled,
    })
  }

  const handleAddProvider = (group: "decision" | "chat") => {
    const currentByok = getAISettings().byok ?? { enabled: false, providers: [] }
    const configuredProviders = currentByok.providers.map((p) => p.provider)

    present({
      title: t("byok.providers.add_title"),
      content: ({ dismiss }: { dismiss: () => void }) => (
        <ByokProviderModalContent
          provider={null}
          configuredProviders={configuredProviders}
          group={group}
          onSave={(provider) => {
            const updatedByok = getAISettings().byok ?? { enabled: false, providers: [] }
            setAISetting("byok", {
              ...updatedByok,
              providers: [...updatedByok.providers, provider],
            })
            toast.success(t("byok.providers.added"))
            dismiss()
          }}
          onCancel={dismiss}
        />
      ),
    })
  }

  const handleEditProvider = (provider: UserByokProviderConfig) => {
    const currentByok = getAISettings().byok ?? { enabled: false, providers: [] }
    const index = currentByok.providers.findIndex(
      (p) =>
        p.provider === provider.provider &&
        p.baseURL === provider.baseURL &&
        p.model === provider.model,
    )
    if (index < 0) return
    // Exclude the current provider being edited from configured list
    const configuredProviders = currentByok.providers
      .filter((_, i) => i !== index)
      .map((p) => p.provider)

    present({
      title: t("byok.providers.edit_title"),
      content: ({ dismiss }: { dismiss: () => void }) => (
        <ByokProviderModalContent
          provider={provider}
          configuredProviders={configuredProviders}
          group={isDecisionProviderConfig(provider) ? "decision" : "chat"}
          onSave={(updatedProvider) => {
            const updatedByok = getAISettings().byok ?? { enabled: false, providers: [] }
            const updatedProviders = [...updatedByok.providers]
            updatedProviders[index] = updatedProvider
            setAISetting("byok", {
              ...updatedByok,
              providers: updatedProviders,
            })
            toast.success(t("byok.providers.updated"))
            dismiss()
          }}
          onCancel={dismiss}
        />
      ),
    })
  }

  const handleDeleteProvider = async (provider: UserByokProviderConfig) => {
    const confirmed = await ask({
      title: t("byok.providers.delete_title"),
      message: t("byok.providers.delete_message"),
      confirmText: t("words.delete", { ns: "common" }),
      cancelText: t("words.cancel", { ns: "common" }),
      variant: "danger",
    })

    if (confirmed) {
      const currentByok = getAISettings().byok ?? { enabled: false, providers: [] }
      const index = currentByok.providers.findIndex(
        (p) =>
          p.provider === provider.provider &&
          p.baseURL === provider.baseURL &&
          p.model === provider.model,
      )
      if (index < 0) return
      const updatedProviders = currentByok.providers.filter((_, i) => i !== index)
      setAISetting("byok", {
        ...currentByok,
        providers: updatedProviders,
      })
      toast.success(t("byok.providers.deleted"))
    }
  }

  const decisionProviders = byok.providers.filter(isDecisionProviderConfig)
  const chatProviders = byok.providers.filter((provider) => !isDecisionProviderConfig(provider))

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Label htmlFor={enabledSwitchId} className="text-sm font-medium text-text">
              {t("byok.enabled")}
            </Label>
            <div className="text-xs text-text-secondary">
              {t("byok.description")}
              {isNotInPlan && (
                <>
                  <span className="text-red"> {t("byok.not_in_plan")}</span>
                  {isPaymentEnabled && (
                    <button
                      type="button"
                      className="ml-1 text-accent hover:underline"
                      onClick={() => setTab("plan")}
                    >
                      {t("subscription.actions.upgrade", { ns: "settings" })}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
          <Switch
            id={enabledSwitchId}
            checked={byok.enabled}
            onCheckedChange={handleToggleEnabled}
            disabled={isNotInPlan && !byok.enabled}
          />
        </div>
      </div>

      {(byok.enabled || (isNotInPlan && byok.providers.length > 0)) && (
        <>
          {/* 决策模型组：进「重点关注」的内容用决策模型判定 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium text-text">
                  {t("byok.groups.decision.title")}
                </Label>
                <div className="text-xs text-text-secondary">
                  {t("byok.groups.decision.description")}
                </div>
              </div>
              {!isNotInPlan && (
                <Button variant="outline" size="sm" onClick={() => handleAddProvider("decision")}>
                  <i className="i-mgc-add-cute-re mr-2 size-4" />
                  {t("byok.providers.add")}
                </Button>
              )}
            </div>

            {decisionProviders.length === 0 && !isNotInPlan && (
              <div className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-text-tertiary">
                {t("byok.groups.decision.empty")}
              </div>
            )}

            <div className="!mt-2 space-y-4">
              {decisionProviders.map((provider) => (
                <ByokProviderItem
                  key={`${provider.provider}-${provider.baseURL ?? ""}-${provider.model ?? ""}`}
                  provider={provider}
                  onDelete={() => handleDeleteProvider(provider)}
                  onEdit={isNotInPlan ? undefined : () => handleEditProvider(provider)}
                />
              ))}
            </div>
          </div>

          {/* 语言模型组：翻译、摘要等生成式 AI 功能 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium text-text">
                  {t("byok.groups.chat.title")}
                </Label>
                <div className="text-xs text-text-secondary">
                  {t("byok.groups.chat.description")}
                </div>
              </div>
              {!isNotInPlan && (
                <Button variant="outline" size="sm" onClick={() => handleAddProvider("chat")}>
                  <i className="i-mgc-add-cute-re mr-2 size-4" />
                  {t("byok.providers.add")}
                </Button>
              )}
            </div>

            {chatProviders.length === 0 && !isNotInPlan && (
              <div className="rounded-lg border border-dashed border-border px-4 py-4 text-center text-xs text-text-tertiary">
                {t("byok.groups.chat.empty")}
              </div>
            )}

            <div className="!mt-2 space-y-4">
              {chatProviders.map((provider) => (
                <ByokProviderItem
                  key={`${provider.provider}-${provider.baseURL ?? ""}-${provider.model ?? ""}`}
                  provider={provider}
                  onDelete={() => handleDeleteProvider(provider)}
                  onEdit={isNotInPlan ? undefined : () => handleEditProvider(provider)}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

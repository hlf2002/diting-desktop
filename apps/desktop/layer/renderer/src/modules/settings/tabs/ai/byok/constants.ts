import { BYOK_PROVIDERS } from "@follow/shared/settings/byok-providers"
import type { ByokProviderName, UserByokProviderConfig } from "@follow/shared/settings/interface"

/**
 * BYOK 提供商目录：带协议标记（chat = OpenAI 兼容语言模型，decision = System One 决策模型）。
 * 表单下拉按协议分组：决策模型用于重点关注判定，语言模型用于翻译/AI 功能。
 */
export type ByokProviderOption = {
  value: ByokProviderName
  label: string
  protocol: "chat" | "decision"
}

export const PROVIDER_OPTIONS: ByokProviderOption[] = BYOK_PROVIDERS.map((provider) => ({
  value: provider.value,
  label: provider.label,
  protocol: provider.protocol ?? "chat",
}))

/** 该配置是否决策模型（System One）：重点关注判定专用。 */
export const isDecisionProviderConfig = (provider: UserByokProviderConfig): boolean =>
  PROVIDER_OPTIONS.find((option) => option.value === provider.provider)?.protocol === "decision"

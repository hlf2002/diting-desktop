import { BYOK_PROVIDERS } from "@follow/shared/settings/byok-providers"
import type { ByokProviderName } from "@follow/shared/settings/interface"

/**
 * 表单下拉选项：直接来自 BYOK 提供商目录（国内在前），新增厂商只改目录一处。
 */
export const PROVIDER_OPTIONS: { value: ByokProviderName; label: string }[] = BYOK_PROVIDERS.map(
  (provider) => ({ value: provider.value, label: provider.label }),
)

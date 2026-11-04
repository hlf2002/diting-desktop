import { SettingAI } from "~/modules/settings/tabs/ai"
import { SettingsTitle } from "~/modules/settings/title"
import { defineSettingPageData } from "~/modules/settings/utils"

const iconName = "i-mgc-ai-cute-re"
const priority = (1000 << 1) + 15

export const handle = defineSettingPageData({
  icon: iconName,
  name: "titles.ai",
  priority,
  // 自托管没有平台 AI key，翻译/摘要都靠用户自己填的 BYOK 配置，
  // 所以不能再按 AI_CHAT_ENABLED（上游云端聊天开关）隐藏这个设置页，
  // 否则用户找不到填 baseURL / apiKey 的入口。
  hideIf: () => false,
})

export function Component() {
  return (
    <>
      <SettingsTitle />
      <SettingAI />
    </>
  )
}

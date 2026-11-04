import type { ByokProviderName } from "./interface"

/**
 * BYOK 提供商目录。
 *
 * 全部走 OpenAI 兼容的 `POST {baseURL}/chat/completions`，服务端只做转发。
 * 顺序即表单里的展示顺序：国内厂商在前（主要使用者是国内网络）。
 * `custom` 表示未收录的自建 / 代理端点，baseURL 与 model 必须由用户自己填。
 *
 * 服务端 `diting-server/src/lib/ai.ts` 有同一份默认值表，改动要两边同步。
 */
export type ByokProviderGroup = "cn" | "global" | "custom"

export type ByokProviderMeta = {
  value: ByokProviderName
  /** 展示名（品牌名，跨语言不翻译） */
  label: string
  /** 选中后自动填入的默认端点；custom 为 null（必须自己填） */
  defaultBaseURL: string | null
  /** 选中后自动填入的默认模型；custom 为 null（必须自己填） */
  defaultModel: string | null
  group: ByokProviderGroup
  /** 选中时显示在表单里的额外提示 */
  hint?: string
}

export const BYOK_PROVIDERS: ByokProviderMeta[] = [
  // ---------------- 国内 ----------------
  {
    value: "deepseek",
    label: "DeepSeek 深度求索",
    defaultBaseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    group: "cn",
  },
  {
    value: "alibaba",
    label: "阿里云百炼（通义千问）",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    group: "cn",
  },
  {
    value: "zai",
    label: "智谱 GLM",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4-flash",
    group: "cn",
  },
  {
    value: "kimi-cn",
    label: "Kimi 月之暗面",
    defaultBaseURL: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    group: "cn",
  },
  {
    value: "minimax-cn",
    label: "MiniMax（国内）",
    defaultBaseURL: "https://api.minimaxi.com/v1",
    defaultModel: "MiniMax-Text-01",
    group: "cn",
  },
  {
    value: "stepfun",
    label: "阶跃星辰 StepFun",
    defaultBaseURL: "https://api.stepfun.com/v1",
    defaultModel: "step-1-8k",
    group: "cn",
  },
  {
    value: "siliconflow",
    label: "硅基流动 SiliconFlow",
    defaultBaseURL: "https://api.siliconflow.cn/v1",
    defaultModel: "Qwen/Qwen2.5-7B-Instruct",
    group: "cn",
  },
  {
    value: "volces",
    label: "火山方舟（豆包）",
    defaultBaseURL: "https://ark.cn-beijing.volces.com/api/v3",
    defaultModel: "doubao-pro-32k",
    group: "cn",
    hint: "火山方舟通常要填推理接入点 ID（ep-xxxxxxxx）作为模型名",
  },
  {
    value: "baidu-qianfan",
    label: "百度千帆（文心）",
    defaultBaseURL: "https://qianfan.baidubce.com/v2",
    defaultModel: "ernie-4.0-8k",
    group: "cn",
  },

  // ---------------- 海外 ----------------
  {
    value: "openai",
    label: "OpenAI",
    defaultBaseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    group: "global",
  },
  {
    value: "google",
    label: "Google Gemini",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    group: "global",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    group: "global",
  },
  {
    value: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    defaultBaseURL: "https://ai-gateway.vercel.sh/v1",
    defaultModel: "openai/gpt-4o-mini",
    group: "global",
  },

  // ---------------- 自定义 ----------------
  {
    value: "custom",
    label: "自定义（OpenAI 兼容）",
    defaultBaseURL: null,
    defaultModel: null,
    group: "custom",
    hint: "填写任意兼容 /chat/completions 的端点，如公司内网网关、本地 Ollama / vLLM",
  },
]

export const BYOK_PROVIDER_GROUP_LABELS: Record<ByokProviderGroup, string> = {
  cn: "国内",
  global: "海外",
  custom: "自定义",
}

export const getByokProviderMeta = (value: string): ByokProviderMeta | undefined =>
  BYOK_PROVIDERS.find((provider) => provider.value === value)

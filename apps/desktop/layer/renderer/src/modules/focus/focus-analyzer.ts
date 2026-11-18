import { BYOK_PROVIDERS } from "@follow/shared/settings/byok-providers"
import type { UserByokProviderConfig } from "@follow/shared/settings/interface"
import { isBizId } from "@follow/utils/utils"

import { getAISettings } from "~/atoms/settings/ai"

export interface FocusCandidate {
  id: string
  title?: string | null
  description?: string | null
}

export interface FocusAnalysisResult {
  /** Entry ids the AI matched against the user's focus criteria. */
  matchedIds: string[]
  /** Every id that was actually scored (matched or not). */
  analyzedIds: string[]
  /** True when the analysis was skipped (no criteria / no AI config), so the caller can decide. */
  skipped: boolean
}

const BATCH_SIZE = 20
const REQUEST_TIMEOUT_MS = 60_000
const TITLE_LIMIT = 200
const DESCRIPTION_LIMIT = 300

const pickProvider = (): (UserByokProviderConfig & { baseURL: string; model: string }) | null => {
  const byok = getAISettings().byok
  if (!byok?.enabled) return null

  for (const provider of byok.providers ?? []) {
    if (!provider.apiKey) continue
    const meta = BYOK_PROVIDERS.find((item) => item.value === provider.provider)
    const baseURL = (provider.baseURL || meta?.defaultBaseURL || "").replace(/\/$/, "")
    const model = provider.model || meta?.defaultModel || ""
    if (!baseURL || !model) continue
    return { ...provider, baseURL, model }
  }
  return null
}

const truncate = (text: string | null | undefined, limit: number) => {
  if (!text) return ""
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

const buildMessages = (criteria: string, candidates: FocusCandidate[]) => {
  const listJson = JSON.stringify(
    candidates.map((entry) => ({
      id: entry.id,
      title: truncate(entry.title, TITLE_LIMIT),
      description: truncate(entry.description, DESCRIPTION_LIMIT),
    })),
  )
  return [
    {
      role: "system",
      content:
        "你是内容筛选助手。根据用户设定的「重点关注内容」标准，判断候选内容是否属于用户重点关注范围。只输出 JSON，不要输出任何其他文字或解释。",
    },
    {
      role: "user",
      content: `用户重点关注内容的标准：
"""${criteria}"""

候选内容列表（JSON 数组，每条含 id/title/description）：
${listJson}

请判断每条内容是否属于用户重点关注的范围，只返回符合标准的条目的 id 组成的 JSON 数组，例如 ["id1","id3"]。全部不符合则返回 []。`,
    },
  ]
}

export const extractIdArray = (raw: string): string[] => {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === "string" && isBizId(id))
  } catch {
    return []
  }
}

/**
 * Score a batch of new entries against the user's focus criteria using their
 * BYOK provider. Pure client-side: no server involvement.
 *
 * Returns `skipped: true` (nothing scored) when the user has not filled in the
 * focus criteria or has not configured a working BYOK provider.
 */
export const analyzeEntriesForFocus = async (
  candidates: FocusCandidate[],
): Promise<FocusAnalysisResult> => {
  const criteria = getAISettings().personalizePrompt.trim()
  if (!criteria) return { matchedIds: [], analyzedIds: [], skipped: true }

  const provider = pickProvider()
  if (!provider) return { matchedIds: [], analyzedIds: [], skipped: true }

  const results: FocusAnalysisResult = {
    matchedIds: [],
    analyzedIds: [],
    skipped: false,
  }

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const analyzedIds: string[] = []
    let matchedIds: string[] = []

    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
      try {
        const response = await fetch(`${provider.baseURL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${provider.apiKey}`,
            ...(provider.headers ?? {}),
          },
          body: JSON.stringify({
            model: provider.model,
            temperature: 0,
            messages: buildMessages(criteria, batch),
          }),
          signal: controller.signal,
        })
        if (!response.ok) {
          console.error("[focus-analyzer] provider request failed", response.status)
          continue
        }
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const content = data.choices?.[0]?.message?.content ?? ""
        matchedIds = extractIdArray(content)
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      // Transient network/provider errors: leave the batch unscored so a later
      // trigger with fresh entries retries it.
      console.error("[focus-analyzer] request failed", error)
      continue
    }

    analyzedIds.push(...batch.map((entry) => entry.id))
    results.matchedIds.push(...matchedIds)
    results.analyzedIds.push(...analyzedIds)
  }

  return results
}

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
  /** entryId → why it matched (short, from the AI). */
  matchedReasons: Record<string, string>
  /** Every id that was actually scored (matched or not). */
  analyzedIds: string[]
  /** Ids that could not be scored (network/provider errors) — caller should retry them. */
  failedIds: string[]
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
        "你是内容筛选助手。根据用户设定的「重点关注内容」标准，判断候选内容是否属于用户重点关注范围，并给出判断理由。只输出 JSON，不要输出任何其他文字或解释。",
    },
    {
      role: "user",
      content: `用户重点关注内容的标准：
"""${criteria}"""

候选内容列表（JSON 数组，每条含 id/title/description）：
${listJson}

请判断每条内容是否属于用户重点关注的范围，返回符合标准的条目的 id 和判断理由组成的 JSON 数组，格式为 [{"id":"id1","reason":"理由1"}]。理由要具体说明该内容与用户关注标准的对应关系，一句话即可。全部不符合则返回 []。`,
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

export interface FocusMatchResult {
  id: string
  reason?: string
}

/**
 * Parse the AI response: either the legacy plain array of ids or the current
 * [{id, reason}] shape. Malformed/unknown ids are dropped.
 */
export const extractFocusResults = (raw: string): FocusMatchResult[] => {
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item): FocusMatchResult | null => {
        if (typeof item === "string") return { id: item }
        if (item && typeof item === "object" && typeof item.id === "string") {
          return {
            id: item.id,
            reason: typeof item.reason === "string" ? item.reason : undefined,
          }
        }
        return null
      })
      .filter((item): item is FocusMatchResult => Boolean(item && isBizId(item.id)))
  } catch {
    return []
  }
}

/**
 * Extract plain text from a stored prompt. Older builds stored the Lexical
 * serialized EditorState JSON (see PersonalizePromptSection) instead of the
 * user's words; this unwraps that shape so the AI always receives readable text.
 */
export const extractPlainText = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === "object" && "root" in parsed && "children" in parsed.root) {
      const parts: string[] = []
      const walk = (nodes: unknown[]) => {
        for (const node of nodes) {
          if (node && typeof node === "object") {
            const n = node as Record<string, unknown>
            if (typeof n.text === "string" && n.text.length > 0) parts.push(n.text)
            if (Array.isArray(n.children)) walk(n.children)
          }
        }
      }
      walk(parsed.root.children)
      return parts.join(" ").trim()
    }
    return trimmed
  } catch {
    return trimmed
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
  const criteria = extractPlainText(getAISettings().personalizePrompt)
  if (!criteria)
    return { matchedIds: [], matchedReasons: {}, analyzedIds: [], failedIds: [], skipped: true }

  const provider = pickProvider()
  if (!provider)
    return { matchedIds: [], matchedReasons: {}, analyzedIds: [], failedIds: [], skipped: true }

  const results: FocusAnalysisResult = {
    matchedIds: [],
    matchedReasons: {},
    analyzedIds: [],
    failedIds: [],
    skipped: false,
  }

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const analyzedIds: string[] = []
    let matchedIds: string[] = []
    const matchedReasons: Record<string, string> = {}

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
          results.failedIds.push(...batch.map((entry) => entry.id))
          continue
        }
        const data = (await response.json()) as {
          choices?: Array<{ message?: { content?: string } }>
        }
        const content = data.choices?.[0]?.message?.content ?? ""
        const matches = extractFocusResults(content)
        matchedIds = matches.map((match) => match.id)
        for (const match of matches) {
          if (match.reason) matchedReasons[match.id] = match.reason
        }
      } finally {
        clearTimeout(timeout)
      }
    } catch (error) {
      // Transient network/provider errors: report the batch as failed so the
      // caller can put it back on the queue and retry on the next trigger.
      console.error("[focus-analyzer] request failed", error)
      results.failedIds.push(...batch.map((entry) => entry.id))
      continue
    }

    analyzedIds.push(...batch.map((entry) => entry.id))
    results.matchedIds.push(...matchedIds)
    for (const [id, reason] of Object.entries(matchedReasons)) {
      results.matchedReasons[id] = reason
    }
    results.analyzedIds.push(...analyzedIds)
  }

  return results
}

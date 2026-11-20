import { env } from "@follow/shared/env.desktop"
import { BYOK_PROVIDERS } from "@follow/shared/settings/byok-providers"
import type { UserByokProviderConfig } from "@follow/shared/settings/interface"
import { isBizId } from "@follow/utils/utils"

import { getAISettings } from "~/atoms/settings/ai"
import { apiFetch } from "~/lib/api-client"

export interface FocusCandidate {
  id: string
  feedId?: string | null
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
  /** entryId → decision-model score (noul probability 0~1) at scoring time. */
  scores: Record<string, number>
  /** Ids that could not be scored (network/provider errors) — caller should retry them. */
  failedIds: string[]
  /** True when the analysis was skipped (no criteria / no AI config), so the caller can decide. */
  skipped: boolean
}

const BATCH_SIZE = 20
const REQUEST_TIMEOUT_MS = 60_000
const TITLE_LIMIT = 200
const DESCRIPTION_LIMIT = 300

/** 服务端建立的主体档案（个人/机构/媒体，AI + 联网搜索）。 */
export interface FocusProfile {
  feedId: string
  entityType: string
  name: string | null
  summary: string | null
}

/**
 * 批量拉取候选条目所在数据源的档案（POST /api/feeds/profiles）。
 * 失败时返回空 map——档案只是判断的辅助信息，缺失不应阻断分析主流程。
 */
const fetchProfiles = async (
  feedIds: Array<string | null | undefined>,
): Promise<Record<string, FocusProfile>> => {
  const unique = [...new Set(feedIds.filter((id): id is string => Boolean(id)))]
  if (unique.length === 0) return {}
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await apiFetch(
        new Request(`${env.VITE_API_URL}/api/feeds/profiles`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ feedIds: unique }),
          credentials: "include",
          signal: controller.signal,
        }),
      )
      if (!response.ok) {
        console.error("[focus-analyzer] profile fetch failed", response.status)
        return {}
      }
      const data = (await response.json()) as { data?: { profiles?: Record<string, FocusProfile> } }
      return data.data?.profiles ?? {}
    } finally {
      clearTimeout(timeout)
    }
  } catch (error) {
    console.error("[focus-analyzer] profile fetch failed", error)
    return {}
  }
}

/**
 * 候选条目来自 entry store，其 feedId 可能为 null（服务端 serializeEntry 不返回 feedId，
 * 客户端列表 morph 的 feedId 依赖响应里的 feeds 对象，缺失时档案段拼不上、AI 只能猜数据源）。
 * 对 feedId 缺失的候选逐个 GET /entries?id=（详情响应带 feeds.id）补拉。
 * 失败静默返回 null——补拉只是让档案更可靠，不应阻断分析主流程。
 */
export const fetchMissingFeedIds = async (
  candidates: FocusCandidate[],
): Promise<Record<string, string | null>> => {
  const missing = candidates.filter((c) => !c.feedId && Boolean(c.id)).map((c) => c.id)
  if (missing.length === 0) return {}
  const result: Record<string, string | null> = {}
  for (let i = 0; i < missing.length; i += 5) {
    const chunk = missing.slice(i, i + 5)
    await Promise.all(
      chunk.map(async (id) => {
        try {
          const controller = new AbortController()
          const timeout = setTimeout(() => controller.abort(), 15_000)
          try {
            const response = await apiFetch(
              new Request(`${env.VITE_API_URL}/api/entries?id=${id}`, {
                credentials: "include",
                signal: controller.signal,
              }),
            )
            if (!response.ok) return
            const data = (await response.json()) as { data?: { feeds?: { id?: string } } }
            result[id] = data.data?.feeds?.id ?? null
          } finally {
            clearTimeout(timeout)
          }
        } catch (error) {
          console.error("[focus-analyzer] entry feedId fetch failed", id, error)
          result[id] = null
        }
      }),
    )
  }
  return result
}

/** 用补拉结果补齐候选的 feedId（无缺失时原样返回）。 */
export const enrichCandidateFeedIds = (
  candidates: FocusCandidate[],
  fixes: Record<string, string | null>,
): FocusCandidate[] =>
  candidates.map((c) => (c.feedId || !fixes[c.id] ? c : { ...c, feedId: fixes[c.id] }))

/** 把数据源档案拼成 prompt 段落：告诉 AI 这条内容来自谁（个人/机构/媒体），避免把主体旗下公司的动态当成机构动态。 */
export const buildProfileSection = (
  candidates: FocusCandidate[],
  profiles: Record<string, FocusProfile>,
): string => {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const candidate of candidates) {
    if (!candidate.feedId || seen.has(candidate.feedId)) continue
    seen.add(candidate.feedId)
    const profile = profiles[candidate.feedId]
    if (!profile || !profile.name) continue
    const typeLabel =
      profile.entityType === "person"
        ? "个人"
        : profile.entityType === "media"
          ? "媒体"
          : profile.entityType === "org"
            ? "机构/组织"
            : profile.entityType === "other"
              ? "其他主体"
              : "未知"
    lines.push(
      `- 数据源 ${profile.feedId}：${profile.name}（${typeLabel}）。${profile.summary ?? ""}`.trim(),
    )
  }
  if (lines.length === 0) return ""
  return `\n候选内容所属数据源档案（用于识别数据源是谁：个人/机构/媒体。判断「数据源」相关标准时以此为准，不要把个人账号旗下公司/产品的动态当成机构本身；媒体/机构类数据源若有特定公司名单限定，必须核对名单后再下结论）：\n${lines.join("\n")}`
}

export const pickProvider = ():
  (UserByokProviderConfig & { baseURL: string; model: string }) | null => {
  const byok = getAISettings().byok
  if (!byok?.enabled) return null

  const resolve = (provider: UserByokProviderConfig) => {
    if (!provider.apiKey) return null
    const meta = BYOK_PROVIDERS.find((item) => item.value === provider.provider)
    const baseURL = (provider.baseURL || meta?.defaultBaseURL || "").replace(/\/$/, "")
    const model = provider.model || meta?.defaultModel || ""
    if (!baseURL || !model) return null
    return { ...provider, baseURL, model }
  }

  // 决策模型（System One）优先：重点关注判定是高频结构化判断，配置了决策模型
  // 就优先用它；LLM（chat）只在没配决策模型时兜底。providers 数组顺序不代表
  // 优先级——用户可能把 zai 等 chat 厂商排前面，按顺序挑会绕过决策模型
  // （2026-11-20 实锤：GLM 排第一导致判定仍在走 LLM）。
  for (const provider of byok.providers ?? []) {
    if (!isDecisionProvider(provider)) continue
    const resolved = resolve(provider)
    if (resolved) return resolved
  }
  for (const provider of byok.providers ?? []) {
    if (isDecisionProvider(provider)) continue
    const resolved = resolve(provider)
    if (resolved) return resolved
  }
  return null
}

const truncate = (text: string | null | undefined, limit: number) => {
  if (!text) return ""
  const trimmed = text.trim()
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

const buildMessages = (criteria: string, candidates: FocusCandidate[], profileSection: string) => {
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
${profileSection}
候选内容列表（JSON 数组，每条含 id/title/description）：
${listJson}

请判断每条内容是否属于用户重点关注的范围，返回符合标准的条目的 id 和判断理由组成的 JSON 数组，格式为 [{"id":"id1","reason":"理由1"}]。判断为符合的条目必须给出具体理由：说明该内容与标准中哪一条/哪一方面的对应关系（引用标准原文或关键词），一句话即可；禁止使用「符合您设定的重点关注标准」这类不指明具体标准的笼统表述。全部不符合则返回 []。

特别注意（当标准按数据源类型分支时）：标准可能按「数据源是一个人/一个机构/一个媒体」分三条规则。你必须先用数据源档案确定该内容来自哪类主体，再套用对应那条规则；若对应规则还限定了公司名单（如「媒体，我只想看以下公司的新闻：A、B、C」），必须把名单里的公司逐一与内容标题/描述比对，内容中完全不涉及名单中任何一家公司的一律判不符合——即使内容属于该媒体且话题相关，也不能算匹配。判断为不符合的条目，绝对不要出现在返回的 JSON 数组中（不得把不符合的条目以任何形式返回，包括带否定性理由的形式）；返回数组中的每条 id 都代表该内容符合标准。`,
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
 * Detect a reason that actually says the entry does NOT match (e.g. the AI
 * phrasing a whitelist miss as "内容未涉及标准中限定的特定公司名单"). Such a
 * reason is a negative verdict, not a "why it matched" — treating it as a match
 * reason promotes non-matching entries into the focus set (2026-11-20 实锤).
 */
export const isNegativeReason = (reason: string): boolean =>
  /不涉及|未涉及|不符合|不属于|未命中|未提到|无关|不在名单|不包含|不匹配|无法匹配|并非|并不是|没有涉及|没有提到|没有提及/.test(
    reason,
  )

/**
 * Keep only matches that carry a concrete, affirmative reason. An entry matched
 * by the AI without a reason — or with a negative reason — is treated as not
 * matching: the "重点关注" mark requires a specific why, and a negative why is
 * no why at all (no generic fallback copy is ever shown).
 */
export const filterReasonedMatches = (matches: FocusMatchResult[]): FocusMatchResult[] =>
  matches.filter((match) => Boolean(match.reason) && !isNegativeReason(match.reason!))

// ---------------------------------------------------------------------------
// 决策模型（System One）判定：provider.protocol === "decision"
// 用 noul（是非题）逐条判断，返回概率而非文本；匹配与否按阈值切分。
// ---------------------------------------------------------------------------

/** 决策模型判定阈值：noul 概率 >= 该值才算匹配（2026-11-20 实测匹配 0.97-1.0、不匹配 0.01，0.8 分离安全）。 */
export const FOCUS_DECISION_THRESHOLD = 0.8

export const isDecisionProvider = (provider: { provider: string }): boolean =>
  BYOK_PROVIDERS.find((item) => item.value === provider.provider)?.protocol === "decision"

/** 从标准里提取媒体分支的公司名单（如「媒体，我只想看以下公司的新闻：字节跳动，阿里巴巴，腾讯」→ 公司数组）。 */
export const extractWhitelistCompanies = (criteria: string): string[] => {
  const match = criteria.match(/(?:以下公司|公司名单|这些公司)[^：:\n]*[：:]\s*([^。\n；]+)/)
  if (!match) return []
  const list = match[1]
  if (!list) return []
  return list
    .split(/[,，、\s]+/)
    .map((name) => name.trim())
    .filter((name) => name.length >= 2)
}

/** 本地名单命中检测：标题/描述包含名单公司名（公司名可能在标题里变形，做包含匹配，≥2 字才参与）。 */
export const findWhitelistHit = (text: string, companies: string[]): string | null => {
  const normalized = text ?? ""
  for (const company of companies) {
    if (normalized.includes(company)) return company
  }
  return null
}

/** 从 profileSection 文本里取某候选数据源的类型标签（个人/媒体/机构/其他主体/未知）。 */
export const profileTypeOf = (profileSection: string, entry: FocusCandidate): string | null => {
  if (!entry.feedId) return null
  const line = profileSection.split("\n").find((line) => line.includes(`数据源 ${entry.feedId}`))
  if (!line) return null
  const m = line.match(/（([^）]+)）/)
  return m?.[1] ?? null
}

/** 决策模型不生成文本，reason 由确定性模板生成：名单命中时精确到公司名。 */
export const buildDecisionReason = (
  entry: FocusCandidate,
  criteria: string,
  companies: string[],
  p: number,
  profileType: string | null,
): string => {
  const titleDesc = `${entry.title ?? ""} ${entry.description ?? ""}`
  const hit = findWhitelistHit(titleDesc, companies)
  const prob = `（决策判定概率 ${p.toFixed(2)}）`
  if (hit) return `数据源为媒体，内容涉及重点关注名单中的公司：${hit}${prob}`
  if (profileType === "个人" || profileType === "person") {
    return `数据源为个人，内容反映人物的品质与思想光芒${prob}`
  }
  if (profileType === "机构/组织" || profileType === "org") {
    return `数据源为机构，内容为该机构的最新动态${prob}`
  }
  if (profileType === "媒体" || profileType === "media") {
    return `数据源为媒体，内容涉及重点关注名单中的公司${prob}`
  }
  return `内容符合用户重点关注标准${prob}`
}

export interface DecisionAnswer {
  type?: string
  noul?: number
}

/** 决策模型批量判定的原始输出：匹配项 + 全部候选的 noul 概率评分（未匹配的也保留，供「未进入重点关注」卡片展示）。 */
export interface DecisionBatchResult {
  matches: FocusMatchResult[]
  scores: Record<string, number>
}

/**
 * 把 systemone 响应解析成匹配结果：q_{entryId} → noul 概率，>= 阈值判匹配。
 * 阈值以下的条目（包括 0.8 边界以下）一律不匹配——决策模型本身是概率判定，
 * 不会像 LLM 那样输出否定性理由，所以这里不需要 isNegativeReason 兜底。
 * 同时收集全部候选的评分（未匹配的也要，供「未进入重点关注」卡片展示）。
 */
export const parseDecisionAnswers = (
  answers: Record<string, DecisionAnswer> | undefined,
  candidates: FocusCandidate[],
  criteria: string,
  profileSection: string,
): DecisionBatchResult => {
  const companies = extractWhitelistCompanies(criteria)
  const matches: FocusMatchResult[] = []
  const scores: Record<string, number> = {}
  for (const entry of candidates) {
    const answer = answers?.[`q_${entry.id}`]
    const p = answer?.noul ?? 0
    scores[entry.id] = p
    if (p >= FOCUS_DECISION_THRESHOLD) {
      const profileType = profileTypeOf(profileSection, entry)
      matches.push({
        id: entry.id,
        reason: buildDecisionReason(entry, criteria, companies, p, profileType),
      })
    }
  }
  return { matches, scores }
}

/** 构造 System One 请求：state 放标准/档案/候选，questions 每条候选一个 noul（必须引用 id，否则模型无法区分）。 */
export const buildDecisionRequest = (
  criteria: string,
  candidates: FocusCandidate[],
  profileSection: string,
  model: string,
): { model: string; state: Record<string, unknown>; questions: Record<string, unknown> } => {
  const state = {
    criteria,
    profile: profileSection || "无档案",
    candidates: candidates.map((entry) => ({
      id: entry.id,
      title: truncate(entry.title, TITLE_LIMIT),
      description: truncate(entry.description, DESCRIPTION_LIMIT),
    })),
  }
  const questions: Record<string, unknown> = {}
  for (const entry of candidates) {
    questions[`q_${entry.id}`] = {
      type: "noul",
      instructions:
        `请判断 state.candidates 中 id 为 ${entry.id} 的内容（标题：${truncate(entry.title, 80)}）是否属于用户重点关注范围。` +
        `判定规则：先看该内容数据源的类型（state.profile 中该条的数据源档案，判断数据源是谁以档案为准，不要把文章主角当成数据源），再套用 state.criteria 中对应类型的那条规则；` +
        `若数据源是媒体且标准限定了公司名单，只有内容标题/描述涉及名单中的公司才算符合；数据源是个人则看内容是否反映其品质与思想光芒；数据源是机构则看内容是否为其最新动态。`,
      criteria: { true: "属于重点关注范围", false: "不属于重点关注范围" },
    }
  }
  return { model, state, questions }
}

/** 决策模型批量判定：走 `POST {baseURL}/systemone`，返回匹配的候选（id + 模板 reason）及全部候选评分。 */
export const analyzeBatchWithDecision = async (
  provider: {
    baseURL: string
    model: string
    apiKey?: string | null
    headers?: Record<string, string>
  },
  criteria: string,
  batch: FocusCandidate[],
  profileSection: string,
): Promise<DecisionBatchResult> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${provider.baseURL}/systemone`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${provider.apiKey}`,
        ...(provider.headers ?? {}),
      },
      body: JSON.stringify(buildDecisionRequest(criteria, batch, profileSection, provider.model)),
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error("[focus-analyzer] decision request failed", response.status)
      throw new Error(`decision_status_${response.status}`)
    }
    const data = (await response.json()) as { answers?: Record<string, DecisionAnswer> }
    return parseDecisionAnswers(data.answers, batch, criteria, profileSection)
  } finally {
    clearTimeout(timeout)
  }
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
    return {
      matchedIds: [],
      matchedReasons: {},
      analyzedIds: [],
      scores: {},
      failedIds: [],
      skipped: true,
    }

  const provider = pickProvider()
  if (!provider)
    return {
      matchedIds: [],
      matchedReasons: {},
      analyzedIds: [],
      scores: {},
      failedIds: [],
      skipped: true,
    }

  // 决策模型（System One）只做判断、不生成文本，走独立的 /systemone 协议。
  const decisionMode = isDecisionProvider(provider)

  // 批量拉数据源档案（个人/机构/媒体），失败不影响主流程。
  // entry store 的 feedId 可能缺失（serializeEntry 不返回 feedId），先补拉再取档案，
  // 否则档案段为空、AI 只能从标题猜数据源（把文章主角当成数据源，2026-11-19 实锤）。
  const feedIdFixes = await fetchMissingFeedIds(candidates)
  const enrichedCandidates = enrichCandidateFeedIds(candidates, feedIdFixes)
  const profiles = await fetchProfiles(enrichedCandidates.map((entry) => entry.feedId))
  const profileSection = buildProfileSection(enrichedCandidates, profiles)

  const results: FocusAnalysisResult = {
    matchedIds: [],
    matchedReasons: {},
    analyzedIds: [],
    scores: {},
    failedIds: [],
    skipped: false,
  }

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    const analyzedIds: string[] = []
    let matchedIds: string[] = []
    const matchedReasons: Record<string, string> = {}
    const scores: Record<string, number> = {}

    try {
      if (decisionMode) {
        const decisionResult = await analyzeBatchWithDecision(
          provider,
          criteria,
          batch,
          profileSection,
        )
        matchedIds = decisionResult.matches.map((match) => match.id)
        for (const match of decisionResult.matches) {
          if (match.reason) matchedReasons[match.id] = match.reason
        }
        for (const [id, score] of Object.entries(decisionResult.scores)) {
          scores[id] = score
        }
      } else {
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
              messages: buildMessages(criteria, batch, profileSection),
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
          const matches = filterReasonedMatches(extractFocusResults(content))
          matchedIds = matches.map((match) => match.id)
          for (const match of matches) {
            if (match.reason) matchedReasons[match.id] = match.reason
          }
        } finally {
          clearTimeout(timeout)
        }
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
    for (const [id, score] of Object.entries(scores)) {
      results.scores[id] = score
    }
    results.analyzedIds.push(...analyzedIds)
  }

  return results
}

export interface FocusExplainResult {
  /** entryId → concrete reason (from the AI). */
  reasons: Record<string, string>
  /** Ids that could not be explained (network/provider errors) — caller retries them. */
  failedIds: string[]
  /** True when the request was skipped (no criteria / no AI config), so the caller can decide. */
  skipped: boolean
}

const buildReasonMessages = (
  criteria: string,
  candidates: FocusCandidate[],
  profileSection: string,
) => {
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
        "你是内容筛选助手。以下内容曾被标记为属于用户的「重点关注内容」范围，请复核每条内容，并为复核后仍属于重点关注范围的内容生成具体的判断理由，说明该内容与用户重点关注标准的具体对应关系。只输出 JSON，不要输出任何其他文字或解释。",
    },
    {
      role: "user",
      content: `用户重点关注内容的标准：
"""${criteria}"""
${profileSection}
候选内容列表（JSON 数组，每条含 id/title/description）：
${listJson}

请为每条内容生成判断理由，返回 JSON 数组，格式为 [{"id":"id1","reason":"理由1"}]。理由要具体说明该内容与用户重点关注标准中哪一条/哪一方面的对应关系（引用标准原文或关键词），一句话即可；禁止使用「符合您的重点关注标准」这类不指明具体标准的笼统表述。

特别注意（当标准按数据源类型分支时）：标准可能按「数据源是一个人/一个机构/一个媒体」分三条规则。生成理由时先用数据源档案确定主体类型，再套用对应那条规则；若对应规则限定了公司名单（如「媒体，我只想看以下公司的新闻：A、B、C」），理由必须说明内容涉及名单中哪家公司；复核后发现内容不涉及名单中任何一家公司（或不符合同样明确的限定）的条目，判定为不符合——不符合的条目不要生成理由，也绝对不要出现在返回的 JSON 数组中。`,
    },
  ]
}

/**
 * Backfill concrete reasons for entries already flagged as focus but scored
 * before reasons existed (or where the AI returned none). This never re-judges
 * whether an entry matches — it only explains why it matches.
 */
export const explainFocusMatches = async (
  candidates: FocusCandidate[],
): Promise<FocusExplainResult> => {
  const criteria = extractPlainText(getAISettings().personalizePrompt)
  if (!criteria) return { reasons: {}, failedIds: [], skipped: true }

  const provider = pickProvider()
  if (!provider) return { reasons: {}, failedIds: [], skipped: true }

  // 批量拉数据源档案（个人/机构/媒体），失败不影响主流程。
  // 同 analyzeEntriesForFocus：entry store 的 feedId 可能缺失，先补拉再取档案。
  const feedIdFixes = await fetchMissingFeedIds(candidates)
  const enrichedCandidates = enrichCandidateFeedIds(candidates, feedIdFixes)
  const profiles = await fetchProfiles(enrichedCandidates.map((entry) => entry.feedId))
  const profileSection = buildProfileSection(enrichedCandidates, profiles)

  const result: FocusExplainResult = { reasons: {}, failedIds: [], skipped: false }

  // 决策模型（System One）只做判断、不生成文本，走独立的 /systemone 协议。
  const decisionMode = isDecisionProvider(provider)

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE)
    try {
      if (decisionMode) {
        // 复核：决策模型判匹配的补上模板 reason；判不匹配的不写 reason，
        // 调用方按 unexplained 分支把该条移出重点集合。
        const decisionResult = await analyzeBatchWithDecision(
          provider,
          criteria,
          batch,
          profileSection,
        )
        for (const match of decisionResult.matches) {
          if (match.reason) result.reasons[match.id] = match.reason
        }
      } else {
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
              messages: buildReasonMessages(criteria, batch, profileSection),
            }),
            signal: controller.signal,
          })
          if (!response.ok) {
            console.error("[focus-analyzer] reason request failed", response.status)
            result.failedIds.push(...batch.map((entry) => entry.id))
            continue
          }
          const data = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>
          }
          const content = data.choices?.[0]?.message?.content ?? ""
          const matches = extractFocusResults(content)
          for (const match of matches) {
            // A negative reason ("内容未涉及标准中限定的特定公司名单") is the AI
            // saying the entry does NOT match — it must not be stored as a reason
            // (which would promote the entry into the focus set). The caller's
            // "unexplained" branch drops such entries from the focus set instead.
            if (match.reason && !isNegativeReason(match.reason)) {
              result.reasons[match.id] = match.reason
            }
          }
        } finally {
          clearTimeout(timeout)
        }
      }
    } catch (error) {
      console.error("[focus-analyzer] reason request failed", error)
      result.failedIds.push(...batch.map((entry) => entry.id))
    }
  }

  return result
}

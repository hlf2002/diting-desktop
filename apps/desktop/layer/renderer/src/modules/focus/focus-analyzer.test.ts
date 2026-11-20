import type { UserByokProviderConfig } from "@follow/shared/settings/interface"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildDecisionReason,
  buildDecisionRequest,
  buildProfileSection,
  enrichCandidateFeedIds,
  extractFocusResults,
  extractIdArray,
  extractPlainText,
  extractWhitelistCompanies,
  filterReasonedMatches,
  findWhitelistHit,
  isDecisionProvider,
  isNegativeReason,
  parseDecisionAnswers,
  pickProvider,
} from "./focus-analyzer"

const mockAISettings: {
  personalizePrompt: string
  byok: { enabled: boolean; providers: UserByokProviderConfig[] }
} = { personalizePrompt: "", byok: { enabled: false, providers: [] } }

vi.mock("~/atoms/settings/ai", () => ({
  getAISettings: vi.fn(() => mockAISettings),
}))

const VALID_ID = "1721025600000" // 13-digit snowflake-ish id

describe("extractPlainText", () => {
  it("passes plain text through", () => {
    expect(extractPlainText("  AI、科技、创业  ")).toBe("AI、科技、创业")
  })

  it("extracts text from a Lexical serialized EditorState", () => {
    const lexicalJson = JSON.stringify({
      root: {
        children: [
          {
            children: [
              { detail: 0, format: 0, type: "text", version: 1, text: "AI、科技、创业", style: "" },
            ],
            direction: "ltr",
            format: "",
            indent: 0,
            type: "paragraph",
            version: 1,
          },
        ],
        direction: "ltr",
        format: "",
        indent: 0,
        type: "root",
        version: 1,
      },
    })
    expect(extractPlainText(lexicalJson)).toBe("AI、科技、创业")
  })

  it("joins multiple Lexical text nodes", () => {
    const lexicalJson = JSON.stringify({
      root: {
        children: [
          {
            children: [
              { type: "text", version: 1, text: "AI" },
              { type: "text", version: 1, text: "、科技" },
            ],
            type: "paragraph",
            version: 1,
          },
        ],
        type: "root",
        version: 1,
      },
    })
    expect(extractPlainText(lexicalJson)).toBe("AI 、科技")
  })

  it("returns empty for empty or whitespace input", () => {
    expect(extractPlainText("")).toBe("")
    expect(extractPlainText("   ")).toBe("")
  })

  it("passes through non-JSON values", () => {
    expect(extractPlainText("不是 JSON")).toBe("不是 JSON")
  })
})

describe("extractIdArray", () => {
  it("extracts a plain JSON array", () => {
    expect(extractIdArray(`["${VALID_ID}","1721025600001"]`)).toEqual([VALID_ID, "1721025600001"])
  })

  it("extracts an empty array", () => {
    expect(extractIdArray("[]")).toEqual([])
  })

  it("extracts an array wrapped in markdown fences", () => {
    expect(extractIdArray(`\`\`\`json\n["${VALID_ID}"]\n\`\`\``)).toEqual([VALID_ID])
  })

  it("extracts an array with surrounding prose", () => {
    expect(extractIdArray(`符合的有：["${VALID_ID}"]，请查收`)).toEqual([VALID_ID])
  })

  it("drops non-string and non-snowflake ids", () => {
    expect(extractIdArray(`["${VALID_ID}", 123, "uuid-xxxx", "abc"]`)).toEqual([VALID_ID])
  })

  it("returns an empty array when no array is present", () => {
    expect(extractIdArray("no match here")).toEqual([])
  })

  it("returns an empty array on malformed json", () => {
    expect(extractIdArray(`["${VALID_ID}",`)).toEqual([])
  })
})

describe("extractFocusResults", () => {
  it("extracts ids with reasons", () => {
    expect(extractFocusResults(`[{"id":"${VALID_ID}","reason":"与 AI 相关"}]`)).toEqual([
      { id: VALID_ID, reason: "与 AI 相关" },
    ])
  })

  it("still accepts the legacy plain id array", () => {
    expect(extractFocusResults(`["${VALID_ID}"]`)).toEqual([{ id: VALID_ID }])
  })

  it("drops entries without a valid snowflake id", () => {
    expect(
      extractFocusResults(`[{"id":"uuid-xxxx","reason":"x"},{"id":"${VALID_ID}","reason":"y"}]`),
    ).toEqual([{ id: VALID_ID, reason: "y" }])
  })

  it("keeps a match without a reason", () => {
    expect(extractFocusResults(`[{"id":"${VALID_ID}"}]`)).toEqual([{ id: VALID_ID }])
  })

  it("returns an empty array on malformed input", () => {
    expect(extractFocusResults("nothing")).toEqual([])
    expect(extractFocusResults(`[{"id":"${VALID_ID}",`)).toEqual([])
  })
})

describe("isNegativeReason", () => {
  it("flags whitelist-miss phrasings", () => {
    expect(isNegativeReason("内容未涉及标准中限定的特定公司名单")).toBe(true)
    expect(isNegativeReason("该内容不涉及名单中的任何公司")).toBe(true)
    expect(isNegativeReason("内容与重点关注标准无关")).toBe(true)
  })

  it("does not flag affirmative reasons", () => {
    expect(isNegativeReason("报道了名单中的宁德时代")).toBe(false)
    expect(isNegativeReason("与 AI 相关")).toBe(false)
  })
})

describe("filterReasonedMatches", () => {
  it("keeps only matches that carry a concrete reason", () => {
    expect(
      filterReasonedMatches([
        { id: VALID_ID, reason: "与 AI 相关" },
        { id: "1721025600001" },
        { id: "1721025600002", reason: "" },
      ]),
    ).toEqual([{ id: VALID_ID, reason: "与 AI 相关" }])
  })

  it("drops matches whose reason says the entry does NOT match", () => {
    expect(
      filterReasonedMatches([
        { id: VALID_ID, reason: "内容未涉及标准中限定的特定公司名单" },
        { id: "1721025600001", reason: "不涉及名单中的任何一家公司" },
      ]),
    ).toEqual([])
  })

  it("returns empty when no match has a reason", () => {
    expect(filterReasonedMatches([{ id: VALID_ID }, { id: "1721025600001" }])).toEqual([])
  })
})

const WHITELIST_CRITERIA =
  "如果数据源是一个人，我只想看能反应一个人背后品质，思想光芒的内容；如果数据源是一个媒体，我只想看以下公司的新闻：字节跳动，阿里巴巴，腾讯，金蝶，用友，亿企赢，税友"

describe("extractWhitelistCompanies", () => {
  it("extracts the company list from the media branch", () => {
    expect(extractWhitelistCompanies(WHITELIST_CRITERIA)).toEqual([
      "字节跳动",
      "阿里巴巴",
      "腾讯",
      "金蝶",
      "用友",
      "亿企赢",
      "税友",
    ])
  })

  it("returns empty when no whitelist is mentioned", () => {
    expect(extractWhitelistCompanies("如果数据源是一个人，只看品质")).toEqual([])
  })
})

describe("findWhitelistHit", () => {
  it("finds a company name in the text", () => {
    expect(findWhitelistHit("字节跳动发布豆包新版本", ["字节跳动", "腾讯"])).toBe("字节跳动")
  })

  it("returns null when no company appears", () => {
    expect(findWhitelistHit("山东富豪向上市公司赠送资产", ["字节跳动", "腾讯"])).toBeNull()
  })
})

describe("buildDecisionReason", () => {
  it("names the hit company when the whitelist matches", () => {
    const entry = { id: VALID_ID, title: "字节跳动发布豆包新版本", description: "" }
    const companies = ["字节跳动", "腾讯"]
    expect(buildDecisionReason(entry, WHITELIST_CRITERIA, companies, 0.98, "媒体")).toContain(
      "字节跳动",
    )
  })

  it("uses the profile type branch when no company hits", () => {
    const entry = { id: VALID_ID, title: "一位创业者的自述", description: "" }
    expect(buildDecisionReason(entry, WHITELIST_CRITERIA, [], 0.95, "个人")).toContain("品质与思想")
    expect(buildDecisionReason(entry, WHITELIST_CRITERIA, [], 0.95, "机构/组织")).toContain(
      "最新动态",
    )
  })
})

describe("parseDecisionAnswers", () => {
  const candidates = [
    { id: VALID_ID, title: "字节跳动发布豆包新版本", description: "" },
    { id: "1721025600001", title: "55亿山东富豪尽显豪气", description: "" },
  ]

  it("keeps entries above the threshold with a reason, drops the rest", () => {
    const matches = parseDecisionAnswers(
      {
        [`q_${VALID_ID}`]: { type: "noul", noul: 0.98 },
        q_1721025600001: { type: "noul", noul: 0.01 },
      },
      candidates,
      WHITELIST_CRITERIA,
      "",
    )
    expect(matches.map((match) => match.id)).toEqual([VALID_ID])
    expect(matches[0]?.reason).toContain("字节跳动")
  })

  it("drops entries below the threshold", () => {
    const matches = parseDecisionAnswers(
      { [`q_${VALID_ID}`]: { type: "noul", noul: 0.79 } },
      candidates,
      WHITELIST_CRITERIA,
      "",
    )
    expect(matches).toEqual([])
  })

  it("treats missing answers as non-matches", () => {
    expect(parseDecisionAnswers(undefined, candidates, WHITELIST_CRITERIA, "")).toEqual([])
  })
})

describe("isDecisionProvider", () => {
  it("flags the bailian decision provider", () => {
    expect(isDecisionProvider({ provider: "alibaba-decision" })).toBe(true)
    expect(isDecisionProvider({ provider: "deepseek" })).toBe(false)
  })
})

describe("pickProvider", () => {
  const zai: UserByokProviderConfig = {
    provider: "zai",
    apiKey: "zai-key",
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
    model: "GLM-4-FlashX-250414",
  }
  const decision: UserByokProviderConfig = {
    provider: "alibaba-decision",
    apiKey: "sk-ws-key",
    baseURL: "https://trial.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    model: "decision-model-preview",
  }

  beforeEach(() => {
    mockAISettings.byok = { enabled: true, providers: [] }
  })

  it("prefers the decision provider even when a chat provider is listed first", () => {
    mockAISettings.byok.providers = [zai, decision]
    const picked = pickProvider()
    expect(picked?.provider).toBe("alibaba-decision")
  })

  it("falls back to the chat provider when no decision provider is configured", () => {
    mockAISettings.byok.providers = [zai]
    expect(pickProvider()?.provider).toBe("zai")
  })

  it("skips a decision provider without a key and uses the chat one", () => {
    mockAISettings.byok.providers = [{ ...decision, apiKey: null }, zai]
    expect(pickProvider()?.provider).toBe("zai")
  })

  it("returns null when disabled", () => {
    mockAISettings.byok.enabled = false
    expect(pickProvider()).toBeNull()
  })
})

describe("buildDecisionRequest", () => {
  it("builds one noul question per candidate, referencing its id", () => {
    const candidates = [
      { id: VALID_ID, title: "字节跳动发布豆包新版本", description: "" },
      { id: "1721025600001", title: "山东富豪赠礼", description: "" },
    ]
    const request = buildDecisionRequest(
      WHITELIST_CRITERIA,
      candidates,
      "",
      "decision-model-preview",
    )
    expect(request.model).toBe("decision-model-preview")
    expect(Object.keys(request.questions)).toEqual([`q_${VALID_ID}`, "q_1721025600001"])
    expect((request.questions[`q_${VALID_ID}`] as { instructions: string }).instructions).toContain(
      VALID_ID,
    )
    expect(request.state.candidates).toHaveLength(2)
  })
})

describe("buildProfileSection", () => {
  const candidates = [
    { id: "1721025600000", feedId: "1721025600010", title: "t1", description: "d1" },
    { id: "1721025600001", feedId: "1721025600010", title: "t2", description: "d2" },
    { id: "1721025600002", feedId: "1721025600011", title: "t3", description: "d3" },
    { id: "1721025600003", feedId: null, title: "t4", description: "d4" },
  ]

  it("lists each distinct data source with its entity type and summary", () => {
    const profiles = {
      "1721025600010": {
        feedId: "1721025600010",
        entityType: "person",
        name: "埃隆·马斯克",
        summary: "特斯拉、SpaceX 的 CEO。",
      },
      "1721025600011": {
        feedId: "1721025600011",
        entityType: "org",
        name: "Starlink",
        summary: "SpaceX 旗下卫星互联网公司。",
      },
    }
    const section = buildProfileSection(candidates, profiles)
    expect(section).toContain("埃隆·马斯克（个人）")
    expect(section).toContain("Starlink（机构/组织）")
    // 同一 feed 的多条候选只出现一次（每行以「- 数据源 」开头）
    expect(section.match(/^- 数据源 /gm)).toHaveLength(2)
    // 无档案的候选不产生行
    expect(section).not.toContain("t4")
  })

  it("labels media entity type as 媒体", () => {
    const profiles = {
      "1721025600010": {
        feedId: "1721025600010",
        entityType: "media",
        name: "钛媒体",
        summary: "科技媒体。",
      },
    }
    const section = buildProfileSection(candidates, profiles)
    expect(section).toContain("钛媒体（媒体）")
  })

  it("returns empty string when no profile has a name", () => {
    const profiles = {
      "1721025600010": { feedId: "1721025600010", entityType: "person", name: null, summary: null },
    }
    expect(buildProfileSection(candidates, profiles)).toBe("")
  })

  it("returns empty string when there are no profiles at all", () => {
    expect(buildProfileSection(candidates, {})).toBe("")
  })
})

describe("enrichCandidateFeedIds", () => {
  it("keeps known feedIds and fills missing ones from the fetch fixes", () => {
    const candidates = [
      { id: "1721025600000", feedId: "1721025600010", title: "t1", description: "d1" },
      { id: "1721025600001", feedId: null, title: "t2", description: "d2" },
      { id: "1721025600002", feedId: undefined, title: "t3", description: "d3" },
    ]
    const fixes = {
      "1721025600001": "1721025600011",
      "1721025600002": "1721025600012",
    }
    const enriched = enrichCandidateFeedIds(candidates, fixes)
    expect(enriched[0]?.feedId).toBe("1721025600010")
    expect(enriched[1]?.feedId).toBe("1721025600011")
    expect(enriched[2]?.feedId).toBe("1721025600012")
  })

  it("leaves a missing feedId null when the fetch returned nothing for it", () => {
    const candidates = [{ id: "1721025600000", feedId: null, title: "t", description: "d" }]
    const enriched = enrichCandidateFeedIds(candidates, {})
    expect(enriched[0]?.feedId).toBeNull()
  })
})

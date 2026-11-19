import { describe, expect, it } from "vitest"

import {
  buildProfileSection,
  extractFocusResults,
  extractIdArray,
  extractPlainText,
  filterReasonedMatches,
} from "./focus-analyzer"

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

  it("returns empty when no match has a reason", () => {
    expect(filterReasonedMatches([{ id: VALID_ID }, { id: "1721025600001" }])).toEqual([])
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

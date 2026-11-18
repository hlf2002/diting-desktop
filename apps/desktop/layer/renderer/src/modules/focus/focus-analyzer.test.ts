import { describe, expect, it } from "vitest"

import { extractIdArray } from "./focus-analyzer"

const VALID_ID = "1721025600000" // 13-digit snowflake-ish id

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

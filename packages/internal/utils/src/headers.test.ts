import { describe, expect, test } from "vitest"

import { createAuthRequestOriginHeaders } from "./headers"

describe("createAuthRequestOriginHeaders", () => {
  test("uses the web origin for auth requests", () => {
    expect(createAuthRequestOriginHeaders("https://diting.7373.com.cn/login?from=desktop")).toEqual(
      {
        Origin: "https://diting.7373.com.cn",
        Referer: "https://diting.7373.com.cn",
      },
    )
  })

  test("returns empty headers for invalid urls", () => {
    expect(createAuthRequestOriginHeaders("not-a-url")).toEqual({})
  })
})

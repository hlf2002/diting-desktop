import { describe, expect, it, vi } from "vitest"

vi.mock("./browser-login", () => ({
  loginWithBrowser: vi.fn(),
  resolveBrowserLoginToken: vi.fn(),
}))

const { loginWithBrowser, resolveBrowserLoginToken } = await import("./browser-login")
const { resolveLoginToken } = await import("./commands/auth")

describe("resolveLoginToken", () => {
  it("exchanges a provided one-time token into a session token", async () => {
    vi.mocked(resolveBrowserLoginToken).mockResolvedValueOnce("session-token")

    await expect(
      resolveLoginToken({
        inputToken: "one-time-token",
        apiUrl: "https://diting.7373.com.cn",
        timeoutMs: 180_000,
        onStatus: vi.fn(),
      }),
    ).resolves.toBe("session-token")

    expect(resolveBrowserLoginToken).toHaveBeenCalledWith(
      "https://diting.7373.com.cn",
      "one-time-token",
    )
  })

  it("falls back to browser login when no token is provided", async () => {
    vi.mocked(loginWithBrowser).mockResolvedValueOnce({
      token: "browser-session-token",
      callbackUrl: "http://127.0.0.1/callback",
      loginUrl: "https://diting.7373.com.cn/login",
    })

    await expect(
      resolveLoginToken({
        apiUrl: "https://diting.7373.com.cn",
        timeoutMs: 180_000,
        onStatus: vi.fn(),
      }),
    ).resolves.toBe("browser-session-token")
  })
})

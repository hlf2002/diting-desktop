import { describe, expect, it, vi } from "vitest"

vi.mock("./browser-login", () => ({
  loginWithQzhuliScan: vi.fn(),
  resolveBrowserLoginToken: vi.fn(),
}))

const { loginWithQzhuliScan, resolveBrowserLoginToken } = await import("./browser-login")
const { resolveLoginToken } = await import("./commands/auth")

describe("resolveLoginToken", () => {
  it("exchanges a provided token into a session token", async () => {
    vi.mocked(resolveBrowserLoginToken).mockResolvedValueOnce("session-token")

    await expect(
      resolveLoginToken({
        inputToken: "session-token",
        apiUrl: "https://diting.7373.com.cn",
        timeoutMs: 180_000,
        onStatus: vi.fn(),
      }),
    ).resolves.toBe("session-token")

    expect(resolveBrowserLoginToken).toHaveBeenCalledWith(
      "https://diting.7373.com.cn",
      "session-token",
    )
  })

  it("falls back to Q助理 scan login when no token is provided", async () => {
    vi.mocked(loginWithQzhuliScan).mockResolvedValueOnce({
      token: "browser-session-token",
      user: { id: "user-1", name: null, image: null, handle: null },
    })

    await expect(
      resolveLoginToken({
        apiUrl: "https://diting.7373.com.cn",
        timeoutMs: 180_000,
        onStatus: vi.fn(),
      }),
    ).resolves.toBe("browser-session-token")

    expect(loginWithQzhuliScan).toHaveBeenCalledWith({
      apiUrl: "https://diting.7373.com.cn",
      timeoutMs: 180_000,
      onStatus: expect.any(Function),
    })
  })
})

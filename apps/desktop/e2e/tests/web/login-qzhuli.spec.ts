import { expect, test } from "@playwright/test"

import { createTestAccount } from "../../support/account"
import {
  ensureLoginModal,
  loginTestUser,
  logoutFromProfileMenu,
  openWebApp,
  registerTestUser,
} from "../../support/app"
import { resolveDesktopE2EEnv } from "../../support/env"

/**
 * Q助理扫码登录的 UI + 会话落地回归测试。
 *
 * 真实扫码需要 Q助理 App 与生产回调域名，自动化环境无法完成；
 * 这里只验证两件事：
 *   1. 登录弹窗只暴露 Q助理入口，邮箱密码入口已下线
 *   2. 测试会话能正确落地（本地登录态生效、可以正常登出）
 */
test.describe("web qzhuli login", () => {
  test("exposes the Q assistant entry and restores a session", async ({ page }) => {
    test.setTimeout(300_000)

    const env = resolveDesktopE2EEnv()
    const account = createTestAccount("web-login")

    await openWebApp(page, env)
    await ensureLoginModal(page)

    await test.step("login modal only offers the Q assistant entry", async () => {
      const qzhuliEntry = page.locator('[data-testid="login-provider-qzhuli"]:visible')

      // 未登录时客户端会因 get-session 401 自动弹出登录弹窗；
      // 若尚未弹出，再点击侧边栏的登录按钮兜底。
      if (!(await qzhuliEntry.isVisible().catch(() => false))) {
        const loginButton = page.locator('[data-testid="login-button"]:visible').last()
        if (await loginButton.isVisible().catch(() => false)) {
          await loginButton.click({ noWaitAfter: true })
        }
      }

      await expect(qzhuliEntry).toBeVisible({ timeout: 30_000 })

      // 邮箱密码相关入口已下线
      await expect(page.locator('[data-testid="login-email-input"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="register-email-input"]')).toHaveCount(0)
    })

    await test.step("lands a test session", async () => {
      await registerTestUser(page, account)
    })

    await test.step("signs out and signs back in", async () => {
      await logoutFromProfileMenu(page)
      await loginTestUser(page, account)
    })
  })
})

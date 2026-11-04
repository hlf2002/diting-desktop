import { WEB_BUILD } from "@follow/shared/constants"
import { useUserRole } from "@follow/store/user/hooks"
import {
  getImageProxyUrl as getImageProxyUrlUtils,
  replaceImgUrlIfNeed as replaceImgUrlIfNeedUtils,
} from "@follow/utils/img-proxy"
import { useCallback } from "react"

import { useServerConfigs } from "~/atoms/server-configs"

export const useCanUseImageProxy = () => {
  const userRole = useUserRole()
  const serverConfig = useServerConfigs()
  // 自托管服务端可能不返回 PAYMENT_PLAN_LIST（或本地缓存是旧版本配置），
  // 直接 .find 会抛 TypeError 崩掉整个 UserAvatar 渲染，这里兜底为空数组
  const canUseProxy =
    !userRole ||
    (serverConfig?.PAYMENT_PLAN_LIST ?? []).find((i) => i.role === userRole)?.limit
      .SECURE_IMAGE_PROXY
  return canUseProxy
}

export const useReplaceImgUrlIfNeed = () => {
  const canUseProxy = useCanUseImageProxy()

  return useCallback(
    (url?: string) => {
      return replaceImgUrlIfNeedUtils({
        url,
        inBrowser: WEB_BUILD,
        canUseProxy,
      })
    },
    [canUseProxy],
  )
}

export const useGetImageProxyUrl = () => {
  const canUseProxy = useCanUseImageProxy()

  return useCallback(
    (params: Omit<Parameters<typeof getImageProxyUrlUtils>[0], "canUseProxy">) => {
      return getImageProxyUrlUtils({
        canUseProxy,
        ...params,
      })
    },
    [canUseProxy],
  )
}

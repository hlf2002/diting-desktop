import { env } from "@follow/shared/env.desktop"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { apiFetch } from "~/lib/api-client"

/**
 * 数据源主体档案卡片（2026-11-19）。
 * 服务端用 AI + 联网搜索为订阅源建立档案（个人/机构/媒体），这里在订阅前展示
 * 「这是谁」的简介，让用户订阅时一眼看到数据源身份。
 * 新源订阅时档案是异步建立的（约 30-60s），组件轮询最多 60s 等档案 ready。
 */
export interface FeedProfileData {
  feedId: string
  entityType: string
  name: string | null
  summary: string | null
  status: string
}

const fetchProfile = async (feedId: string): Promise<FeedProfileData | null> => {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10_000)
    try {
      const response = await apiFetch(
        new Request(`${env.VITE_API_URL}/api/feeds/${feedId}/profile`, {
          credentials: "include",
          signal: controller.signal,
        }),
      )
      if (!response.ok) return null
      const json = (await response.json()) as { data?: { profile?: FeedProfileData | null } }
      return json.data?.profile ?? null
    } finally {
      clearTimeout(timeout)
    }
  } catch {
    return null
  }
}

const entityTypeLabel = (entityType: string): string => {
  if (entityType === "person") return "个人"
  if (entityType === "media") return "媒体"
  if (entityType === "org") return "机构/组织"
  if (entityType === "other") return "其他主体"
  return "未知"
}

export const FeedProfileCard = ({ feedId }: { feedId: string }) => {
  const [polling, setPolling] = useState(0)
  const { data: profile } = useQuery({
    queryKey: ["feed-profile", feedId, polling],
    queryFn: () => fetchProfile(feedId),
    enabled: Boolean(feedId),
    staleTime: 30_000,
  })

  // 服务端异步建档中（profile:null）时轮询，最多 6 次 × 10s = 60s
  useEffect(() => {
    if (profile || polling >= 6) return
    const timer = setTimeout(() => setPolling((p) => p + 1), 10_000)
    return () => clearTimeout(timer)
  }, [profile, polling])

  if (!profile?.name || !profile.summary || profile.status !== "ready") return null

  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-border/80 bg-fill-tertiary/40 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <i className="i-mgc-id-card-cute-re size-4 text-text-secondary" />
        <span className="truncate text-sm font-medium text-text">{profile.name}</span>
        <span className="shrink-0 rounded-full bg-fill-quaternary px-2 py-0.5 text-xs text-text-secondary">
          {entityTypeLabel(profile.entityType)}
        </span>
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">{profile.summary}</p>
    </div>
  )
}

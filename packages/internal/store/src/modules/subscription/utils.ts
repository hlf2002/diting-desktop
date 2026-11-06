import { isOnboardingFeedUrl } from "@follow/store/constants/onboarding"
import { capitalizeFirstLetter, parseUrl } from "@follow/utils/utils"

import { getFeedById } from "../feed/getter"
import type { SubscriptionModel } from "./types"

export const getInboxStoreId = (inboxId: string) => `inbox/${inboxId}`

// 常见站点的主机名 → 用户可读的分类名。autoGroup 默认按 siteUrl 分组，
// 直接显示英文域名（Weibo.com）不符合中文用户预期，常见站点映射成中文名。
const SITE_CATEGORY_NAMES: Record<string, string> = {
  "weibo.com": "微博",
  "zhihu.com": "知乎",
  "xiaohongshu.com": "小红书",
  "bilibili.com": "哔哩哔哩",
  "douban.com": "豆瓣",
  "jianshu.com": "简书",
  "sspai.com": "少数派",
  "36kr.com": "36氪",
  "huxiu.com": "虎嗅",
  "thepaper.cn": "澎湃新闻",
  "mp.weixin.qq.com": "微信公众号",
  "youtube.com": "YouTube",
  "x.com": "X",
  "twitter.com": "X",
  "github.com": "GitHub",
  "juejin.cn": "掘金",
  "infoq.cn": "InfoQ",
  "ruanyifeng.com": "阮一峰",
}

export const getSubscriptionStoreId = (subscription: SubscriptionModel) => {
  if (subscription.feedId) return subscription.feedId
  if (subscription.listId) return subscription.listId
  if (subscription.inboxId) return getInboxStoreId(subscription.inboxId)
  throw new Error("Invalid subscription")
}

export const getSubscriptionDBId = (subscription: SubscriptionModel) => {
  if (subscription.feedId && subscription.type === "feed") {
    return `${subscription.type}/${subscription.feedId}`
  }
  if (subscription.listId && subscription.type === "list") {
    return `${subscription.type}/${subscription.listId}`
  }
  if (subscription.inboxId && subscription.type === "inbox") {
    return `${subscription.type}/${subscription.inboxId}`
  }
  throw new Error("Invalid subscription")
}

export const getDefaultCategory = (subscription?: SubscriptionModel) => {
  if (!subscription) return null
  const { feedId } = subscription
  if (!feedId) return null

  const feed = getFeedById(feedId)
  if (!feed) return null
  const isOnboardingFeed = isOnboardingFeedUrl(feed.url)
  if (isOnboardingFeed) return "Onboarding Feeds"
  const siteUrl = getFeedById(feedId)?.siteUrl
  // A feed whose site URL is not known yet (e.g. the first rsshub fetch returned 202 queued and
  // no siteUrl was stored) must not vanish from the subscription column: group it under a
  // placeholder category instead of returning null, which drops the feed from the auto-grouped
  // list entirely.
  if (!siteUrl) return "Uncategorized"
  const parsed = parseUrl(siteUrl)
  if (!parsed) return siteUrl
  const host = parsed.hostname || parsed.domain
  if (host && SITE_CATEGORY_NAMES[host]) return SITE_CATEGORY_NAMES[host]
  return parsed?.domain ? capitalizeFirstLetter(parsed.domain) : siteUrl
}

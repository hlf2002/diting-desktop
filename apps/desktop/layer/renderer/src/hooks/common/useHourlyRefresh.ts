import { FeedViewType } from "@follow/constants"
import { refreshEntriesHead } from "@follow/store/entry/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { useEffect } from "react"

/** How often the timelines that are on screen get refetched while the app stays open. */
export const HOURLY_REFRESH_INTERVAL_MS = 60 * 60_000

// Notifications is included so the inbox-style view is refreshed too; collections and AI
// sorted lists are skipped by refreshEntriesHead.
const REFRESH_VIEWS: FeedViewType[] = [
  FeedViewType.Articles,
  FeedViewType.SocialMedia,
  FeedViewType.Pictures,
  FeedViewType.Videos,
  FeedViewType.Audios,
  FeedViewType.Notifications,
]

/**
 * Refetch the head of every timeline that is on screen and recount the unread counters.
 * Only new entries are merged into loaded pages, so the scroll position is kept.
 */
export const refreshVisibleTimelines = () =>
  Promise.allSettled([refreshEntriesHead({ views: REFRESH_VIEWS }), unreadSyncService.refresh()])

/**
 * Runs {@link refreshVisibleTimelines} once an hour until the returned stop function is
 * called. A run that is still in flight is not started twice.
 */
export const startHourlyRefresh = () => {
  let running = false
  const timer = window.setInterval(() => {
    if (running) return
    running = true
    void refreshVisibleTimelines().finally(() => {
      running = false
    })
  }, HOURLY_REFRESH_INTERVAL_MS)

  return () => {
    window.clearInterval(timer)
  }
}

/** Keep what is open fresh while the app is running. */
export const useHourlyRefresh = () => {
  useEffect(() => startHourlyRefresh(), [])
}

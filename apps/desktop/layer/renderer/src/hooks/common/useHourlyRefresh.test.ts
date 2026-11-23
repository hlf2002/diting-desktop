import { FeedViewType } from "@follow/constants"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  HOURLY_REFRESH_INTERVAL_MS,
  refreshVisibleTimelines,
  startHourlyRefresh,
} from "./useHourlyRefresh"

const mocks = vi.hoisted(() => ({
  refreshEntriesHead: vi.fn(async (_params: { views: FeedViewType[] }) => {}),
  unreadRefresh: vi.fn(async () => {}),
}))

vi.mock("@follow/store/entry/hooks", () => ({
  refreshEntriesHead: mocks.refreshEntriesHead,
}))
vi.mock("@follow/store/unread/store", () => ({
  unreadSyncService: { refresh: mocks.unreadRefresh },
}))

describe("refreshVisibleTimelines", () => {
  beforeEach(() => {
    mocks.refreshEntriesHead.mockClear()
    mocks.unreadRefresh.mockClear()
  })

  it("refetches the timelines on screen and recounts the unread counters", async () => {
    await refreshVisibleTimelines()

    expect(mocks.refreshEntriesHead).toHaveBeenCalledTimes(1)
    expect(mocks.refreshEntriesHead).toHaveBeenCalledWith({
      views: [
        FeedViewType.Articles,
        FeedViewType.SocialMedia,
        FeedViewType.Pictures,
        FeedViewType.Videos,
        FeedViewType.Audios,
        FeedViewType.Notifications,
      ],
    })
    expect(mocks.unreadRefresh).toHaveBeenCalledTimes(1)
  })

  it("swallows failures so the timer keeps going", async () => {
    mocks.refreshEntriesHead.mockRejectedValueOnce(new Error("offline"))
    mocks.unreadRefresh.mockRejectedValueOnce(new Error("offline"))

    await expect(refreshVisibleTimelines()).resolves.toBeDefined()
  })
})

describe("startHourlyRefresh", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.refreshEntriesHead.mockClear()
    mocks.unreadRefresh.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs once an hour and stops when the returned function is called", async () => {
    const stop = startHourlyRefresh()

    await vi.advanceTimersByTimeAsync(HOURLY_REFRESH_INTERVAL_MS - 1)
    expect(mocks.refreshEntriesHead).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(mocks.refreshEntriesHead).toHaveBeenCalledTimes(1)

    stop()
    await vi.advanceTimersByTimeAsync(HOURLY_REFRESH_INTERVAL_MS)
    expect(mocks.refreshEntriesHead).toHaveBeenCalledTimes(1)
  })
})

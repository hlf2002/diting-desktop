import { setRoute } from "@follow/components/atoms/route.js"
import { FeedViewType } from "@follow/constants"
import { describe, expect, test } from "vitest"

import { ROUTE_FEED_PENDING, ROUTE_VIEW_FOCUS } from "~/constants/app"

import { parseNavigateEntryOptions } from "./useNavigateEntry"

const setCurrentRoute = (timelineId: string, feedId: string) =>
  setRoute({
    params: { timelineId, feedId },
    searchParams: new URLSearchParams(),
    location: {
      pathname: `/timeline/${timelineId}/${feedId}/pending`,
      search: "",
      hash: "",
      state: null,
      key: "",
    },
  })

// 临时互斥验证：focus 视图与订阅源必须单选，focus 视图点条目必须保持 focus
describe("focus ↔ source navigation mutual exclusion", () => {
  test("clicking a feed while on the focus view leaves the focus timeline", () => {
    setCurrentRoute(ROUTE_VIEW_FOCUS, ROUTE_FEED_PENDING)
    const parsed = parseNavigateEntryOptions({
      feedId: "53102238519094272",
      entryId: null,
      view: FeedViewType.Articles,
    })
    expect(parsed.timelineId).toBe("articles")
    expect(parsed.feedId).toBe("53102238519094272")
  })

  test("clicking a starred item while on the focus view leaves the focus timeline", () => {
    setCurrentRoute(ROUTE_VIEW_FOCUS, ROUTE_FEED_PENDING)
    const parsed = parseNavigateEntryOptions({
      feedId: "collections",
      entryId: null,
      view: FeedViewType.Articles,
    })
    expect(parsed.timelineId).toBe("articles")
    expect(parsed.feedId).toBe("collections")
  })

  test("clicking a list while on the focus view leaves the focus timeline", () => {
    setCurrentRoute(ROUTE_VIEW_FOCUS, ROUTE_FEED_PENDING)
    const parsed = parseNavigateEntryOptions({
      listId: "list-1",
      entryId: null,
      view: FeedViewType.SocialMedia,
    })
    expect(parsed.timelineId).toBe("social-media")
    expect(parsed.feedId).toBe("list-list-1")
  })

  test("clicking an entry while on the focus view stays on the focus timeline", () => {
    setCurrentRoute(ROUTE_VIEW_FOCUS, ROUTE_FEED_PENDING)
    const parsed = parseNavigateEntryOptions({
      view: FeedViewType.Articles,
      entryId: "53102238519094273",
    })
    expect(parsed.timelineId).toBe(ROUTE_VIEW_FOCUS)
    expect(parsed.entryId).toBe("53102238519094273")
  })

  test("navigating to the focus view clears the feed", () => {
    setCurrentRoute("articles", "53102238519094272")
    const parsed = parseNavigateEntryOptions({
      entryId: null,
      feedId: null,
      timelineId: ROUTE_VIEW_FOCUS,
    })
    expect(parsed.timelineId).toBe(ROUTE_VIEW_FOCUS)
    expect(parsed.feedId).toBe(ROUTE_FEED_PENDING)
  })

  test("clicking a feed from a normal view still switches to its view", () => {
    setCurrentRoute("articles", ROUTE_FEED_PENDING)
    const parsed = parseNavigateEntryOptions({
      feedId: "53102238519094272",
      entryId: null,
      view: FeedViewType.Pictures,
    })
    expect(parsed.timelineId).toBe("pictures")
    expect(parsed.feedId).toBe("53102238519094272")
  })
})

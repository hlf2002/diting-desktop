import { FeedViewType, getView } from "@follow/constants"
import { useCollectionEntryList } from "@follow/store/collection/hooks"
import { isOnboardingEntryUrl } from "@follow/store/constants/onboarding"
import {
  useEntriesQuery,
  useEntryIdsByFeedId,
  useEntryIdsByFeedIds,
  useEntryIdsByInboxId,
  useEntryIdsByListId,
  useEntryIdsByView,
} from "@follow/store/entry/hooks"
import { entryActions, entrySyncServices, useEntryStore } from "@follow/store/entry/store"
import type { UseEntriesReturn } from "@follow/store/entry/types"
import { useFocusEntryIds } from "@follow/store/focus/hooks"
import { useFolderFeedsByFeedId } from "@follow/store/subscription/hooks"
import { unreadSyncService } from "@follow/store/unread/store"
import { nextFrame } from "@follow/utils"
import { isBizId } from "@follow/utils/utils"
import { useMutation } from "@tanstack/react-query"
import { debounce } from "es-toolkit/compat"
import { useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { useGeneralSettingKey } from "~/atoms/settings/general"
import { ROUTE_FEED_PENDING, ROUTE_VIEW_FOCUS } from "~/constants/app"
import { useFeature } from "~/hooks/biz/useFeature"
import { useRouteParams } from "~/hooks/biz/useRouteParams"
import { toastFetchError } from "~/lib/error-parser"

import { aiTimelineEnabledAtom } from "../atoms/ai-timeline"
import { getEffectiveRouteEntrySortOrder } from "./entry-sort-order"
import { getVisibleLocalEntryIds } from "./filter-local-entry-ids"
import type { RemoteEntriesReturn } from "./remote-entries-fallback"
import { getRemoteEntriesFallback } from "./remote-entries-fallback"
import { useIsPreviewFeed } from "./useIsPreviewFeed"

const useRemoteEntries = (): RemoteEntriesReturn => {
  const { feedId, view, inboxId, listId, isCollection } = useRouteParams()
  const isPreview = useIsPreviewFeed()

  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const hidePrivateSubscriptionsInTimeline = useGeneralSettingKey(
    "hidePrivateSubscriptionsInTimeline",
  )
  const savedSortOrder = useGeneralSettingKey("timelineSortOrder")
  const aiTimelineEnabled = useAtomValue(aiTimelineEnabledAtom)
  const aiEnabled = useFeature("ai")

  const folderIds = useFolderFeedsByFeedId({
    feedId,
    view,
  })
  const effectiveUnreadOnly = unreadOnly === true && !isPreview
  const effectiveSortOrder = getEffectiveRouteEntrySortOrder({
    sortOrder: savedSortOrder,
    unreadOnly: effectiveUnreadOnly,
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })

  const entriesOptions = useMemo(() => {
    const params = {
      feedId: folderIds?.join(",") || feedId,
      inboxId,
      listId,
      view,
      ...(effectiveUnreadOnly && { unreadOnly: true }),
      ...(hidePrivateSubscriptionsInTimeline === true && {
        hidePrivateSubscriptionsInTimeline: true,
      }),
      ...(view === FeedViewType.All && { limit: 40 }),
      ...(aiTimelineEnabled && aiEnabled && effectiveSortOrder === "desc" && { aiSort: true }),
      sortOrder: effectiveSortOrder,
    }

    if (feedId && listId && isBizId(feedId)) {
      delete params.listId
    }

    return params
  }, [
    feedId,
    folderIds,
    inboxId,
    listId,
    effectiveUnreadOnly,
    view,
    hidePrivateSubscriptionsInTimeline,
    aiTimelineEnabled,
    aiEnabled,
    effectiveSortOrder,
  ])
  const query = useEntriesQuery(entriesOptions)

  // Plans without AI sort get a 402. Go back to the usual order and say why, instead of
  // keeping the toggle on over the local list, which is not sorted by importance.
  const { t } = useTranslation()
  const setAiTimelineEnabled = useSetAtom(aiTimelineEnabledAtom)
  const aiSortError = entriesOptions.aiSort && query.isError ? query.error : null
  useEffect(() => {
    if (!aiSortError) return
    setAiTimelineEnabled(false)
    toastFetchError(aiSortError, { title: t("entry_list_header.ai_timeline_failed") })
  }, [aiSortError, setAiTimelineEnabled, t])

  // "Mark above as read" sends this as `insertedBefore`, so it must only move
  // when the top of the list is (re)loaded. Loading the next page doesn't show
  // entries inserted after the first page was fetched.
  const isFetchingFirstPage = query.isFetching && !query.isFetchingNextPage
  const [fetchedTime, setFetchedTime] = useState<number>()
  useEffect(() => {
    if (!isFetchingFirstPage) {
      setFetchedTime(Date.now())
    }
  }, [isFetchingFirstPage])

  const refetch = useCallback(async () => void query.refetch(), [query])
  const fetchNextPage = useCallback(async () => void query.fetchNextPage(), [query])

  if (!query.data || query.isLoading) {
    return getRemoteEntriesFallback(query, refetch)
  }
  return {
    entriesIds: query.entriesIds,
    hasNext: query.hasNextPage,
    refetch,

    fetchNextPage,
    isLoading: query.isFetching,
    isRefetching: query.isRefetching,
    isReady: query.isSuccess,
    isFetchingNextPage: query.isFetchingNextPage,
    isFetching: query.isFetching,
    hasNextPage: query.hasNextPage,
    error: query.isError ? query.error : null,
    fetchedTime,
    queryKey: query.queryKey,
  }
}

function getEntryIdsFromMultiplePlace(...entryIds: Array<string[] | undefined | null>) {
  return entryIds.find((ids) => ids?.length) ?? []
}

/**
 * The "重点关注内容" timeline: device-local focus marks. The list is built from
 * the entry store (entries that are still present locally), newest first, and
 * paginated in the same way as the local list.
 */
const useFocusEntries = ({
  onReset,
  enabled,
}: {
  onReset?: () => void
  /** Only the focus timeline should reset its scroll (mount time); the regular
   *  views must never scroll to top when the provider re-renders. */
  enabled: boolean
}) => {
  const focusEntryIds = useFocusEntryIds()

  const allEntries = useEntryStore(
    useCallback(
      (state) => {
        const ids = [...focusEntryIds].filter((id) => Boolean(state.data[id]))
        return ids.sort(
          (a, b) =>
            (state.data[b]?.publishedAt?.getTime() ?? 0) -
            (state.data[a]?.publishedAt?.getTime() ?? 0),
        )
      },
      [focusEntryIds],
    ),
  )

  const [page, setPage] = useState(0)
  const pageSize = 30
  const entries = useMemo(() => {
    return allEntries?.slice(0, (page + 1) * pageSize) || []
  }, [allEntries, page, pageSize])

  const hasNext = useMemo(() => {
    return entries.length < (allEntries?.length || 0)
  }, [entries.length, allEntries])

  useEffect(() => {
    if (!enabled) return
    nextFrame(() => {
      onReset?.()
    })
  }, [enabled, onReset])

  const refetch = useCallback(async () => {
    setPage(0)
  }, [])

  const fetchNextPage = useCallback(
    debounce(async () => {
      setPage(page + 1)
    }, 300),
    [page],
  )

  return {
    entriesIds: entries,
    hasNext,
    refetch,
    fetchNextPage: fetchNextPage as () => Promise<void>,
    isLoading: false,
    isRefetching: false,
    isReady: true,
    isFetchingNextPage: false,
    isFetching: false,
    hasNextPage: hasNext,
    error: null,
    type: "local" as const,
    groupedCounts: undefined,
    isOffline: false,
    fetchedTime: undefined,
    queryKey: undefined,
  }
}

const useLocalEntries = (): UseEntriesReturn => {
  const { feedId, view, inboxId, listId, isCollection } = useRouteParams()
  const isPreview = useIsPreviewFeed()
  const unreadOnly = useGeneralSettingKey("unreadOnly")
  const hidePrivateSubscriptionsInTimeline = useGeneralSettingKey(
    "hidePrivateSubscriptionsInTimeline",
  )
  const savedSortOrder = useGeneralSettingKey("timelineSortOrder")
  const effectiveUnreadOnly = unreadOnly && !isPreview
  const effectiveSortOrder = getEffectiveRouteEntrySortOrder({
    sortOrder: savedSortOrder,
    unreadOnly: effectiveUnreadOnly,
    feedId,
    inboxId,
    isCollection,
    isPreview,
  })

  const folderIds = useFolderFeedsByFeedId({
    feedId,
    view,
  })
  const entryIdsByView = useEntryIdsByView(view, hidePrivateSubscriptionsInTimeline)
  const entryIdsByCollections = useCollectionEntryList(view)
  const entryIdsByFeedId = useEntryIdsByFeedId(feedId)
  const entryIdsByCategory = useEntryIdsByFeedIds(folderIds)
  const entryIdsByListId = useEntryIdsByListId(listId)
  const entryIdsByInboxId = useEntryIdsByInboxId(inboxId)

  const showEntriesByView =
    (!feedId || feedId === ROUTE_FEED_PENDING) &&
    folderIds.length === 0 &&
    !isCollection &&
    !inboxId &&
    !listId

  const localQueryKey = useMemo(
    () =>
      [
        feedId || "",
        view,
        inboxId || "",
        listId || "",
        isCollection ? "1" : "0",
        effectiveSortOrder,
      ].join(":"),
    [effectiveSortOrder, feedId, inboxId, isCollection, listId, view],
  )
  const stickyVisibleStateRef = useRef<{
    queryKey: string
    ids: Set<string>
  }>({
    queryKey: localQueryKey,
    ids: new Set<string>(),
  })

  const allEntries = useEntryStore(
    useCallback(
      (state) => {
        const ids = isCollection
          ? entryIdsByCollections
          : showEntriesByView
            ? (entryIdsByView ?? [])
            : (getEntryIdsFromMultiplePlace(
                entryIdsByFeedId,
                entryIdsByCategory,
                entryIdsByListId,
                entryIdsByInboxId,
              ) ?? [])

        const stickyVisibleIds =
          effectiveUnreadOnly && stickyVisibleStateRef.current.queryKey === localQueryKey
            ? stickyVisibleStateRef.current.ids
            : undefined

        return getVisibleLocalEntryIds({
          sourceIds: effectiveSortOrder === "asc" ? [...ids].reverse() : ids,
          entries: state.data,
          stickyVisibleIds,
          unreadOnly: effectiveUnreadOnly,
        })
      },
      [
        entryIdsByCategory,
        entryIdsByCollections,
        entryIdsByFeedId,
        entryIdsByInboxId,
        entryIdsByListId,
        entryIdsByView,
        isCollection,
        localQueryKey,
        showEntriesByView,
        effectiveSortOrder,
        effectiveUnreadOnly,
      ],
    ),
  )

  useEffect(() => {
    stickyVisibleStateRef.current = {
      queryKey: localQueryKey,
      ids: effectiveUnreadOnly ? new Set(allEntries) : new Set<string>(),
    }
  }, [allEntries, effectiveUnreadOnly, localQueryKey])

  const [page, setPage] = useState(0)
  const pageSize = 30
  const entries = useMemo(() => {
    return allEntries?.slice(0, (page + 1) * pageSize) || []
  }, [allEntries, page, pageSize])

  const hasNext = useMemo(() => {
    return entries.length < (allEntries?.length || 0)
  }, [entries.length, allEntries])

  const refetch = useCallback(async () => {
    setPage(0)
  }, [])

  const fetchNextPage = useCallback(
    debounce(async () => {
      setPage(page + 1)
    }, 300),
    [page],
  )

  useEffect(() => {
    setPage(0)
  }, [view, feedId, effectiveSortOrder, effectiveUnreadOnly])

  return {
    entriesIds: entries,
    hasNext,
    refetch,
    fetchNextPage: fetchNextPage as () => Promise<void>,
    isLoading: false,
    isRefetching: false,
    isReady: true,
    isFetchingNextPage: false,
    isFetching: false,
    hasNextPage: hasNext,
    error: null,
  }
}

export const useEntriesByView = ({ onReset }: { onReset?: () => void }) => {
  const { view, listId, timelineId } = useRouteParams()
  const isFocus = timelineId === ROUTE_VIEW_FOCUS

  const remoteQuery = useRemoteEntries()
  const localQuery = useLocalEntries()
  const focusQuery = useFocusEntries({ onReset, enabled: isFocus })

  useFetchEntryContentByStream(isFocus ? focusQuery.entriesIds : remoteQuery.entriesIds)

  // If remote data is not available, we use the local data, get the local data length
  // FIXME: remote first, then local store data
  // NOTE: We still can't use the store's data handling directly.
  // Imagine that the local data may be persistent, and then if there are incremental updates to the data on the server side,
  // then we have no way to incrementally update the data.
  // We need to add an interface to incrementally update the data based on the version hash.

  const query = isFocus ? focusQuery : remoteQuery.isReady ? remoteQuery : localQuery
  const entryIds: string[] = query.entriesIds

  const isFetchingFirstPage = remoteQuery.isFetching && !remoteQuery.isFetchingNextPage

  useEffect(() => {
    if (isFetchingFirstPage) {
      nextFrame(() => {
        onReset?.()
      })
    }
  }, [isFetchingFirstPage, onReset, query.queryKey])

  const groupByDate = useGeneralSettingKey("groupByDate")
  const groupedCounts: number[] | undefined = useMemo(() => {
    const viewDefinition = getView(view)
    if (viewDefinition?.gridMode || view === FeedViewType.All) {
      return
    }
    if (!groupByDate) {
      return
    }
    const entriesId2Map = entryActions.getFlattenMapEntries()
    const counts = [] as number[]
    let lastDate = ""
    for (const id of entryIds) {
      const entry = entriesId2Map[id]
      if (!entry) {
        continue
      }
      if (isOnboardingEntryUrl(entry.url)) {
        continue
      }
      const date = new Date(listId ? entry.insertedAt : entry.publishedAt).toDateString()
      if (date !== lastDate) {
        counts.push(1)
        lastDate = date
      } else {
        const last = counts.pop()
        if (last) counts.push(last + 1)
      }
    }

    return counts
  }, [groupByDate, listId, entryIds, view])

  return {
    ...query,

    type: isFocus
      ? ("local" as const)
      : remoteQuery.isReady
        ? ("remote" as const)
        : ("local" as const),
    refetch: useCallback(() => {
      if (isFocus) return focusQuery.refetch()
      // Until the remote query has succeeded the local query is shown, but a
      // refresh still has to retry the remote request.
      const promise = remoteQuery.isReady
        ? remoteQuery.refetch()
        : Promise.all([remoteQuery.refetch(), localQuery.refetch()]).then(() => {})
      void unreadSyncService.refresh({ calibrate: true })
      return promise
    }, [focusQuery, isFocus, localQuery, remoteQuery]),
    entriesIds: entryIds,
    groupedCounts: isFocus ? undefined : groupedCounts,
    isFetching: isFocus ? false : remoteQuery.isFetching,
    isFetchingNextPage: isFocus ? false : remoteQuery.isFetchingNextPage,
    isLoading: isFocus ? false : remoteQuery.isLoading,
    isOffline: isFocus ? false : remoteQuery.isOffline === true,
    error: isFocus ? null : remoteQuery.error,
  }
}

const useFetchEntryContentByStream = (remoteEntryIds?: string[]) => {
  const { mutate: updateEntryContent } = useMutation({
    mutationKey: ["stream-entry-content", remoteEntryIds],
    mutationFn: (remoteEntryIds: string[]) =>
      entrySyncServices.fetchEntryContentByStream(remoteEntryIds),
  })

  useEffect(() => {
    if (!remoteEntryIds) return
    updateEntryContent(remoteEntryIds)
  }, [remoteEntryIds, updateEntryContent])
}

import { useGlobalFocusableScopeSelector } from "@follow/components/common/Focusable/hooks.js"
import { ActionButton } from "@follow/components/ui/button/index.js"
import { RootPortal } from "@follow/components/ui/portal/index.js"
import { FeedViewType } from "@follow/constants"
import { useTypeScriptHappyCallback } from "@follow/hooks"
import { ELECTRON_BUILD } from "@follow/shared/constants"
import { useFeedsByIds } from "@follow/store/feed/hooks"
import { useAllFeedSubscription, usePrefetchSubscription } from "@follow/store/subscription/hooks"
import { usePrefetchUnread } from "@follow/store/unread/hooks"
import { useIsLoggedIn, useUserSubscriptionLimit } from "@follow/store/user/hooks"
import { EventBus } from "@follow/utils/event-bus"
import { clamp, cn } from "@follow/utils/utils"
import { useWheel } from "@use-gesture/react"
import { Lethargy } from "lethargy"
import type { FC, PropsWithChildren } from "react"
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Trans, useTranslation } from "react-i18next"

import { useRootContainerElement } from "~/atoms/dom"
import { useIsInMASReview } from "~/atoms/server-configs"
import { setTimelineColumnShow, useSubscriptionColumnShow } from "~/atoms/sidebar"
import { Focusable } from "~/components/common/Focusable"
import { HotkeyScope, ROUTE_VIEW_FOCUS } from "~/constants"
import { useBackHome } from "~/hooks/biz/useNavigateEntry"
import { parseView, useRouteParamsSelector } from "~/hooks/biz/useRouteParams"
import { useTimelineTabs } from "~/hooks/biz/useTimelineList"
import { useSettingModal } from "~/modules/settings/modal/useSettingModal"

import { WindowUnderBlur } from "../../components/ui/background"
import { COMMAND_ID } from "../command/commands/id"
import { useCommandBinding } from "../command/hooks/use-command-binding"
import { getSelectedFeedIds, resetSelectedFeedIds, setSelectedFeedIds } from "./atom"
import { useShouldFreeUpSpace } from "./hook"
import { SubscriptionListGuard } from "./subscription-list/SubscriptionListGuard"
import { SubscriptionColumnHeader } from "./SubscriptionColumnHeader"
import { SubscriptionTabButton } from "./SubscriptionTabButton"

const lethargy = new Lethargy()

export function SubscriptionColumn({
  children,
  className,
}: PropsWithChildren<{ className?: string }>) {
  const { t } = useTranslation()
  const {
    isLoading: isSubscriptionLoading,
    isError: isSubscriptionError,
    isFetching: isSubscriptionFetching,
    refetch: refetchSubscription,
  } = usePrefetchSubscription()
  const isLoggedIn = useIsLoggedIn()
  // Guests can't load subscriptions at all, which is not an error to show them
  const subscriptionLoadError = useMemo(
    () =>
      isSubscriptionError && isLoggedIn
        ? { isRetrying: isSubscriptionFetching, onRetry: () => void refetchSubscription() }
        : undefined,
    [isSubscriptionError, isLoggedIn, isSubscriptionFetching, refetchSubscription],
  )
  usePrefetchUnread()

  const carouselRef = useRef<HTMLDivElement>(null)
  const timelineList = useTimelineTabs()
  // 顶部 tab 栏不展示「重点关注」（ROUTE_VIEW_FOCUS）：重点关注只通过底部订阅列表的
  // FocusItem 进入。SwipeWrapper 仍用完整 timelineList 渲染 focus 视图内容。
  const tabList = useMemo(
    () => timelineList.filter((id) => id !== ROUTE_VIEW_FOCUS),
    [timelineList],
  )

  const routeParams = useRouteParamsSelector((s) => ({
    timelineId: s.timelineId,
    view: s.view,
    listId: s.listId,
  }))

  const [timelineId, setMemoizedTimelineId] = useState(routeParams.timelineId ?? timelineList[0])

  useEffect(() => {
    if (routeParams.timelineId) setMemoizedTimelineId(routeParams.timelineId)
  }, [routeParams.timelineId])

  const navigateBackHome = useBackHome(timelineId)
  const setActive = useCallback(
    (args: string | ((prev: string | undefined, index: number) => string)) => {
      let nextActive
      if (typeof args === "function") {
        const index = timelineId ? tabList.indexOf(timelineId) : 0
        nextActive = args(timelineId, index)
      } else {
        nextActive = args
      }

      navigateBackHome(nextActive)
      resetSelectedFeedIds()
    },
    [navigateBackHome, tabList, timelineId],
  )

  useWheel(
    ({ event, last, memo: wait = false, direction: [dx], delta: [dex] }) => {
      if (!last) {
        const s = lethargy.check(event)
        if (s) {
          if (!wait && Math.abs(dex) > 20) {
            setActive((_, i) => tabList[clamp(i + dx, 0, tabList.length - 1)]!)
            return true
          } else {
            return
          }
        } else {
          return false
        }
      } else {
        return false
      }
    },
    { target: carouselRef },
  )

  const shouldFreeUpSpace = useShouldFreeUpSpace()
  const feedColumnShow = useSubscriptionColumnShow()
  const rootContainerElement = useRootContainerElement()

  const focusableContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!focusableContainerRef.current) return
    // Keep the focus a page took while loading, such as the autofocused Discover search box
    const { activeElement } = document
    if (activeElement && activeElement !== document.body) return
    focusableContainerRef.current.focus()
  }, [])

  return (
    <WindowUnderBlur
      as={Focusable}
      scope={HotkeyScope.SubscriptionList}
      data-hide-in-print
      className={cn(
        !feedColumnShow && ELECTRON_BUILD && "bg-material-opaque",
        "relative flex h-full flex-col pt-2.5",
        className,
      )}
      ref={focusableContainerRef}
      onClick={useCallback(async () => {
        if (document.hasFocus()) {
          navigateBackHome()
        }
      }, [navigateBackHome])}
    >
      <CommandsHandler setActive={setActive} timelineList={tabList} />
      <SubscriptionColumnHeader />
      {!feedColumnShow && (
        <RootPortal to={rootContainerElement}>
          <ActionButton
            tooltip={t("app.toggle_sidebar")}
            className="center absolute left-0 top-2.5 z-0 hidden -translate-x-2 text-zinc-500 macos:flex macos:left-macos-traffic-light-2"
            onClick={() => setTimelineColumnShow(true)}
          >
            <i className="i-mgc-layout-leftbar-open-cute-re" />
          </ActionButton>
        </RootPortal>
      )}

      <div className="relative mb-2 mt-3">
        <TabsRow />
      </div>
      <SubscriptionLimitNotice />
      <div
        className={cn("relative mt-1 flex size-full", !shouldFreeUpSpace && "overflow-hidden")}
        ref={carouselRef}
        onPointerDown={useTypeScriptHappyCallback((e) => {
          if (!(e.target instanceof HTMLElement) || !e.target.closest("[data-feed-id]")) {
            const nextSelectedFeedIds = getSelectedFeedIds()
            if (nextSelectedFeedIds.length === 0) {
              setSelectedFeedIds(nextSelectedFeedIds)
            } else {
              resetSelectedFeedIds()
            }
          }
        }, [])}
      >
        <SwipeWrapper active={timelineId!}>
          {timelineList.map((timelineId) => (
            <section key={timelineId} className="h-full w-feed-col shrink-0 snap-center">
              <SubscriptionListGuard
                key={timelineId}
                view={parseView(timelineId) ?? FeedViewType.Articles}
                isSubscriptionLoading={isSubscriptionLoading}
                subscriptionLoadError={subscriptionLoadError}
              />
            </section>
          ))}
        </SwipeWrapper>
      </div>

      {children}
    </WindowUnderBlur>
  )
}

const SwipeWrapper: FC<{ active: string; children: React.JSX.Element[] }> = memo(
  ({ children, active }) => {
    const timelineList = useTimelineTabs()
    const viewIndex = timelineList.indexOf(active)

    const orderIndex = timelineList.indexOf(active)

    const prevOrderIndexRef = useRef(-1)
    const [currentAnimtedActive, setCurrentAnimatedActive] = useState(viewIndex)

    useLayoutEffect(() => {
      prevOrderIndexRef.current = orderIndex
      setTimeout(() => {
        setCurrentAnimatedActive(viewIndex)
      }, 0)
    }, [orderIndex, viewIndex])

    // 产品要求：第一栏 tab 之间切换一律直接切换，不做左右滑动动画。
    return <div>{children[currentAnimtedActive]}</div>
  },
)

const TabsRow: FC = () => {
  const tabList = useTimelineTabs().filter((id) => id !== ROUTE_VIEW_FOCUS)

  return (
    <div className="flex h-11 items-center px-1 text-xl text-text-secondary">
      {tabList.map((timelineId, index) => (
        <SubscriptionTabButton key={timelineId} timelineId={timelineId} shortcut={`${index + 1}`} />
      ))}
    </div>
  )
}

const SubscriptionLimitNotice: FC = () => {
  const feedSubscriptions = useAllFeedSubscription()
  const { feedLimit, rsshubLimit } = useUserSubscriptionLimit()
  const openSettings = useSettingModal()
  const isInMASReview = useIsInMASReview()

  const feedIds = useMemo(
    () =>
      feedSubscriptions
        .map((subscription) => subscription?.feedId)
        .filter((feedId): feedId is string => typeof feedId === "string" && feedId.length > 0),
    [feedSubscriptions],
  )

  const feeds = useFeedsByIds(feedIds)

  const feedCount = feedSubscriptions.length
  const rsshubCount = useMemo(() => {
    if (!feeds || feeds.length === 0) return 0
    return feeds.reduce((count, feed) => {
      if (!feed?.url) return count
      return feed.url.startsWith("rsshub://") ? count + 1 : count
    }, 0)
  }, [feeds])

  const exceededFeed = typeof feedLimit === "number" && feedCount > feedLimit
  const exceededRSSHub = typeof rsshubLimit === "number" && rsshubCount > rsshubLimit
  if (!exceededFeed && !exceededRSSHub) {
    return null
  }
  if (isInMASReview) {
    return null
  }

  return (
    <button
      type="button"
      onClick={() => openSettings("plan")}
      className="my-1 flex items-start gap-2 border-red/30 bg-red/10 px-1.5 py-2 text-left text-xs leading-snug text-red transition-colors hover:border-red hover:bg-red/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-red/40"
    >
      <span className="ml-1 text-lg">😢</span>
      <p>
        <Trans
          i18nKey="subscription_limit_warning"
          values={{
            feedCount,
            rsshubCount,
            feedLimit,
            rsshubLimit,
          }}
          components={{
            b: <b key="b" />,
            br: <br key="br" />,
          }}
        />
      </p>
    </button>
  )
}

const CommandsHandler = ({
  setActive,
  timelineList,
}: {
  setActive: (args: string | ((prev: string | undefined, index: number) => string)) => void
  timelineList: string[]
}) => {
  const when = useGlobalFocusableScopeSelector(
    useCallback(
      (activeScope) =>
        activeScope.or(HotkeyScope.SubscriptionList, HotkeyScope.Timeline) ||
        activeScope.size === 0,
      [],
    ),
  )

  useCommandBinding({
    commandId: COMMAND_ID.subscription.switchTabToNext,
    when,
  })

  useCommandBinding({
    commandId: COMMAND_ID.subscription.switchTabToPrevious,
    when,
  })

  useEffect(() => {
    return EventBus.subscribe(COMMAND_ID.subscription.switchTabToNext, () => {
      setActive((_, i) => timelineList[(i + 1) % timelineList.length]!)
    })
  }, [setActive, timelineList])

  useEffect(() => {
    return EventBus.subscribe(COMMAND_ID.subscription.switchTabToPrevious, () => {
      setActive((_, i) => timelineList[(i - 1 + timelineList.length) % timelineList.length]!)
    })
  }, [setActive, timelineList])

  return null
}

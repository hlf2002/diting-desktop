import { useEntryStore } from "@follow/store/entry/store"
import { focusActions, useFocusStore } from "@follow/store/focus/store"
import { atom, useAtomValue } from "jotai"
import { useCallback, useEffect, useRef } from "react"

import { getAISettings } from "~/atoms/settings/ai"

import { analyzeEntriesForFocus, extractPlainText } from "./focus-analyzer"

/** Number of most-recent unscored entries to backfill when the criteria change. */
const FOCUS_RETRO_LIMIT = 100

/** Bump to ask the analyzer to re-score the most recent entries (saved criteria). */
export const focusRetroAnalyzeTriggerAtom = atom(0)

/** The most recent entry ids still present in the entry store, newest first. */
const getRecentEntryIds = (limit: number): string[] => {
  const data = useEntryStore.getState().data
  return Object.entries(data)
    .sort(([, a], [, b]) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, limit)
    .map(([id]) => id)
}

/**
 * Watches the entry store for new arrivals and scores them against the user's
 * focus criteria with their BYOK provider.
 *
 * - Historical entries present on first enable are skipped (marked as analyzed)
 *   so the feature only scores content fetched after it was turned on — unless
 *   the user already filled in criteria, in which case the most recent entries
 *   are backfilled so the tab is not empty on day one.
 * - New arrivals are debounced into a small number of batches.
 * - Entries without any title/description are marked analyzed without a request.
 * - Missing criteria / provider skips scoring but keeps entries pending, so
 *   configuring them later starts scoring the next arrivals.
 */
export const useFocusAnalyzer = () => {
  const pendingRef = useRef<string[]>([])
  const runningRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const retroTrigger = useAtomValue(focusRetroAnalyzeTriggerAtom)

  const drain = useCallback(async () => {
    if (runningRef.current) return
    runningRef.current = true
    try {
      while (pendingRef.current.length > 0) {
        const batch = pendingRef.current.splice(0, 50)
        const analyzed = useFocusStore.getState().analyzedEntryIds
        const unseen = batch.filter((id) => !analyzed.has(id))
        if (unseen.length === 0) continue

        const data = useEntryStore.getState().data
        const candidates = unseen
          .map((id) => {
            const entry = data[id]
            return { id, title: entry?.title, description: entry?.description }
          })
          .filter((candidate) => Boolean(candidate.title || candidate.description))
        const contentless = unseen.filter((id) => !data[id]?.title && !data[id]?.description)
        if (contentless.length > 0) {
          await focusActions.persistAnalyzed(contentless, [])
        }
        if (candidates.length === 0) continue

        const result = await analyzeEntriesForFocus(candidates)
        if (result.skipped) {
          // Criteria or BYOK provider not ready yet: put the batch back and stop
          // draining. A later enqueue (new entries) retries these too, so entries
          // that arrived before the provider was configured are not lost.
          pendingRef.current.unshift(...batch)
          break
        }
        if (result.analyzedIds.length > 0) {
          focusActions.markAnalyzedInSession(result.analyzedIds, result.matchedIds)
          await focusActions.persistAnalyzed(result.analyzedIds, result.matchedIds)
        }
      }
    } finally {
      runningRef.current = false
    }
  }, [])

  const enqueue = useCallback(
    (entryIds: string[]) => {
      pendingRef.current.push(...entryIds)
      clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => void drain(), 2000)
    },
    [drain],
  )

  useEffect(() => {
    // First enable: treat everything already stored as scored so only new
    // arrivals are analyzed (no historical backfill, no token spend) — unless
    // the user already wrote focus criteria, in which case backfill the most
    // recent entries so the tab is populated from day one.
    const baseline = async () => {
      const analyzed = useFocusStore.getState().analyzedEntryIds
      if (analyzed.size > 0) return
      const existing = useEntryStore.getState().entryIdSet
      if (existing.size === 0) return
      if (extractPlainText(getAISettings().personalizePrompt)) {
        const recentIds = getRecentEntryIds(FOCUS_RETRO_LIMIT)
        if (recentIds.length > 0) enqueue(recentIds)
        return
      }
      await focusActions.markExistingAsAnalyzed([...existing])
    }
    void baseline()

    const lastKnown = new Set(useEntryStore.getState().entryIdSet)
    return useEntryStore.subscribe((state, prevState) => {
      if (state.entryIdSet.size <= prevState.entryIdSet.size) return
      const newIds = [...state.entryIdSet].filter((id) => !lastKnown.has(id))
      lastKnown.clear()
      for (const id of state.entryIdSet) lastKnown.add(id)
      if (newIds.length > 0) enqueue(newIds)
    })
  }, [enqueue])

  // When the user saves/changes their focus criteria, re-score the most recent
  // entries so the effect is visible immediately instead of waiting for new arrivals.
  useEffect(() => {
    if (retroTrigger === 0) return
    void (async () => {
      const recentIds = getRecentEntryIds(FOCUS_RETRO_LIMIT)
      if (recentIds.length === 0) return
      await focusActions.unmarkAnalyzed(recentIds)
      enqueue(recentIds)
    })()
  }, [enqueue, retroTrigger])

  useEffect(
    () => () => {
      clearTimeout(timeoutRef.current)
    },
    [],
  )
}

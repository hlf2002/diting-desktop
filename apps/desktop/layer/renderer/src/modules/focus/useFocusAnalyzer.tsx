import { useEntryStore } from "@follow/store/entry/store"
import { focusActions, useFocusStore } from "@follow/store/focus/store"
import { useCallback, useEffect, useRef } from "react"

import { analyzeEntriesForFocus } from "./focus-analyzer"

/**
 * Watches the entry store for new arrivals and scores them against the user's
 * focus criteria with their BYOK provider.
 *
 * - Historical entries present on first enable are skipped (marked as analyzed)
 *   so the feature only scores content fetched after it was turned on.
 * - New arrivals are debounced into a small number of batches.
 * - Entries without any title/description are marked analyzed without a request.
 * - Missing criteria / provider skips scoring but keeps entries pending, so
 *   configuring them later starts scoring the next arrivals.
 */
export const useFocusAnalyzer = () => {
  const pendingRef = useRef<string[]>([])
  const runningRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

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
        if (result.skipped) continue
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
    // arrivals are analyzed (no historical backfill, no token spend).
    const baseline = async () => {
      const analyzed = useFocusStore.getState().analyzedEntryIds
      if (analyzed.size > 0) return
      const existing = useEntryStore.getState().entryIdSet
      if (existing.size > 0) {
        await focusActions.markExistingAsAnalyzed([...existing])
      }
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

  useEffect(
    () => () => {
      clearTimeout(timeoutRef.current)
    },
    [],
  )
}

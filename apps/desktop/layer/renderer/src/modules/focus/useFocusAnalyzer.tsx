import { FocusService } from "@follow/database/services/focus"
import { useEntryStore } from "@follow/store/entry/store"
import { focusActions, useFocusStore } from "@follow/store/focus/store"
import { atom, useAtomValue, useSetAtom } from "jotai"
import { useCallback, useEffect, useRef } from "react"

import { getAISettings } from "~/atoms/settings/ai"

import {
  analyzeEntriesForFocus,
  describeFocusError,
  explainFocusMatches,
  extractPlainText,
} from "./focus-analyzer"

/** Number of most-recent unscored entries to backfill when the criteria change. */
const FOCUS_RETRO_LIMIT = 100

/** Max focus entries to backfill reasons for per run (avoids one huge AI bill). */
const FOCUS_REASON_BACKFILL_LIMIT = 100

/** Entries scored per batch during the explicit full re-analysis. */
const FULL_REANALYZE_BATCH = 50

/** Bump to ask the analyzer to re-score the most recent entries (saved criteria). */
export const focusRetroAnalyzeTriggerAtom = atom(0)

/** Bump to ask the analyzer to re-score EVERY entry in the store (full re-analysis). */
export const focusFullReanalyzeTriggerAtom = atom(0)

export interface FocusReanalyzeProgress {
  /** Entries the current full re-analysis will score. */
  total: number
  /** Entries already scored by the current run. */
  done: number
  /** True while a full re-analysis is in flight. */
  running: boolean
  /** Entries the provider rejected (retried by the next run). */
  failed: number
  /** Last failure reason (HTTP status / timeout) — shown next to the bar so a
   *  stalled run never looks like a frozen progress bar. */
  lastError?: string
}

/** Progress of the explicit full re-analysis — drives the settings progress bar. */
export const focusReanalyzeProgressAtom = atom<FocusReanalyzeProgress>({
  total: 0,
  done: 0,
  running: false,
  failed: 0,
})

/** Consecutive fully-failed batches before a full re-analysis aborts (3 × 50 = 150 entries). */
const FULL_REANALYZE_MAX_CONSECUTIVE_FAILURES = 3

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
  const reasonPendingRef = useRef<string[]>([])
  const runningRef = useRef(false)
  /** Set while the explicit full re-analysis owns the AI provider. */
  const fullRunningRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const retroTrigger = useAtomValue(focusRetroAnalyzeTriggerAtom)
  const fullReanalyzeTrigger = useAtomValue(focusFullReanalyzeTriggerAtom)
  const setProgress = useSetAtom(focusReanalyzeProgressAtom)

  const drain = useCallback(async () => {
    // The full re-analysis drives its own loop; don't let both hammer the provider.
    if (runningRef.current || fullRunningRef.current) return
    runningRef.current = true
    try {
      while (pendingRef.current.length > 0 || reasonPendingRef.current.length > 0) {
        if (pendingRef.current.length > 0) {
          const batch = pendingRef.current.splice(0, 50)
          const analyzed = useFocusStore.getState().analyzedEntryIds
          const unseen = batch.filter((id) => !analyzed.has(id))
          if (unseen.length === 0) continue

          const data = useEntryStore.getState().data
          const candidates = unseen
            .map((id) => {
              const entry = data[id]
              return {
                id,
                feedId: entry?.feedId,
                title: entry?.title,
                description: entry?.description,
              }
            })
            .filter((candidate) => Boolean(candidate.title || candidate.description))
          const contentless = unseen.filter((id) => !data[id]?.title && !data[id]?.description)
          if (contentless.length > 0) {
            await focusActions.persistAnalyzed(contentless, [])
          }
          if (candidates.length === 0) continue

          const result = await analyzeEntriesForFocus(candidates)
          if (result.skipped) {
            // Criteria or BYOK provider not ready yet: mark the batch as unjudged so the
            // reader shows a "未判定" placeholder card pointing to AI settings. Do NOT put
            // the batch back on pendingRef — we don't want to re-drain it repeatedly; the
            // retro trigger (when the user saves criteria) will re-enqueue them.
            focusActions.markUnjudged(unseen)
            break
          }
          if (result.failedIds && result.failedIds.length > 0) {
            // Provider/network errors: put the whole batch back and stop draining.
            // It will be retried on the next enqueue; otherwise a single bad
            // response would permanently drop the batch and the tab stays empty.
            pendingRef.current.unshift(...batch)
            break
          }
          if (result.analyzedIds.length > 0) {
            focusActions.markAnalyzedInSession(
              result.analyzedIds,
              result.matchedIds,
              result.matchedReasons,
              result.scores,
            )
            await focusActions.persistAnalyzed(
              result.analyzedIds,
              result.matchedIds,
              result.matchedReasons,
              result.scores,
            )
          }
        }

        // Backfill reasons for entries flagged as focus before reasons existed.
        // Entries that get a concrete reason stay in the focus set; entries the
        // AI cannot explain are dropped (a focus mark without a reason is not a
        // match — no generic fallback copy is ever shown).
        if (reasonPendingRef.current.length > 0) {
          const reasonBatch = reasonPendingRef.current.splice(0, 20)
          const { focusReasons } = useFocusStore.getState()
          const stillMissing = reasonBatch.filter((id) => !focusReasons[id])
          if (stillMissing.length === 0) continue
          const data = useEntryStore.getState().data
          const withContent = stillMissing.filter(
            (id) => Boolean(data[id]?.title) || Boolean(data[id]?.description),
          )
          const contentless = stillMissing.filter(
            (id) => !data[id]?.title && !data[id]?.description,
          )
          if (contentless.length > 0) {
            // No title/description means the AI has nothing to explain against:
            // drop these from the focus set.
            await focusActions.removeFocus(contentless)
          }
          if (withContent.length === 0) continue
          const candidates = withContent.map((id) => ({
            id,
            feedId: data[id]?.feedId,
            title: data[id]?.title,
            description: data[id]?.description,
          }))

          const result = await explainFocusMatches(candidates)
          if (result.skipped) {
            // No criteria / no provider: no request was made. Keep the batch for
            // a later drain (configuring the provider later starts backfilling).
            reasonPendingRef.current.unshift(...stillMissing)
            break
          }
          if (result.failedIds && result.failedIds.length > 0) {
            reasonPendingRef.current.unshift(...stillMissing)
            break
          }
          if (Object.keys(result.reasons).length > 0) {
            focusActions.applyReasonsInSession(result.reasons)
            await focusActions.persistReasons(result.reasons)
          }
          const unexplained = withContent.filter((id) => !result.reasons[id])
          if (unexplained.length > 0) {
            // The AI matched the batch but gave no reason for these entries:
            // treat them as not matching and drop them from the focus set.
            await focusActions.removeFocus(unexplained)
          }
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

  // Backfill concrete reasons for legacy focus marks scored before reasons
  // existed. Entries that get a reason stay in the focus set; entries the AI
  // cannot explain are dropped — no focus mark without a reason survives.
  useEffect(() => {
    let cancelled = false
    const enqueueMissingReasons = async () => {
      try {
        const rows = await FocusService.getUnreasonedFocusEntryIds()
        if (cancelled) return
        const alreadyQueued = new Set(reasonPendingRef.current)
        const missing = rows
          .map((row) => row.entryId)
          .filter((id) => !alreadyQueued.has(id))
          .slice(0, FOCUS_REASON_BACKFILL_LIMIT)
        if (missing.length > 0) {
          reasonPendingRef.current.push(...missing)
          clearTimeout(timeoutRef.current)
          timeoutRef.current = setTimeout(() => void drain(), 2000)
        }
      } catch (error) {
        console.error("[focus-analyzer] failed to load legacy focus marks", error)
      }
    }
    void enqueueMissingReasons()
    return () => {
      cancelled = true
    }
  }, [drain])

  // When the user saves/changes their focus criteria, re-score the most recent
  // entries so the effect is visible immediately instead of waiting for new arrivals.
  useEffect(() => {
    if (retroTrigger === 0) return
    void (async () => {
      const recentIds = getRecentEntryIds(FOCUS_RETRO_LIMIT)
      if (recentIds.length === 0) return
      await focusActions.unmarkAnalyzed(recentIds)
      // Also clear the unjudged flag so entries that were waiting for config get re-scored.
      focusActions.unmarkUnjudged(recentIds)
      enqueue(recentIds)
    })()
  }, [enqueue, retroTrigger])

  // Full re-analysis: the user explicitly asked to re-score EVERY article stored
  // on this device with the current model (e.g. after switching to the decision
  // engine). The entry store only holds what the timeline has loaded, so the
  // library is read from the local database; progress is reported batch by batch
  // through focusReanalyzeProgressAtom (the settings section renders the bar).
  useEffect(() => {
    if (fullReanalyzeTrigger === 0) return
    void (async () => {
      const rows = await FocusService.getReanalyzeCandidates()
      if (rows.length === 0) {
        setProgress({ total: 0, done: 0, running: false, failed: 0 })
        return
      }

      const allIds = rows.map((row) => row.id)
      fullRunningRef.current = true
      setProgress({ total: rows.length, done: 0, running: true, failed: 0 })
      let done = 0
      let failed = 0
      let lastError: string | undefined
      // A dead provider must not burn through the whole library: after 3 fully
      // failed batches in a row the run stops and reports the reason, instead of
      // looking frozen while every batch waits out a 60s timeout ×3.
      let consecutiveFailures = 0
      try {
        await focusActions.unmarkAnalyzed(allIds)
        focusActions.unmarkUnjudged(allIds)

        // Report at most ~100 progress updates: a large library means thousands
        // of small batches and every atom write re-renders the settings page.
        // Failed entries advance the bar too — a run whose `done` stops growing
        // (provider throttling / outage) used to look frozen at its last percent.
        const reportEvery = Math.max(FULL_REANALYZE_BATCH, Math.ceil(rows.length / 100))
        let reportedProgress = 0
        for (let i = 0; i < rows.length; i += FULL_REANALYZE_BATCH) {
          const batch = rows.slice(i, i + FULL_REANALYZE_BATCH)
          let batchDone = 0
          let batchFailed = 0
          let batchError: string | undefined
          try {
            const contentless = batch.filter((row) => !row.title && !row.description)
            if (contentless.length > 0) {
              // Nothing for the AI to judge: mark them scored so they drop out of
              // the queue, exactly like the incremental drain does.
              const ids = contentless.map((row) => row.id)
              await focusActions.persistAnalyzed(ids, [])
              batchDone += ids.length
            }

            const candidates = batch
              .filter((row) => Boolean(row.title || row.description))
              .map((row) => ({
                id: row.id,
                feedId: row.feedId,
                title: row.title,
                description: row.description,
              }))

            if (candidates.length > 0) {
              const result = await analyzeEntriesForFocus(candidates)
              if (result.skipped) {
                // No criteria / no usable provider: stop the run instead of
                // burning through the library with nothing to score against.
                setProgress({ total: rows.length, done, running: false, failed, lastError })
                return
              }
              if (result.lastError) batchError = result.lastError
              if (result.analyzedIds.length > 0) {
                focusActions.markAnalyzedInSession(
                  result.analyzedIds,
                  result.matchedIds,
                  result.matchedReasons,
                  result.scores,
                )
                await focusActions.persistAnalyzed(
                  result.analyzedIds,
                  result.matchedIds,
                  result.matchedReasons,
                  result.scores,
                )
              }
              batchDone += result.analyzedIds.length
              batchFailed += result.failedIds.length
              // Failed ids stay unscored (no DB write) so the next full run picks
              // them up again; pushing them into the incremental drain would let
              // the drain mark them "contentless" for entries not in the store.
            }
          } catch (error) {
            // A single batch blowing up (local DB write, unexpected provider
            // error) must not kill the whole run and leave the bar stuck.
            console.error("[focus-analyzer] re-analysis batch failed", error)
            batchError = describeFocusError(error)
            batchFailed += Math.max(0, batch.length - batchDone)
          }

          done += batchDone
          failed += batchFailed
          if (batchError) lastError = batchError
          const batchFullyFailed = batchFailed > 0 && batchDone === 0
          consecutiveFailures = batchFullyFailed ? consecutiveFailures + 1 : 0

          if (done + failed - reportedProgress >= reportEvery) {
            reportedProgress = done + failed
            setProgress({ total: rows.length, done, running: true, failed, lastError })
          }

          if (consecutiveFailures >= FULL_REANALYZE_MAX_CONSECUTIVE_FAILURES) {
            console.error(
              `[focus-analyzer] re-analysis aborted after ${consecutiveFailures} failed batches:`,
              lastError,
            )
            break
          }
        }
      } finally {
        fullRunningRef.current = false
        setProgress({ total: rows.length, done, running: false, failed, lastError })
        if (pendingRef.current.length > 0) void drain()
      }
    })()
  }, [drain, fullReanalyzeTrigger, setProgress])

  useEffect(
    () => () => {
      clearTimeout(timeoutRef.current)
    },
    [],
  )
}

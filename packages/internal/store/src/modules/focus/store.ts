import { FocusService } from "@follow/database/services/focus"

import type { Hydratable, Resetable } from "../../lib/base"
import { createZustandStore } from "../../lib/helper"

export type FocusEntryId = string

interface FocusState {
  focusEntryIds: Set<FocusEntryId>
  analyzedEntryIds: Set<FocusEntryId>
  /** EntryIds waiting to be analyzed because focus criteria or BYOK provider is not yet configured.
   *  These are not scored (not in analyzedEntryIds) — they show an "未判定" placeholder card
   *  that links to AI settings until the user configures criteria/provider. */
  unjudgedEntryIds: Set<FocusEntryId>
  /** entryId → why it matched the focus criteria (from the on-device AI). */
  focusReasons: Record<string, string>
  /** entryId → decision-model score (noul probability 0~1) at scoring time. */
  focusScores: Record<string, number>
}

const defaultState: FocusState = {
  focusEntryIds: new Set(),
  analyzedEntryIds: new Set(),
  unjudgedEntryIds: new Set(),
  focusReasons: {},
  focusScores: {},
}

export const useFocusStore = createZustandStore<FocusState>("focus")(() => defaultState)

const set = useFocusStore.setState

class FocusActions implements Hydratable, Resetable {
  async hydrate() {
    const [focusRows, analyzedRows] = await Promise.all([
      FocusService.getFocusEntryIds(),
      FocusService.getAnalyzedEntryIds(),
    ])
    set({
      // Only entries with a concrete reason count as "重点关注": a focus mark
      // without a reason would otherwise render a generic fallback card.
      focusEntryIds: new Set(focusRows.filter((row) => row.reason).map((row) => row.entryId)),
      analyzedEntryIds: new Set(analyzedRows.map((row) => row.entryId)),
      focusReasons: Object.fromEntries(
        focusRows.filter((row) => row.reason).map((row) => [row.entryId, row.reason!]),
      ),
      focusScores: Object.fromEntries(
        analyzedRows.filter((row) => row.score != null).map((row) => [row.entryId, row.score!]),
      ),
    })
  }

  async reset() {
    await FocusService.reset()
    set(defaultState)
  }

  /** Mark entries as unjudged (waiting for criteria/provider config) — renders the placeholder card. */
  markUnjudged(entryIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    set((state) => {
      const next = new Set(state.unjudgedEntryIds)
      for (const id of entryIds) next.add(id)
      return { unjudgedEntryIds: next }
    })
  }

  /**
   * Clear the unjudged flag for entries (called when the user configures criteria/provider
   * so we can re-analyze them; also called when they get actually scored).
   */
  unmarkUnjudged(entryIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    set((state) => {
      const next = new Set(state.unjudgedEntryIds)
      for (const id of entryIds) next.delete(id)
      return { unjudgedEntryIds: next }
    })
  }

  /** Score results are applied in memory first, then persisted. */
  markAnalyzedInSession(
    entryIds: FocusEntryId[],
    focusIds: FocusEntryId[],
    focusReasons: Record<string, string> = {},
    focusScores: Record<string, number> = {},
  ) {
    set((state) => {
      const nextAnalyzed = new Set(state.analyzedEntryIds)
      const nextFocus = new Set(state.focusEntryIds)
      const nextUnjudged = new Set(state.unjudgedEntryIds)
      const nextReasons = { ...state.focusReasons }
      const nextScores = { ...state.focusScores }
      for (const id of entryIds) {
        nextAnalyzed.add(id)
        nextUnjudged.delete(id)
      }
      for (const id of focusIds) nextFocus.add(id)
      for (const id of entryIds) {
        if (focusScores[id] != null) nextScores[id] = focusScores[id]
        if (nextFocus.has(id)) {
          if (focusReasons[id]) nextReasons[id] = focusReasons[id]
        } else {
          delete nextReasons[id]
        }
      }
      return {
        analyzedEntryIds: nextAnalyzed,
        focusEntryIds: nextFocus,
        unjudgedEntryIds: nextUnjudged,
        focusReasons: nextReasons,
        focusScores: nextScores,
      }
    })
  }

  /** Persist score results to the local database. */
  async persistAnalyzed(
    entryIds: FocusEntryId[],
    focusIds: FocusEntryId[],
    focusReasons: Record<string, string> = {},
    focusScores: Record<string, number> = {},
  ) {
    if (entryIds.length === 0) return
    const focusSet = new Set(focusIds)
    const nonFocusIds = entryIds.filter((id) => !focusSet.has(id))
    if (nonFocusIds.length > 0) {
      await FocusService.markAnalyzed(nonFocusIds, false, {}, focusScores)
    }
    if (focusIds.length > 0) {
      await FocusService.markAnalyzed(focusIds, true, focusReasons, focusScores)
    }
  }

  /** Mark historical entries as analyzed so the scorer only sees new arrivals. */
  async markExistingAsAnalyzed(entryIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    set((state) => {
      const nextAnalyzed = new Set(state.analyzedEntryIds)
      for (const id of entryIds) nextAnalyzed.add(id)
      return { analyzedEntryIds: nextAnalyzed }
    })
    await FocusService.markAnalyzedKeepFocus(entryIds)
  }

  /** Forget score results for entries so the scorer re-runs on them (retro backfill). */
  async unmarkAnalyzed(entryIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    set((state) => {
      const nextAnalyzed = new Set(state.analyzedEntryIds)
      const nextFocus = new Set(state.focusEntryIds)
      const nextUnjudged = new Set(state.unjudgedEntryIds)
      const nextReasons = { ...state.focusReasons }
      const nextScores = { ...state.focusScores }
      for (const id of entryIds) {
        nextAnalyzed.delete(id)
        nextFocus.delete(id)
        nextUnjudged.delete(id)
        delete nextReasons[id]
        delete nextScores[id]
      }
      return {
        analyzedEntryIds: nextAnalyzed,
        focusEntryIds: nextFocus,
        unjudgedEntryIds: nextUnjudged,
        focusReasons: nextReasons,
        focusScores: nextScores,
      }
    })
    await FocusService.deleteMany(entryIds)
  }

  /** Apply backfilled reasons, promoting entries into the focus set. */
  applyReasonsInSession(reasons: Record<string, string>) {
    set((state) => {
      const nextFocus = new Set(state.focusEntryIds)
      const nextReasons = { ...state.focusReasons }
      for (const [id, reason] of Object.entries(reasons)) {
        if (!reason) continue
        nextFocus.add(id)
        nextReasons[id] = reason
      }
      return { focusEntryIds: nextFocus, focusReasons: nextReasons }
    })
  }

  /** Persist backfilled reasons to the local database (keeps the focus flag). */
  async persistReasons(reasons: Record<string, string>) {
    const entries = Object.entries(reasons)
    if (entries.length === 0) return
    await FocusService.updateReasons(reasons)
  }

  /** Drop entries from the focus set (and their local rows) when no reason can be produced. */
  async removeFocus(entryIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    set((state) => {
      const nextFocus = new Set(state.focusEntryIds)
      const nextReasons = { ...state.focusReasons }
      for (const id of entryIds) {
        nextFocus.delete(id)
        delete nextReasons[id]
      }
      return { focusEntryIds: nextFocus, focusReasons: nextReasons }
    })
    await FocusService.deleteMany(entryIds)
  }
}

export const focusActions = new FocusActions()

import { FocusService } from "@follow/database/services/focus"

import type { Hydratable, Resetable } from "../../lib/base"
import { createZustandStore } from "../../lib/helper"

export type FocusEntryId = string

interface FocusState {
  focusEntryIds: Set<FocusEntryId>
  analyzedEntryIds: Set<FocusEntryId>
}

const defaultState: FocusState = {
  focusEntryIds: new Set(),
  analyzedEntryIds: new Set(),
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
      focusEntryIds: new Set(focusRows.map((row) => row.entryId)),
      analyzedEntryIds: new Set(analyzedRows.map((row) => row.entryId)),
    })
  }

  async reset() {
    await FocusService.reset()
    set(defaultState)
  }

  /** Score results are applied in memory first, then persisted. */
  markAnalyzedInSession(entryIds: FocusEntryId[], focusIds: FocusEntryId[]) {
    set((state) => {
      const nextAnalyzed = new Set(state.analyzedEntryIds)
      const nextFocus = new Set(state.focusEntryIds)
      for (const id of entryIds) nextAnalyzed.add(id)
      for (const id of focusIds) nextFocus.add(id)
      return {
        analyzedEntryIds: nextAnalyzed,
        focusEntryIds: nextFocus,
      }
    })
  }

  /** Persist score results to the local database. */
  async persistAnalyzed(entryIds: FocusEntryId[], focusIds: FocusEntryId[]) {
    if (entryIds.length === 0) return
    const focusSet = new Set(focusIds)
    const nonFocusIds = entryIds.filter((id) => !focusSet.has(id))
    if (nonFocusIds.length > 0) {
      await FocusService.markAnalyzed(nonFocusIds, false)
    }
    if (focusIds.length > 0) {
      await FocusService.markAnalyzed(focusIds, true)
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
      for (const id of entryIds) {
        nextAnalyzed.delete(id)
        nextFocus.delete(id)
      }
      return { analyzedEntryIds: nextAnalyzed, focusEntryIds: nextFocus }
    })
    await FocusService.deleteMany(entryIds)
  }
}

export const focusActions = new FocusActions()

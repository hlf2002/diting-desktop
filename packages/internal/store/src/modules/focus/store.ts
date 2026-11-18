import { FocusService } from "@follow/database/services/focus"

import type { Hydratable, Resetable } from "../../lib/base"
import { createZustandStore } from "../../lib/helper"

export type FocusEntryId = string

interface FocusState {
  focusEntryIds: Set<FocusEntryId>
  analyzedEntryIds: Set<FocusEntryId>
  /** entryId → why it matched the focus criteria (from the on-device AI). */
  focusReasons: Record<string, string>
}

const defaultState: FocusState = {
  focusEntryIds: new Set(),
  analyzedEntryIds: new Set(),
  focusReasons: {},
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
    })
  }

  async reset() {
    await FocusService.reset()
    set(defaultState)
  }

  /** Score results are applied in memory first, then persisted. */
  markAnalyzedInSession(
    entryIds: FocusEntryId[],
    focusIds: FocusEntryId[],
    focusReasons: Record<string, string> = {},
  ) {
    set((state) => {
      const nextAnalyzed = new Set(state.analyzedEntryIds)
      const nextFocus = new Set(state.focusEntryIds)
      const nextReasons = { ...state.focusReasons }
      for (const id of entryIds) nextAnalyzed.add(id)
      for (const id of focusIds) nextFocus.add(id)
      for (const id of entryIds) {
        if (nextFocus.has(id)) {
          if (focusReasons[id]) nextReasons[id] = focusReasons[id]
        } else {
          delete nextReasons[id]
        }
      }
      return {
        analyzedEntryIds: nextAnalyzed,
        focusEntryIds: nextFocus,
        focusReasons: nextReasons,
      }
    })
  }

  /** Persist score results to the local database. */
  async persistAnalyzed(
    entryIds: FocusEntryId[],
    focusIds: FocusEntryId[],
    focusReasons: Record<string, string> = {},
  ) {
    if (entryIds.length === 0) return
    const focusSet = new Set(focusIds)
    const nonFocusIds = entryIds.filter((id) => !focusSet.has(id))
    if (nonFocusIds.length > 0) {
      await FocusService.markAnalyzed(nonFocusIds, false)
    }
    if (focusIds.length > 0) {
      await FocusService.markAnalyzed(focusIds, true, focusReasons)
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
      const nextReasons = { ...state.focusReasons }
      for (const id of entryIds) {
        nextAnalyzed.delete(id)
        nextFocus.delete(id)
        delete nextReasons[id]
      }
      return { analyzedEntryIds: nextAnalyzed, focusEntryIds: nextFocus, focusReasons: nextReasons }
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

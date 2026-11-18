import { eq, inArray } from "drizzle-orm"

import { db } from "../db"
import { focusEntriesTable } from "../schemas"
import type { Resetable } from "./internal/base"

/**
 * Device-local persistence for "focus" entry marks.
 *
 * One row per scored entry:
 * - `analyzedAt` non-null: the entry has been scored by the local AI (match or not),
 *   so it won't be scored again on later refreshes.
 * - `isFocus`: the score result. Entries with `is_focus` true appear in the
 *   "重点关注内容" timeline tab and carry the "重点关注" badge in entry lists.
 */
class FocusServiceStatic implements Resetable {
  async reset() {
    await db.delete(focusEntriesTable).execute()
  }

  /** All rows (both analyzed and not). */
  getAll() {
    return db.query.focusEntriesTable.findMany()
  }

  getFocusEntryIds() {
    return db.query.focusEntriesTable.findMany({
      columns: { entryId: true },
      where: eq(focusEntriesTable.isFocus, true),
    })
  }

  getAnalyzedEntryIds() {
    return db.query.focusEntriesTable.findMany({
      columns: { entryId: true },
    })
  }

  /** Mark entries as analyzed with their match result. */
  async markAnalyzed(entryIds: string[], isFocus: boolean) {
    if (entryIds.length === 0) return
    const rows = entryIds.map((entryId) => ({
      entryId,
      isFocus,
      analyzedAt: new Date(),
    }))
    await db
      .insert(focusEntriesTable)
      .values(rows)
      .onConflictDoUpdate({
        target: [focusEntriesTable.entryId],
        set: {
          isFocus,
          analyzedAt: new Date(),
        },
      })
  }

  /** Mark entries as analyzed without changing any existing focus flag. */
  async markAnalyzedKeepFocus(entryIds: string[]) {
    if (entryIds.length === 0) return
    await db
      .insert(focusEntriesTable)
      .values(
        entryIds.map((entryId) => ({
          entryId,
          isFocus: false,
          analyzedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [focusEntriesTable.entryId],
        set: {
          analyzedAt: new Date(),
        },
      })
  }

  async deleteMany(entryIds: string[]) {
    if (entryIds.length === 0) return
    await db.delete(focusEntriesTable).where(inArray(focusEntriesTable.entryId, entryIds))
  }

  async deleteAll() {
    await db.delete(focusEntriesTable).execute()
  }
}

export const FocusService = new FocusServiceStatic()

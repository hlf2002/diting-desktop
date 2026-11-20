import { and, eq, inArray, isNull, sql } from "drizzle-orm"

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
      columns: { entryId: true, reason: true, score: true },
      where: eq(focusEntriesTable.isFocus, true),
    })
  }

  /** Focus rows still missing a reason (legacy marks scored before reasons existed). */
  getUnreasonedFocusEntryIds() {
    return db.query.focusEntriesTable.findMany({
      columns: { entryId: true },
      where: and(eq(focusEntriesTable.isFocus, true), isNull(focusEntriesTable.reason)),
    })
  }

  getAnalyzedEntryIds() {
    return db.query.focusEntriesTable.findMany({
      columns: { entryId: true, score: true },
    })
  }

  /**
   * Mark entries as analyzed with their match result.
   *
   * @param entryIds Entries that were scored.
   * @param isFocus Whether they matched the focus criteria.
   * @param reasons Per-entry match reason (only meaningful for `isFocus` rows).
   * @param scores Per-entry decision-model score (noul probability 0~1; optional,
   *   null for chat-model fallback rows). Kept for both focus and non-focus rows
   *   so the reader can show "未进入重点关注" cards with the decision score.
   */
  async markAnalyzed(
    entryIds: string[],
    isFocus: boolean,
    reasons?: Record<string, string>,
    scores?: Record<string, number | null>,
  ) {
    if (entryIds.length === 0) return
    const rows = entryIds.map((entryId) => ({
      entryId,
      isFocus,
      analyzedAt: new Date(),
      reason: reasons?.[entryId] ?? null,
      score: scores?.[entryId] ?? null,
    }))
    await db
      .insert(focusEntriesTable)
      .values(rows)
      .onConflictDoUpdate({
        target: [focusEntriesTable.entryId],
        set: {
          isFocus,
          analyzedAt: new Date(),
          // Take the incoming row's reason (null when the entry was not matched).
          reason: sql`excluded.reason`,
          // Take the incoming row's score (null when the scoring had none).
          score: sql`excluded.score`,
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

  /** Backfill reasons for entries already flagged as focus (keeps their focus flag). */
  async updateReasons(reasons: Record<string, string>) {
    const entries = Object.entries(reasons)
    if (entries.length === 0) return
    for (const [entryId, reason] of entries) {
      await db
        .update(focusEntriesTable)
        .set({ reason })
        .where(eq(focusEntriesTable.entryId, entryId))
    }
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

import { useFocusStore } from "./store"

/** Entries currently flagged as matching the user's focus areas. */
export const useFocusEntryIds = () => useFocusStore((state) => state.focusEntryIds)

/** Entries already scored by the local AI, whether they matched or not. */
export const useAnalyzedEntryIds = () => useFocusStore((state) => state.analyzedEntryIds)

/** Entries waiting to be scored because focus criteria / BYOK provider is not yet configured. */
export const useUnjudgedEntryIds = () => useFocusStore((state) => state.unjudgedEntryIds)

/** Why an entry matched the focus criteria (empty string when not available). */
export const useFocusReason = (entryId: string) =>
  useFocusStore((state) => state.focusReasons[entryId] ?? "")

/** Decision-model score (noul probability 0~1) for an entry, null when unavailable. */
export const useFocusScore = (entryId: string) =>
  useFocusStore((state) => state.focusScores[entryId] ?? null)

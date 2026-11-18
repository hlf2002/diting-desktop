import { useFocusStore } from "./store"

/** Entries currently flagged as matching the user's focus areas. */
export const useFocusEntryIds = () => useFocusStore((state) => state.focusEntryIds)

/** Entries already scored by the local AI, whether they matched or not. */
export const useAnalyzedEntryIds = () => useFocusStore((state) => state.analyzedEntryIds)

/** Why an entry matched the focus criteria (empty string when not available). */
export const useFocusReason = (entryId: string) =>
  useFocusStore((state) => state.focusReasons[entryId] ?? "")

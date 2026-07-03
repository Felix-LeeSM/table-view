// Issue #1102 — cross-mount store for the raw-query grid's pending slices.
// Focused on the lifecycle contract the grid + tabStore cleanup depend on:
// getEntry fallback, single-slice writes, and the two purge paths (tab close
// via `purgeKey`, connection drop via `purgeForConnection`).
import { describe, it, expect, beforeEach } from "vitest";
import {
  useRawQueryGridEditStore,
  rawEntryKey,
  EMPTY_RAW_ENTRY,
} from "./rawQueryGridEditStore";

const KEY_A = rawEntryKey("conn1", "tab-1");
const KEY_B = rawEntryKey("conn1", "tab-2");
const KEY_OTHER_CONN = rawEntryKey("conn2", "tab-9");

describe("rawQueryGridEditStore", () => {
  beforeEach(() => {
    useRawQueryGridEditStore.setState({ entries: new Map() });
  });

  it("getEntry returns the shared EMPTY_RAW_ENTRY for a missing key", () => {
    expect(useRawQueryGridEditStore.getState().getEntry(KEY_A)).toBe(
      EMPTY_RAW_ENTRY,
    );
  });

  it("setSlice writes one slice and leaves the other empty", () => {
    const { setSlice, getEntry } = useRawQueryGridEditStore.getState();
    setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));
    const entry = getEntry(KEY_A);
    expect(entry.pendingEdits.get("0-1")).toBe("x");
    expect(entry.pendingDeletedRowKeys.size).toBe(0);
  });

  it("purgeKey removes only the target entry", () => {
    const { setSlice, purgeKey, getEntry } =
      useRawQueryGridEditStore.getState();
    setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));
    setSlice(KEY_B, "pendingEdits", new Map([["0-1", "y"]]));

    purgeKey(KEY_A);

    expect(getEntry(KEY_A)).toBe(EMPTY_RAW_ENTRY);
    expect(getEntry(KEY_B).pendingEdits.get("0-1")).toBe("y");
  });

  it("purgeForConnection removes every entry for that connection only", () => {
    const { setSlice, purgeForConnection, getEntry } =
      useRawQueryGridEditStore.getState();
    setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));
    setSlice(KEY_B, "pendingEdits", new Map([["0-1", "y"]]));
    setSlice(KEY_OTHER_CONN, "pendingEdits", new Map([["0-1", "z"]]));

    purgeForConnection("conn1");

    expect(getEntry(KEY_A)).toBe(EMPTY_RAW_ENTRY);
    expect(getEntry(KEY_B)).toBe(EMPTY_RAW_ENTRY);
    expect(getEntry(KEY_OTHER_CONN).pendingEdits.get("0-1")).toBe("z");
  });

  it("purgeForConnection is a no-op (identity-stable) with no matching keys", () => {
    const { setSlice, purgeForConnection } =
      useRawQueryGridEditStore.getState();
    setSlice(KEY_OTHER_CONN, "pendingEdits", new Map([["0-1", "z"]]));
    const before = useRawQueryGridEditStore.getState().entries;

    purgeForConnection("conn1");

    expect(useRawQueryGridEditStore.getState().entries).toBe(before);
  });
});

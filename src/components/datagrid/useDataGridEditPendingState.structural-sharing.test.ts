// Issue #1444 — the undo stack switched from deep-cloning all five pending
// slices on every edit (O(N²) over N edits, 50 full-size Map clones retained)
// to STRUCTURAL SHARING: `pushSnapshot` retains the CURRENT immutable slice
// references. This is safe because every setter replaces a slice wholesale
// (never mutates in place) and new-row cells are render-only.
//
// These tests pin the sharing property directly (reference equality, so they
// FAIL on the old clone code and PASS after the switch) plus the invariant it
// relies on: a subsequent edit must never mutate a captured snapshot. The
// behavioural undo semantics (LIFO restore, cap, commit-span restage) stay
// covered by `useDataGridEdit.undo.test.ts` — unchanged by this refactor.
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { makeEntryKey } from "@/test-utils/brandedKeys";
import { useDataGridEditPendingState } from "./useDataGridEditPendingState";

const KEY = makeEntryKey("conn1", "db1", "public", "users");
const ROWS: unknown[][] = [
  [1, "Alice"],
  [2, "Bob"],
];

function renderPendingState() {
  return renderHook(() =>
    useDataGridEditPendingState({
      connectionId: "conn1",
      database: "db1",
      schema: "public",
      table: "users",
      rows: ROWS,
    }),
  );
}

function entry() {
  return useDataGridEditStore.getState().getEntry(KEY);
}
function stack() {
  return entry().undoStack;
}

describe("useDataGridEditPendingState — undo structural sharing (#1444)", () => {
  beforeEach(() => {
    useDataGridEditStore.setState({ entries: new Map() });
  });

  it("pushSnapshot retains the current slice references instead of deep-cloning them", () => {
    const { result } = renderPendingState();

    // Stage one edit so pendingEdits is a non-empty Map.
    act(() => {
      result.current.setPendingEdits(new Map([["0-1", "x"]]));
    });
    const editsRef = entry().pendingEdits;
    const newRowsRef = entry().pendingNewRows;

    act(() => {
      result.current.pushSnapshot();
    });

    // Structural sharing: the snapshot holds the SAME references, not clones.
    // (Deep-clone code allocates fresh Map/Array here → these fail.)
    expect(stack()[0]!.pendingEdits).toBe(editsRef);
    expect(stack()[0]!.pendingNewRows).toBe(newRowsRef);

    // A second snapshot with no intervening slice change shares the same
    // unchanged-slice reference — 50 undo levels of a pure-edit run keep ONE
    // pendingNewRows reference, not 50 redundant clones.
    act(() => {
      result.current.pushSnapshot();
    });
    expect(stack()[1]!.pendingNewRows).toBe(newRowsRef);
    expect(stack()[0]!.pendingNewRows).toBe(stack()[1]!.pendingNewRows);
  });

  it("editing after a snapshot never mutates the captured snapshot (immutable-replace invariant)", () => {
    const { result } = renderPendingState();

    act(() => {
      result.current.setPendingEdits(new Map([["0-1", "x"]]));
    });
    act(() => {
      result.current.pushSnapshot();
    });
    const snapEdits = stack()[0]!.pendingEdits;
    expect(snapEdits.get("0-1")).toBe("x");

    // A later edit REPLACES the slice; the retained snapshot stays intact.
    act(() => {
      result.current.setPendingEdits(
        new Map([
          ["0-1", "y"],
          ["0-0", "z"],
        ]),
      );
    });
    expect(snapEdits.get("0-1")).toBe("x");
    expect(snapEdits.has("0-0")).toBe(false);
    expect(snapEdits.size).toBe(1);
  });
});

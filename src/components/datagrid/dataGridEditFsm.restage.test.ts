// Phase 1 of #1126 (ADR 0048) — `buildRestageSnapshot` transforms the
// just-committed pending edits into a single reversal snapshot so a
// post-commit Cmd+Z re-stages the pre-commit values as a NEW pending edit.
// The reversal never touches the DB — it only rebuilds Maps/Sets, so a
// commit-span undo is pure local-state manipulation (ADR 0048 core).
import { describe, it, expect } from "vitest";
import { buildRestageSnapshot } from "./dataGridEditFsm";

// Two-column row shape: [id (pk), name]. Anchor holds the ORIGINAL row the
// user edited, so the reversal value is `anchor[colIdx]`.
const ANCHOR_ROW = [1, "Alice"] as const;

function emptySource() {
  return {
    pendingEdits: new Map<string, string | null>(),
    pendingNewRows: [] as unknown[][],
    pendingDeletedRowKeys: new Set<string>(),
    pendingEditRowSnapshots: new Map<string, ReadonlyArray<unknown>>(),
  };
}

describe("buildRestageSnapshot (#1126 Phase 1)", () => {
  it("UPDATE-only commit → reversal snapshot restaging the original value", () => {
    const src = emptySource();
    // User changed name Alice → Bob at cell 0-1; the anchor keeps "Alice".
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);

    const snap = buildRestageSnapshot(src);

    expect(snap).not.toBeNull();
    expect(snap!.restageBlocked).toBeFalsy();
    // Reversal stages the pre-commit value keyed by the base cell key.
    expect(snap!.pendingEdits.get("0-1")).toBe("Alice");
    expect(snap!.pendingNewRows.length).toBe(0);
    expect(snap!.pendingDeletedRowKeys.size).toBe(0);
    // Anchor carried so the reversal's commit WHERE targets the right row.
    expect(snap!.pendingEditRowSnapshots.get("0-1")).toEqual(ANCHOR_ROW);
  });

  it("null-original edit → reversal restages SQL NULL", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1", "typed");
    src.pendingEditRowSnapshots.set("0-1", [1, null]);

    const snap = buildRestageSnapshot(src);

    expect(snap!.pendingEdits.get("0-1")).toBeNull();
  });

  it("nested JSON-path edits collapse to one whole-cell reversal", () => {
    const src = emptySource();
    // Two nested edits on the same cell 0-1 → one base-key reversal.
    src.pendingEdits.set("0-1:a", "x");
    src.pendingEdits.set("0-1:b", "y");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);

    const snap = buildRestageSnapshot(src);

    expect(snap!.pendingEdits.size).toBe(1);
    expect(snap!.pendingEdits.get("0-1")).toBe("Alice");
  });

  it("commit containing INSERT rows → blocked marker (not restageable)", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);
    src.pendingNewRows = [[null, "New"]];

    const snap = buildRestageSnapshot(src);

    expect(snap).not.toBeNull();
    expect(snap!.restageBlocked).toBe(true);
    expect(snap!.pendingEdits.size).toBe(0);
  });

  it("commit containing DELETE rows → blocked marker", () => {
    const src = emptySource();
    src.pendingDeletedRowKeys.add("row-1-0");

    const snap = buildRestageSnapshot(src);

    expect(snap!.restageBlocked).toBe(true);
  });

  it("no pending edits and no row changes → null (nothing to restage)", () => {
    expect(buildRestageSnapshot(emptySource())).toBeNull();
  });

  it("edit without an anchor → skipped (null when it was the only edit)", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1", "Bob"); // no anchor captured
    expect(buildRestageSnapshot(src)).toBeNull();
  });
});

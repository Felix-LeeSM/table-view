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
// Column metadata mirroring the two-column fixture: id is the primary key.
const COLUMNS = [{ is_primary_key: true }, { is_primary_key: false }] as const;

function emptySource() {
  return {
    pendingEdits: new Map<string, string | null>(),
    pendingNewRows: [] as unknown[][],
    pendingDeletedRowKeys: new Set<string>(),
    pendingEditRowSnapshots: new Map<string, ReadonlyArray<unknown>>(),
    pendingDeletedRowSnapshots: new Map<string, ReadonlyArray<unknown>>(),
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

  it("commit containing INSERT rows but no column metadata → blocked", () => {
    // Without PK columns we can't verify the insert is reversible → block.
    const src = emptySource();
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);
    src.pendingNewRows = [[null, "New"]];

    const snap = buildRestageSnapshot(src);

    expect(snap).not.toBeNull();
    expect(snap!.restageBlocked).toBe(true);
    expect(snap!.pendingEdits.size).toBe(0);
  });

  it("commit containing DELETE rows without a row snapshot → blocked", () => {
    const src = emptySource();
    src.pendingDeletedRowKeys.add("row-1-0"); // no snapshot captured

    const snap = buildRestageSnapshot(src, COLUMNS);

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

  // ---- Phase 2 (#1126): INSERT / DELETE commit-span re-staging ----

  it("committed DELETE with a row snapshot → reverse re-INSERT", () => {
    const src = emptySource();
    src.pendingDeletedRowKeys.add("row-1-0");
    src.pendingDeletedRowSnapshots.set("row-1-0", [1, "Alice"]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    expect(snap).not.toBeNull();
    expect(snap!.restageBlocked).toBeFalsy();
    // Reverse of a committed DELETE is a pending INSERT of the deleted row.
    expect(snap!.pendingNewRows).toEqual([[1, "Alice"]]);
    expect(snap!.pendingDeletedRowKeys.size).toBe(0);
  });

  it("committed INSERT with a reproducible PK → reverse DELETE", () => {
    const src = emptySource();
    src.pendingNewRows = [[7, "New"]];

    const snap = buildRestageSnapshot(src, COLUMNS);

    expect(snap).not.toBeNull();
    expect(snap!.restageBlocked).toBeFalsy();
    // Reverse of a committed INSERT is a pending DELETE anchored on the row.
    expect(snap!.pendingDeletedRowKeys.size).toBe(1);
    const key = [...snap!.pendingDeletedRowKeys][0]!;
    expect(snap!.pendingDeletedRowSnapshots.get(key)).toEqual([7, "New"]);
    expect(snap!.pendingNewRows.length).toBe(0);
  });

  it("committed INSERT with a null PK (auto-increment) → blocked", () => {
    // Server-assigned identity isn't reproducible from the typed row.
    const src = emptySource();
    src.pendingNewRows = [[null, "New"]];

    expect(buildRestageSnapshot(src, COLUMNS)!.restageBlocked).toBe(true);
  });

  it("committed INSERT on a table with no PK columns → blocked", () => {
    const src = emptySource();
    src.pendingNewRows = [[1, "New"]];
    const noPk = [{ is_primary_key: false }, { is_primary_key: false }];

    expect(buildRestageSnapshot(src, noPk)!.restageBlocked).toBe(true);
  });

  it("mixed UPDATE + DELETE commit → reversal edits and re-INSERT combine", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);
    src.pendingDeletedRowKeys.add("row-1-2");
    src.pendingDeletedRowSnapshots.set("row-1-2", [9, "Carol"]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    expect(snap!.restageBlocked).toBeFalsy();
    expect(snap!.pendingEdits.get("0-1")).toBe("Alice");
    expect(snap!.pendingNewRows).toEqual([[9, "Carol"]]);
  });

  it("mixed reproducible UPDATE + non-reproducible INSERT → whole commit blocked", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-1", ANCHOR_ROW);
    src.pendingNewRows = [[null, "New"]]; // null PK → not reproducible

    expect(buildRestageSnapshot(src, COLUMNS)!.restageBlocked).toBe(true);
  });
});

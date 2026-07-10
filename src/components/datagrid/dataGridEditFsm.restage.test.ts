// Phase 1 of #1126 (ADR 0048) — `buildRestageSnapshot` transforms the
// just-committed pending edits into a single reversal snapshot so a
// post-commit Cmd+Z re-stages the pre-commit values as a NEW pending edit.
// The reversal never touches the DB — it only rebuilds Maps/Sets, so a
// commit-span undo is pure local-state manipulation (ADR 0048 core).
import { describe, it, expect } from "vitest";
import { buildRestageSnapshot } from "./dataGridEditFsm";
import { generateSqlWithKeys } from "./sqlGenerator";
import { BASE_DATA } from "./sqlGenerator.fixtures";

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
    // #1438 — the anchor reflects the POST-commit row (name already "Bob"),
    // so a no-PK all-column WHERE also matches what's in the DB.
    expect(snap!.pendingEditRowSnapshots.get("0-1")).toEqual([1, "Bob"]);
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

  // Reason: #1433 리뷰 B1 — 삭제 undo 재-INSERT snapshot 의 실 NULL 은
  // verbatim 보존되어야 한다. sqlGenerator 가 이 null 을 명시 NULL 로 emit
  // 하는 계약과 짝 — 미입력(undefined)과 달리 생략 대상이 아니다 (2026-07-10)
  it("committed DELETE reversal preserves real NULL cells verbatim", () => {
    const src = emptySource();
    src.pendingDeletedRowKeys.add("row-1-0");
    src.pendingDeletedRowSnapshots.set("row-1-0", [1, null]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    expect(snap).not.toBeNull();
    expect(snap!.pendingNewRows).toStrictEqual([[1, null]]);
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

  // Composite PK — `pkIdx.every(i => row[i] != null)` is the wrong-row-DELETE
  // defense boundary: a partial identity can't safely target the inserted row.
  const COMPOSITE_PK = [
    { is_primary_key: true },
    { is_primary_key: true },
    { is_primary_key: false },
  ] as const;

  it("committed INSERT on a composite-PK table with a partial PK (one null) → blocked", () => {
    const src = emptySource();
    src.pendingNewRows = [[7, null, "New"]]; // second PK column is null

    expect(buildRestageSnapshot(src, COMPOSITE_PK)!.restageBlocked).toBe(true);
  });

  it("committed INSERT on a composite-PK table with all PK values present → reverse DELETE", () => {
    const src = emptySource();
    src.pendingNewRows = [[7, 8, "New"]];

    const snap = buildRestageSnapshot(src, COMPOSITE_PK);

    expect(snap!.restageBlocked).toBeFalsy();
    expect(snap!.pendingDeletedRowKeys.size).toBe(1);
    const key = [...snap!.pendingDeletedRowKeys][0]!;
    expect(snap!.pendingDeletedRowSnapshots.get(key)).toEqual([7, 8, "New"]);
  });

  it("mixed reproducible + partial-composite-PK INSERT in one commit → whole commit blocked", () => {
    const src = emptySource();
    src.pendingNewRows = [
      [7, 8, "Ok"],
      [9, null, "Bad"], // partial PK poisons the whole batch
    ];

    expect(buildRestageSnapshot(src, COMPOSITE_PK)!.restageBlocked).toBe(true);
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

// ---- #1438: PK-touched commit — reversal WHERE must target the POST-commit
// row. The committed UPDATE moved the row's PK, so an anchor that still holds
// the pre-edit PK would generate `WHERE pk = <old>` → 0-row no-op (silent on
// MSSQL/Oracle where the single-row guard is absent).
describe("buildRestageSnapshot — PK-touched reversal anchor (#1438)", () => {
  it("committed PK edit → reversal anchor carries the NEW (committed) PK value", () => {
    const src = emptySource();
    // User changed id 5 → 6 at cell 0-0; the anchor keeps the pre-edit row.
    src.pendingEdits.set("0-0", "6");
    src.pendingEditRowSnapshots.set("0-0", [5, "Alice"]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    // SET restores the old PK…
    expect(snap!.pendingEdits.get("0-0")).toBe("5");
    // …while the WHERE anchor references the committed row (id = 6 in DB now).
    expect(snap!.pendingEditRowSnapshots.get("0-0")).toEqual(["6", "Alice"]);
  });

  it("same-row PK + non-PK edits → every reversal anchor reflects the committed row", () => {
    const src = emptySource();
    src.pendingEdits.set("0-0", "6"); // id 5 → 6
    src.pendingEdits.set("0-1", "Bob"); // name Alice → Bob
    src.pendingEditRowSnapshots.set("0-0", [5, "Alice"]);
    src.pendingEditRowSnapshots.set("0-1", [5, "Alice"]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    expect(snap!.pendingEdits.get("0-0")).toBe("5");
    expect(snap!.pendingEdits.get("0-1")).toBe("Alice");
    // The name reversal's WHERE must also find the row by its NEW PK.
    expect(snap!.pendingEditRowSnapshots.get("0-0")).toEqual(["6", "Bob"]);
    expect(snap!.pendingEditRowSnapshots.get("0-1")).toEqual(["6", "Bob"]);
  });

  it("same visual rowIdx anchored to DIFFERENT rows (cross-page) never cross-applies committed values", () => {
    const src = emptySource();
    // Page A: id 5 → 6 at cell 0-0. Page B (same visual index 0): name edit.
    src.pendingEdits.set("0-0", "6");
    src.pendingEdits.set("0-1", "Bob");
    src.pendingEditRowSnapshots.set("0-0", [5, "Alice"]);
    src.pendingEditRowSnapshots.set("0-1", [9, "Carol"]); // different row identity

    const snap = buildRestageSnapshot(src, COLUMNS);

    // Row B's anchor must NOT absorb row A's committed PK — that would point
    // the name reversal at row A (wrong-row write).
    expect(snap!.pendingEditRowSnapshots.get("0-1")).toEqual([9, "Bob"]);
    expect(snap!.pendingEditRowSnapshots.get("0-0")).toEqual(["6", "Alice"]);
  });

  it("nested-path committed edits do not overlay the anchor (fragment ≠ whole cell)", () => {
    const src = emptySource();
    src.pendingEdits.set("0-1:a", "2");
    src.pendingEditRowSnapshots.set("0-1", [1, { a: 1 }]);

    const snap = buildRestageSnapshot(src, COLUMNS);

    // A nested fragment can't reconstruct the whole committed cell; the WHERE
    // stays correct through the untouched PK.
    expect(snap!.pendingEditRowSnapshots.get("0-1")).toEqual([1, { a: 1 }]);
  });

  it("reversal of a committed PK edit generates an UPDATE whose WHERE matches the post-commit row", () => {
    const src = emptySource();
    // BASE_DATA row 0 is [1, "Alice"]; user committed id 1 → 6.
    src.pendingEdits.set("0-0", "6");
    src.pendingEditRowSnapshots.set("0-0", [1, "Alice"]);

    const snap = buildRestageSnapshot(src, COLUMNS)!;
    const statements = generateSqlWithKeys(
      BASE_DATA,
      "public",
      "users",
      new Map(snap.pendingEdits),
      new Set<string>(),
      [],
      { editRowSnapshots: snap.pendingEditRowSnapshots },
    );

    // Old behavior emitted `WHERE id = 1` — a 0-row no-op since the row is
    // now id = 6. The reversal must find the row by its committed PK.
    expect(statements.map((s) => s.sql)).toEqual([
      "UPDATE public.users SET id = 1 WHERE id = 6;",
    ]);
  });
});

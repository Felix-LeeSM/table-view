// Sprint 251 — `dataGridEditStore` (in-memory zustand) lift of the four
// pending-edit slices. Maps to AC-251-S1..S5 from
// `docs/sprints/sprint-251/contract.md`. Date 2026-05-09.
//
// Sprint 433 extends the key to
// `${connectionId}::${database}::${schema}::${table}` so same-name RDB
// tables in different databases do not share pending edits. The store
// lives only for the lifetime of the workspace window — no localStorage,
// no cross-window broadcast (out of scope per contract). The five actions
// (`getEntry`, `setSlice`, `clearEntry`, `purgeKey`, `purgeForConnection`)
// must produce immutable Map / Set / Array replacements so React selectors
// detect the change.
import { describe, it, expect, beforeEach } from "vitest";
import {
  useDataGridEditStore,
  entryKey,
  EMPTY_ENTRY,
  type EditSnapshot,
} from "./dataGridEditStore";

function resetStore(): void {
  useDataGridEditStore.setState({ entries: new Map() });
}

const KEY_A = entryKey("conn1", "db1", "public", "users");
const KEY_B = entryKey("conn1", "db1", "public", "orders");
const KEY_OTHER_DB = entryKey("conn1", "db2", "public", "users");
const KEY_OTHER_CONN = entryKey("conn2", "db1", "public", "users");

describe("dataGridEditStore — Sprint 251 in-memory pending-edit lift", () => {
  beforeEach(() => {
    resetStore();
  });

  it("[AC-438-01] getEntry returns one stable hardened EMPTY_ENTRY for missing keys", () => {
    const missingA = useDataGridEditStore.getState().getEntry("missing-a");
    const missingAAgain = useDataGridEditStore.getState().getEntry("missing-a");
    const missingB = useDataGridEditStore.getState().getEntry("missing-b");

    expect(missingA).toBe(EMPTY_ENTRY);
    expect(missingAAgain).toBe(EMPTY_ENTRY);
    expect(missingB).toBe(EMPTY_ENTRY);
  });

  it("[AC-438-02] EMPTY_ENTRY nested containers reject direct mutation attempts", () => {
    const pendingEdits = EMPTY_ENTRY.pendingEdits as Map<string, string | null>;
    const pendingDeletedRowKeys =
      EMPTY_ENTRY.pendingDeletedRowKeys as Set<string>;
    const pendingNewRows = EMPTY_ENTRY.pendingNewRows as unknown[][];
    const undoStack = EMPTY_ENTRY.undoStack as EditSnapshot[];

    expect(() => pendingEdits.set("0-1", "x")).toThrow(
      /EMPTY_ENTRY\.pendingEdits/,
    );
    expect(() => pendingDeletedRowKeys.add("row-1")).toThrow(
      /EMPTY_ENTRY\.pendingDeletedRowKeys/,
    );
    expect(() => pendingNewRows.push(["x"])).toThrow(TypeError);
    expect(() =>
      undoStack.push({
        pendingEdits: new Map(),
        pendingNewRows: [],
        pendingDeletedRowKeys: new Set(),
        pendingEditRowSnapshots: new Map(),
        pendingDeletedRowSnapshots: new Map(),
      }),
    ).toThrow(TypeError);

    expect(EMPTY_ENTRY.pendingEdits.size).toBe(0);
    expect(EMPTY_ENTRY.pendingDeletedRowKeys.size).toBe(0);
    expect(EMPTY_ENTRY.pendingNewRows.length).toBe(0);
    expect(EMPTY_ENTRY.undoStack.length).toBe(0);
  });

  it("[AC-251-S1] two different keys are isolated — getEntry returns the slice set on its own key only", () => {
    const editsA = new Map<string, string | null>([["0-1", "Alice'"]]);
    const editsB = new Map<string, string | null>([["0-1", "Bob'"]]);

    useDataGridEditStore.getState().setSlice(KEY_A, "pendingEdits", editsA);
    useDataGridEditStore.getState().setSlice(KEY_B, "pendingEdits", editsB);

    const entryA = useDataGridEditStore.getState().getEntry(KEY_A);
    const entryB = useDataGridEditStore.getState().getEntry(KEY_B);

    expect(entryA.pendingEdits.get("0-1")).toBe("Alice'");
    expect(entryB.pendingEdits.get("0-1")).toBe("Bob'");
    // Cross-key isolation: B's edits never bleed into A.
    expect(entryA.pendingEdits.size).toBe(1);
    expect(entryB.pendingEdits.size).toBe(1);
  });

  it("[RISK-039] same connection/schema/table in two databases uses isolated pending entries", () => {
    // Reason: Sprint 433 RISK-039 — users can open db1.public.users and
    // db2.public.users at the same time; pending edits must not bleed
    // across the active database boundary. (2026-05-22)
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingEdits", new Map([["0-1", "db1 edit"]]));
    useDataGridEditStore
      .getState()
      .setSlice(KEY_OTHER_DB, "pendingEdits", new Map([["0-1", "db2 edit"]]));

    expect(
      useDataGridEditStore.getState().getEntry(KEY_A).pendingEdits.get("0-1"),
    ).toBe("db1 edit");
    expect(
      useDataGridEditStore
        .getState()
        .getEntry(KEY_OTHER_DB)
        .pendingEdits.get("0-1"),
    ).toBe("db2 edit");
  });

  it("[AC-251-S2] setSlice on one slice preserves the other three slices on the same key", () => {
    const newRows = [[1, "Alice"]] as unknown[][];
    const deleted = new Set<string>(["row-1-2"]);
    const snap: EditSnapshot = {
      pendingEdits: new Map(),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
      pendingEditRowSnapshots: new Map(),
      pendingDeletedRowSnapshots: new Map(),
    };

    useDataGridEditStore.getState().setSlice(KEY_A, "pendingNewRows", newRows);
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingDeletedRowKeys", deleted);
    useDataGridEditStore.getState().setSlice(KEY_A, "undoStack", [snap]);

    // Now mutate `pendingEdits` only — the other three slices must remain.
    const edits = new Map<string, string | null>([["0-1", "value"]]);
    useDataGridEditStore.getState().setSlice(KEY_A, "pendingEdits", edits);

    const entry = useDataGridEditStore.getState().getEntry(KEY_A);
    expect(entry.pendingEdits.get("0-1")).toBe("value");
    expect(entry.pendingNewRows).toEqual([[1, "Alice"]]);
    expect(entry.pendingDeletedRowKeys.has("row-1-2")).toBe(true);
    expect(entry.undoStack.length).toBe(1);
  });

  it("[AC-251-S3] clearEntry empties all four slices for that key (other keys untouched)", () => {
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingNewRows", [[1, "a"]] as unknown[][]);
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingDeletedRowKeys", new Set(["row-1-0"]));
    useDataGridEditStore
      .getState()
      .setSlice(KEY_B, "pendingEdits", new Map([["0-1", "preserved"]]));

    useDataGridEditStore.getState().clearEntry(KEY_A);

    const a = useDataGridEditStore.getState().getEntry(KEY_A);
    expect(a.pendingEdits.size).toBe(0);
    expect(a.pendingNewRows.length).toBe(0);
    expect(a.pendingDeletedRowKeys.size).toBe(0);
    expect(a.undoStack.length).toBe(0);

    // KEY_B untouched.
    const b = useDataGridEditStore.getState().getEntry(KEY_B);
    expect(b.pendingEdits.get("0-1")).toBe("preserved");
  });

  it("[AC-251-S4] purgeKey deletes the entry from the store map entirely", () => {
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));

    useDataGridEditStore.getState().purgeKey(KEY_A);

    const entries = useDataGridEditStore.getState().entries;
    expect(entries.has(KEY_A)).toBe(false);
    // getEntry on a missing key returns the empty default — never crashes.
    const empty = useDataGridEditStore.getState().getEntry(KEY_A);
    expect(empty).toBe(EMPTY_ENTRY);
  });

  it("[AC-251-S5] purgeForConnection removes every entry whose key starts with the connectionId prefix", () => {
    useDataGridEditStore
      .getState()
      .setSlice(KEY_A, "pendingEdits", new Map([["0-1", "a"]]));
    useDataGridEditStore
      .getState()
      .setSlice(KEY_B, "pendingEdits", new Map([["0-1", "b"]]));
    useDataGridEditStore
      .getState()
      .setSlice(KEY_OTHER_CONN, "pendingEdits", new Map([["0-1", "other"]]));

    useDataGridEditStore.getState().purgeForConnection("conn1");

    const entries = useDataGridEditStore.getState().entries;
    expect(entries.has(KEY_A)).toBe(false);
    expect(entries.has(KEY_B)).toBe(false);
    // Other connection is untouched — `purgeForConnection` is connectionId-scoped.
    expect(entries.has(KEY_OTHER_CONN)).toBe(true);
  });

  it("[#1364] hasDirtyEntries — false with no entries, true only when a prefixed entry holds pending content", () => {
    const store = () => useDataGridEditStore.getState();
    expect(store().hasDirtyEntries("conn1::")).toBe(false);

    // Empty entry (all slices cleared) does not count as dirty.
    store().setSlice(KEY_A, "pendingEdits", new Map());
    expect(store().hasDirtyEntries("conn1::")).toBe(false);

    // pendingEdits.
    store().setSlice(KEY_A, "pendingEdits", new Map([["0-1", "x"]]));
    expect(store().hasDirtyEntries("conn1::")).toBe(true);

    // pendingNewRows drives dirty on its own.
    store().clearEntry(KEY_A);
    store().setSlice(KEY_A, "pendingNewRows", [[1, "a"]] as unknown[][]);
    expect(store().hasDirtyEntries("conn1::")).toBe(true);

    // pendingDeletedRowKeys drives dirty on its own.
    store().clearEntry(KEY_A);
    store().setSlice(KEY_A, "pendingDeletedRowKeys", new Set(["row-1-0"]));
    expect(store().hasDirtyEntries("conn1::")).toBe(true);
  });

  it("[#1364] hasDirtyEntries — prefix-scoped: another connection's pending edits never count", () => {
    useDataGridEditStore
      .getState()
      .setSlice(KEY_OTHER_CONN, "pendingEdits", new Map([["0-1", "x"]]));
    expect(useDataGridEditStore.getState().hasDirtyEntries("conn1::")).toBe(
      false,
    );
    expect(useDataGridEditStore.getState().hasDirtyEntries("conn2::")).toBe(
      true,
    );
  });

  it("entryKey helper composes the canonical `${cid}::${database}::${schema}::${table}` shape", () => {
    expect(entryKey("conn1", "db1", "public", "users")).toBe(
      "conn1::db1::public::users",
    );
    expect(entryKey("c", "d", "s", "t")).toBe("c::d::s::t");
  });
});

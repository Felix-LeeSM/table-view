// Sprint 251 — `dataGridEditStore` (in-memory zustand) lift of the four
// pending-edit slices. Maps to AC-251-S1..S5 from
// `docs/sprints/sprint-251/contract.md`. Date 2026-05-09.
//
// The store is keyed by `${connectionId}::${schema}::${table}` and lives
// only for the lifetime of the workspace window — no localStorage, no
// cross-window broadcast (out of scope per contract). The five actions
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

const KEY_A = entryKey("conn1", "public", "users");
const KEY_B = entryKey("conn1", "public", "orders");
const KEY_OTHER_CONN = entryKey("conn2", "public", "users");

describe("dataGridEditStore — Sprint 251 in-memory pending-edit lift", () => {
  beforeEach(() => {
    resetStore();
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

  it("[AC-251-S2] setSlice on one slice preserves the other three slices on the same key", () => {
    const newRows = [[1, "Alice"]] as unknown[][];
    const deleted = new Set<string>(["row-1-2"]);
    const snap: EditSnapshot = {
      pendingEdits: new Map(),
      pendingNewRows: [],
      pendingDeletedRowKeys: new Set(),
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

  it("entryKey helper composes the canonical `${cid}::${schema}::${table}` shape", () => {
    expect(entryKey("conn1", "public", "users")).toBe("conn1::public::users");
    expect(entryKey("c", "s", "t")).toBe("c::s::t");
  });
});

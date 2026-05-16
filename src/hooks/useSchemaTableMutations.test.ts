import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { TableInfo } from "@/types/schema";

// 2026-05-06 — Sprint 223 (P10 step 2). The reload-then-fallback
// orchestration for `dropTable` / `renameTable` used to live inside
// `schemaStore.ts` action bodies. It moved to `useSchemaTableMutations`
// so the store stays a pure cache-shape module. These 6 cases pin the
// byte-equivalent cache transitions previously asserted in
// `schemaStore.test.ts` (lines 440-584 pre-Sprint 223): happy path
// (listTables result wins) + fallback path (listTables throw → optimistic
// filter/map) + cache miss (`?? []` defends).
//
// 2026-05-12 — Sprint 263. `tables` is now nested
// `Record<connId, Record<db, Record<schema, TableInfo[]>>>`; the hook's
// `dropTable` / `renameTable` accept `(connId, db, table, schema[, newName])`.
//
// 2026-05-16 — Sprint 354 (L2 fix). `schemaStore.dropTable` /
// `schemaStore.renameTable` were thin pass-throughs and have been
// removed; the hook now calls `tauri.dropTable` / `tauri.renameTable`
// directly, forwarding `database` as `expectedDatabase`. The mock
// assertions in this file now expect the canonical tauri arg shape
// (`(connId, table, schema, [newName,] expectedDatabase)`).

const {
  mockStoreDrop,
  mockStoreRename,
  mockTauriDrop,
  mockTauriRename,
  mockTauriListTables,
  mockSetState,
  mockGetState,
  storeState,
} = vi.hoisted(() => {
  const state: {
    tables: Record<
      string,
      Record<
        string,
        Record<
          string,
          { name: string; schema: string; row_count: number | null }[]
        >
      >
    >;
  } = { tables: {} };
  return {
    mockStoreDrop: vi.fn(),
    mockStoreRename: vi.fn(),
    mockTauriDrop: vi.fn(),
    mockTauriRename: vi.fn(),
    mockTauriListTables: vi.fn(),
    mockSetState: vi.fn(
      (
        updater:
          | Partial<typeof state>
          | ((s: typeof state) => Partial<typeof state>),
      ) => {
        const patch = typeof updater === "function" ? updater(state) : updater;
        Object.assign(state, patch);
      },
    ),
    mockGetState: vi.fn(() => state),
    storeState: state,
  };
});

vi.mock("@stores/schemaStore", () => ({
  useSchemaStore: Object.assign(
    (selector: (s: unknown) => unknown) =>
      selector({
        dropTable: mockStoreDrop,
        renameTable: mockStoreRename,
      }),
    { getState: mockGetState, setState: mockSetState },
  ),
}));

vi.mock("@lib/tauri", () => ({
  dropTable: mockTauriDrop,
  renameTable: mockTauriRename,
  listTables: mockTauriListTables,
}));

import { useSchemaTableMutations } from "./useSchemaTableMutations";

function makeTable(
  name: string,
  schema = "public",
  row_count: number | null = null,
): TableInfo {
  return { name, schema, row_count } as TableInfo;
}

/** Helper — seed the nested `tables[connId][db][schema]` slot. */
function seedTables(
  connId: string,
  db: string,
  schema: string,
  tables: TableInfo[],
): void {
  storeState.tables = {
    ...storeState.tables,
    [connId]: {
      ...storeState.tables[connId],
      [db]: { ...storeState.tables[connId]?.[db], [schema]: tables },
    },
  };
}

/** Helper — read the nested slot. */
function getTables(connId: string, db: string, schema: string): TableInfo[] {
  return (storeState.tables[connId]?.[db]?.[schema] ?? []) as TableInfo[];
}

describe("useSchemaTableMutations", () => {
  beforeEach(() => {
    // Sprint 354 (L2 fix) — mockStoreDrop / mockStoreRename remain in the
    // schemaStore mock surface (the prior contract), but the hook no
    // longer reads them; assertions land on mockTauriDrop / Rename
    // directly. Reset all anyway so leaks across tests don't surprise us.
    mockStoreDrop.mockReset();
    mockStoreRename.mockReset();
    mockTauriDrop.mockReset();
    mockTauriRename.mockReset();
    mockTauriListTables.mockReset();
    mockSetState.mockClear();
    mockGetState.mockClear();
    mockTauriDrop.mockResolvedValue(undefined);
    mockTauriRename.mockResolvedValue(undefined);
    // Fresh state per test so cache assertions are isolated.
    storeState.tables = {};
  });

  it("dropTable refreshes table list on success", async () => {
    seedTables("conn1", "db1", "public", [
      makeTable("users", "public", 10),
      makeTable("orders", "public", 5),
    ]);

    mockTauriListTables.mockResolvedValueOnce([
      makeTable("orders", "public", 5),
    ]);

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.dropTable("conn1", "db1", "users", "public");
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.dropTable pass-through.
    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    // Sprint 271a (2026-05-13) — `database` forwarded as expectedDatabase
    // so a swapped pool fails closed before populating wrong-db cache.
    expect(mockTauriListTables).toHaveBeenCalledWith("conn1", "public", "db1");
    expect(getTables("conn1", "db1", "public")).toHaveLength(1);
    expect(getTables("conn1", "db1", "public")[0]!.name).toBe("orders");
  });

  it("dropTable removes table optimistically when refresh fails", async () => {
    seedTables("conn1", "db1", "public", [
      makeTable("users", "public", 10),
      makeTable("orders", "public", 5),
    ]);

    mockTauriListTables.mockRejectedValueOnce(new Error("Refresh failed"));

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.dropTable("conn1", "db1", "users", "public");
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.dropTable pass-through.
    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    // Optimistically removed from cache
    expect(getTables("conn1", "db1", "public")).toHaveLength(1);
    expect(getTables("conn1", "db1", "public")[0]!.name).toBe("orders");
  });

  it("dropTable handles missing cache key gracefully", async () => {
    storeState.tables = {};

    mockTauriListTables.mockRejectedValueOnce(new Error("Refresh failed"));

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.dropTable("conn1", "db1", "users", "public");
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.dropTable pass-through.
    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    // No crash, table list stays empty for this slot
    expect(getTables("conn1", "db1", "public")).toHaveLength(0);
  });

  it("renameTable refreshes table list on success", async () => {
    seedTables("conn1", "db1", "public", [makeTable("users", "public", 10)]);

    mockTauriListTables.mockResolvedValueOnce([
      makeTable("people", "public", 10),
    ]);

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.renameTable(
        "conn1",
        "db1",
        "users",
        "public",
        "people",
      );
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.renameTable pass-through.
    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    // Sprint 271a (2026-05-13) — `database` forwarded as expectedDatabase.
    expect(mockTauriListTables).toHaveBeenCalledWith("conn1", "public", "db1");
    expect(getTables("conn1", "db1", "public")[0]!.name).toBe("people");
  });

  it("renameTable updates table name optimistically when refresh fails", async () => {
    seedTables("conn1", "db1", "public", [makeTable("users", "public", 10)]);

    mockTauriListTables.mockRejectedValueOnce(new Error("Refresh failed"));

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.renameTable(
        "conn1",
        "db1",
        "users",
        "public",
        "people",
      );
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.renameTable pass-through.
    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    expect(getTables("conn1", "db1", "public")[0]!.name).toBe("people");
  });

  it("renameTable handles missing cache key gracefully", async () => {
    storeState.tables = {};

    mockTauriListTables.mockRejectedValueOnce(new Error("Refresh failed"));

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.renameTable(
        "conn1",
        "db1",
        "users",
        "public",
        "people",
      );
    });

    // Sprint 354 (L2 fix) — `database` forwarded as last positional arg
    // (`expectedDatabase`) since the hook now bypasses the
    // schemaStore.renameTable pass-through.
    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    // No crash, empty array mapped to empty array
    expect(getTables("conn1", "db1", "public")).toHaveLength(0);
  });
});

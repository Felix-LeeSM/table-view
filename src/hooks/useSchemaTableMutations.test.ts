import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { renderHook, act } from "@testing-library/react";
import type { TableInfo } from "@/types/schema";
import { useSchemaStore } from "@stores/schemaStore";

// Pins the user-visible cache outcome for table drop/rename orchestration:
// mutation succeeds, listTables either refreshes server truth or the store
// applies an optimistic fallback. Only the Tauri boundary is mocked.

const { mockTauriDrop, mockTauriRename, mockTauriListTables } = vi.hoisted(
  () => ({
    mockTauriDrop: vi.fn(),
    mockTauriRename: vi.fn(),
    mockTauriListTables: vi.fn(),
  }),
);

beforeEach(() => {
  setupTauriMock({
    dropTable: mockTauriDrop,
    renameTable: mockTauriRename,
    listTables: mockTauriListTables,
  });
});

import { useSchemaTableMutations } from "./useSchemaTableMutations";

function makeTable(
  name: string,
  schema = "public",
  row_count: number | null = null,
): TableInfo {
  return { name, schema, row_count } as TableInfo;
}

function seedTables(
  connId: string,
  db: string,
  schema: string,
  tables: TableInfo[],
): void {
  const current = useSchemaStore.getState().tables;
  useSchemaStore.setState({
    tables: {
      ...current,
      [connId]: {
        ...current[connId],
        [db]: { ...current[connId]?.[db], [schema]: tables },
      },
    },
  });
}

function resetSchemaStore(): void {
  useSchemaStore.setState({
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    postgresExtensions: {},
    sqliteCapabilities: {},
    tableColumnsCache: {},
    triggers: {},
    loading: false,
    error: null,
  });
}

function tableNames(connId: string, db: string, schema: string): string[] {
  return (useSchemaStore.getState().tables[connId]?.[db]?.[schema] ?? []).map(
    (table) => table.name,
  );
}

describe("useSchemaTableMutations", () => {
  beforeEach(() => {
    mockTauriDrop.mockReset();
    mockTauriRename.mockReset();
    mockTauriListTables.mockReset();
    mockTauriDrop.mockResolvedValue(undefined);
    mockTauriRename.mockResolvedValue(undefined);
    resetSchemaStore();
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

    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(mockTauriListTables).toHaveBeenCalledWith("conn1", "public", "db1");
    expect(tableNames("conn1", "db1", "public")).toEqual(["orders"]);
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

    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(tableNames("conn1", "db1", "public")).toEqual(["orders"]);
  });

  it("dropTable handles missing cache key gracefully", async () => {
    mockTauriListTables.mockRejectedValueOnce(new Error("Refresh failed"));

    const { result } = renderHook(() => useSchemaTableMutations());
    await act(async () => {
      await result.current.dropTable("conn1", "db1", "users", "public");
    });

    expect(mockTauriDrop).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "db1",
    );
    expect(tableNames("conn1", "db1", "public")).toEqual([]);
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

    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    expect(mockTauriListTables).toHaveBeenCalledWith("conn1", "public", "db1");
    expect(tableNames("conn1", "db1", "public")).toEqual(["people"]);
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

    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    expect(tableNames("conn1", "db1", "public")).toEqual(["people"]);
  });

  it("renameTable handles missing cache key gracefully", async () => {
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

    expect(mockTauriRename).toHaveBeenCalledWith(
      "conn1",
      "users",
      "public",
      "people",
      "db1",
    );
    expect(tableNames("conn1", "db1", "public")).toEqual([]);
  });
});

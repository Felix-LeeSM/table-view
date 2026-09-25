// schemaStore end-to-end DbMismatch recovery (2026-05-13).
//
// Reason: when the backend guard rejects a schemaStore read call with
// `AppError::DbMismatch`, this file asserts in one place that the frontend
//   (1) detects it through the typed/legacy DbMismatch normalizer,
//   (2) calls verify + setActiveDb through syncMismatchedActiveDb, and
//   (3) shows no toast (background introspection is silent — out of scope
//       per the contract).
// The representative case is mocked with the #744 typed envelope.

import {
  registerSchemaStoreDbMismatchRecovery,
  resetSchemaStoreDbMismatchRecoveryForTests,
} from "@lib/runtime/recovery/syncMismatchedActiveDb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import type { DatabaseName, SchemaName, TableName } from "@/types/branded";

const setActiveDbMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const verifyActiveDbMock = vi.hoisted(() => vi.fn());

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({ setActiveDb: setActiveDbMock }),
  },
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { warning: toastWarningMock, info: vi.fn(), error: vi.fn() },
}));

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: verifyActiveDbMock,
}));

const DB_MISMATCH_ERROR = "Database mismatch: expected 'dbA', but found 'dbB'";
const TYPED_DB_MISMATCH_ERROR = {
  type: "DbMismatch",
  message: DB_MISMATCH_ERROR,
  payload: { expected: "dbA", actual: "dbB" },
};
beforeEach(() => {
  setupTauriMock({
    listSchemas: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    listTables: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    listViews: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    listFunctions: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    listPostgresExtensions: vi.fn(() =>
      Promise.reject(new Error(DB_MISMATCH_ERROR)),
    ),
    getTableColumns: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    listSchemaColumns: vi.fn(() =>
      Promise.reject(new Error(DB_MISMATCH_ERROR)),
    ),
    getTableIndexes: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    getTableConstraints: vi.fn(() =>
      Promise.reject(new Error(DB_MISMATCH_ERROR)),
    ),
    getViewColumns: vi.fn(() => Promise.reject(new Error(DB_MISMATCH_ERROR))),
    getViewDefinition: vi.fn(() =>
      Promise.reject(new Error(DB_MISMATCH_ERROR)),
    ),
    queryTableData: vi.fn(() => Promise.reject(new Error("unrelated"))),
    executeQuery: vi.fn(() => Promise.resolve({})),
    executeQueryBatch: vi.fn(() => Promise.resolve([])),
    dropTable: vi.fn(() => Promise.resolve()),
    renameTable: vi.fn(() => Promise.resolve()),
  });
});

import { useSchemaStore } from "./schemaStore";

async function flushMicrotasks(): Promise<void> {
  // syncMismatchedActiveDb is fire-and-forget — wait one microtask tick so
  // the awaited verifyActiveDb resolves before assertions.
  await Promise.resolve();
  await Promise.resolve();
}

describe("schemaStore — DbMismatch silent sync (Sprint 271a)", () => {
  beforeEach(() => {
    useSchemaStore.setState({
      databases: {},
      schemas: {},
      tables: {},
      views: {},
      functions: {},
      postgresExtensions: {},
      sqliteCapabilities: {},
      tableColumnsCache: {},
      loading: false,
      error: null,
    });
    setActiveDbMock.mockReset();
    toastWarningMock.mockReset();
    verifyActiveDbMock.mockReset().mockResolvedValue("dbB");
    resetSchemaStoreDbMismatchRecoveryForTests();
    registerSchemaStoreDbMismatchRecovery();
  });

  afterEach(() => {
    resetSchemaStoreDbMismatchRecoveryForTests();
    vi.clearAllMocks();
  });

  it("loadSchemas mismatch surfaces error AND syncs activeDb silently", async () => {
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      TYPED_DB_MISMATCH_ERROR,
    );

    await useSchemaStore.getState().loadSchemas("conn1", "dbA");

    expect(useSchemaStore.getState().error).toContain(
      "Database mismatch: expected 'dbA'",
    );
    expect(useSchemaStore.getState().loading).toBe(false);

    await flushMicrotasks();
    expect(verifyActiveDbMock).toHaveBeenCalledWith("conn1");
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    // Silent sync. No toast for background introspection.
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("loadTables mismatch invokes silent sync helper", async () => {
    await useSchemaStore.getState().loadTables("conn1", "dbA", "public");

    await flushMicrotasks();
    expect(verifyActiveDbMock).toHaveBeenCalledWith("conn1");
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("getTableColumns mismatch rethrows AND triggers silent sync", async () => {
    await expect(
      useSchemaStore
        .getState()
        .getTableColumns(
          "conn1",
          "dbA" as DatabaseName,
          "s" as SchemaName,
          "t" as TableName,
        ),
    ).rejects.toThrow(/Database mismatch/);

    await flushMicrotasks();
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("loadPostgresExtensions mismatch rethrows AND triggers silent sync", async () => {
    await expect(
      useSchemaStore.getState().loadPostgresExtensions("conn1", "dbA"),
    ).rejects.toThrow(/Database mismatch/);

    await flushMicrotasks();
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("getTableIndexes mismatch rethrows AND triggers silent sync", async () => {
    await expect(
      useSchemaStore
        .getState()
        .getTableIndexes(
          "conn1",
          "dbA" as DatabaseName,
          "s" as SchemaName,
          "t" as TableName,
        ),
    ).rejects.toThrow(/Database mismatch/);

    await flushMicrotasks();
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("prefetchSchemaColumns mismatch swallows error but still syncs", async () => {
    // prefetch path swallows failures (best-effort) — DbMismatch must still
    // route through the sync helper or the next dispatch loops.
    await expect(
      useSchemaStore.getState().prefetchSchemaColumns("conn1", "dbA", "public"),
    ).resolves.toBeUndefined();

    await flushMicrotasks();
    expect(setActiveDbMock).toHaveBeenCalledWith("conn1", "dbB");
    expect(toastWarningMock).not.toHaveBeenCalled();
  });

  it("non-mismatch errors do NOT trigger the sync helper", async () => {
    const { listSchemas } = await import("@lib/tauri");
    (listSchemas as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("Connection refused"),
    );

    await useSchemaStore.getState().loadSchemas("conn1", "dbA");

    await flushMicrotasks();
    expect(verifyActiveDbMock).not.toHaveBeenCalled();
    expect(setActiveDbMock).not.toHaveBeenCalled();
  });
});

// Sprint 271a (2026-05-13) — schemaStore end-to-end DbMismatch recovery.
//
// 작성 이유: backend Sprint 266 가드가 schemaStore 의 read 호출을
// `AppError::DbMismatch` 로 reject 할 때, 프론트엔드가
//   (1) typed/legacy DbMismatch normalizer 로 감지하고
//   (2) syncMismatchedActiveDb 로 verify+setActiveDb 를 호출하며
//   (3) toast 는 띄우지 않는다 (background introspection 은 silent — 271a
//       Out-of-Scope per contract).
// 을 한꺼번에 단언. 대표 case 는 #744 typed envelope 로 mock 한다.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  registerSchemaStoreDbMismatchRecovery,
  resetSchemaStoreDbMismatchRecoveryForTests,
} from "@lib/runtime/recovery/syncMismatchedActiveDb";

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
    // Sprint 271a — silent sync. No toast for background introspection.
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
      useSchemaStore.getState().getTableColumns("conn1", "dbA", "t", "s"),
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
      useSchemaStore.getState().getTableIndexes("conn1", "dbA", "t", "s"),
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "./documentStore";

// Hoisted mocks — each test can override the default return by reassigning
// the inner `vi.fn()` before calling the action under test.
vi.mock("@lib/tauri", () => ({
  listMongoDatabases: vi.fn(() =>
    Promise.resolve([{ name: "admin" }, { name: "table_view_test" }]),
  ),
  listMongoCollections: vi.fn(() =>
    Promise.resolve([
      { name: "users", database: "table_view_test", document_count: 3 },
    ]),
  ),
  inferCollectionFields: vi.fn(() =>
    Promise.resolve([
      {
        name: "_id",
        data_type: "objectId",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      },
    ]),
  ),
  findDocuments: vi.fn(() =>
    Promise.resolve({
      columns: [{ name: "_id", data_type: "objectId" }],
      rows: [[1]],
      raw_documents: [{ _id: 1 }],
      total_count: 1,
      execution_time_ms: 5,
    }),
  ),
}));

import * as tauri from "@lib/tauri";

describe("documentStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetDocumentStoreForTests();
  });

  it("loadDatabases stores databases keyed by connectionId", async () => {
    await useDocumentStore.getState().loadDatabases("conn-1");
    const state = useDocumentStore.getState();
    expect(state.databases["conn-1"]).toHaveLength(2);
    expect(state.databases["conn-1"]?.[0]?.name).toBe("admin");
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("loadDatabases records error + clears loading on failure", async () => {
    vi.mocked(tauri.listMongoDatabases).mockRejectedValueOnce(
      new Error("boom"),
    );
    await useDocumentStore.getState().loadDatabases("conn-1");
    const state = useDocumentStore.getState();
    expect(state.databases["conn-1"]).toBeUndefined();
    expect(state.loading).toBe(false);
    expect(state.error).toContain("boom");
  });

  it("loadCollections stores collections keyed by connectionId:database", async () => {
    await useDocumentStore
      .getState()
      .loadCollections("conn-1", "table_view_test");
    const state = useDocumentStore.getState();
    expect(state.collections["conn-1:table_view_test"]).toHaveLength(1);
    expect(state.collections["conn-1:table_view_test"]?.[0]?.name).toBe(
      "users",
    );
  });

  it("loadCollections stale response does not overwrite a newer response", async () => {
    // First call: slow (resolves after the second).
    let resolveSlow: (value: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    vi.mocked(tauri.listMongoCollections)
      .mockImplementationOnce(() => slow as Promise<never>)
      .mockResolvedValueOnce([
        { name: "fresh", database: "db", document_count: 99 },
      ]);

    const p1 = useDocumentStore.getState().loadCollections("conn-1", "db");
    const p2 = useDocumentStore.getState().loadCollections("conn-1", "db");
    await p2; // fresh write lands
    expect(
      useDocumentStore.getState().collections["conn-1:db"]?.[0]?.name,
    ).toBe("fresh");

    // Now let the slow call resolve — its stale write should be dropped.
    resolveSlow([{ name: "stale", database: "db", document_count: 0 }]);
    await p1;
    expect(
      useDocumentStore.getState().collections["conn-1:db"]?.[0]?.name,
    ).toBe("fresh");
  });

  it("inferFields caches by connection:db:collection and returns the columns", async () => {
    const returned = await useDocumentStore
      .getState()
      .inferFields("conn-1", "db", "users");
    expect(returned).toHaveLength(1);
    expect(returned[0]?.name).toBe("_id");
    expect(
      useDocumentStore.getState().fieldsCache["conn-1:db:users"],
    ).toHaveLength(1);
  });

  it("runFind caches the DocumentQueryResult and returns it", async () => {
    const result = await useDocumentStore
      .getState()
      .runFind("conn-1", "db", "users");
    expect(result.total_count).toBe(1);
    expect(
      useDocumentStore.getState().queryResults["conn-1:db:users"]?.rows,
    ).toHaveLength(1);
  });

  it("runFind stale response does not overwrite a newer response", async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    const freshResult = {
      columns: [],
      rows: [],
      raw_documents: [],
      total_count: 42,
      execution_time_ms: 1,
    };
    vi.mocked(tauri.findDocuments)
      .mockImplementationOnce(() => slow as Promise<never>)
      .mockResolvedValueOnce(freshResult);

    const p1 = useDocumentStore.getState().runFind("conn-1", "db", "users");
    const p2 = useDocumentStore.getState().runFind("conn-1", "db", "users");
    await p2;
    expect(
      useDocumentStore.getState().queryResults["conn-1:db:users"]?.total_count,
    ).toBe(42);

    resolveSlow({
      columns: [],
      rows: [],
      raw_documents: [],
      total_count: 999,
      execution_time_ms: 99,
    });
    await p1;
    expect(
      useDocumentStore.getState().queryResults["conn-1:db:users"]?.total_count,
    ).toBe(42);
  });

  it("clearConnection removes every cache entry scoped to that connection", async () => {
    await useDocumentStore.getState().loadDatabases("conn-1");
    await useDocumentStore.getState().loadCollections("conn-1", "db");
    await useDocumentStore.getState().inferFields("conn-1", "db", "users");
    await useDocumentStore.getState().runFind("conn-1", "db", "users");

    useDocumentStore.getState().clearConnection("conn-1");

    const s = useDocumentStore.getState();
    expect(s.databases["conn-1"]).toBeUndefined();
    expect(Object.keys(s.collections)).toHaveLength(0);
    expect(Object.keys(s.fieldsCache)).toHaveLength(0);
    expect(Object.keys(s.queryResults)).toHaveLength(0);
  });
});

// Sprint 265 (2026-05-12) — documentStore cache shape lifted from flat
// colon-keyed strings to `(connId, db, collection)` nested maps. Existing
// stale-guard / clearConnection semantics preserved; assertions migrated
// to the nested form. Aggregate results moved to a dedicated axis
// (`aggregateResults`) so find / aggregate caches can never alias.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  useDocumentStore,
  __resetDocumentStoreForTests,
} from "@/test-utils/documentStore";
import type { CollectionInfo } from "@/types/document";
import type { IndexInfo } from "@/types/schema";

function collectionFixture(
  name: string,
  database: string,
  documentCount: number,
): CollectionInfo {
  return {
    name,
    database,
    collection_type: "collection",
    document_count: documentCount,
    read_only: false,
    options: {},
    id_index: null,
  };
}

function indexFixture(name: string, columns: string[]): IndexInfo {
  return {
    name,
    columns,
    index_type: "btree",
    is_unique: false,
    is_primary: name === "_id_",
  };
}

beforeEach(() => {
  setupTauriMock({
    listMongoDatabases: vi.fn(() =>
      Promise.resolve([{ name: "admin" }, { name: "table_view_test" }]),
    ),
    listMongoCollections: vi.fn(() =>
      Promise.resolve([collectionFixture("users", "table_view_test", 3)]),
    ),
    inferCollectionFields: vi.fn(() =>
      Promise.resolve([
        {
          name: "_id",
          dataType: "objectId",
          nullable: false,
          default_value: null,
          is_primary_key: false,
          is_foreign_key: false,
          fk_reference: null,
          comment: null,
        },
      ]),
    ),
    listMongoIndexes: vi.fn(() =>
      Promise.resolve([
        indexFixture("_id_", ["_id"]),
        indexFixture("email_1", ["email"]),
      ]),
    ),
    findDocuments: vi.fn(() =>
      Promise.resolve({
        columns: [{ name: "_id", dataType: "objectId" }],
        rows: [[1]],
        rawDocuments: [{ _id: 1 }],
        totalCount: 1,
        executionTimeMs: 5,
      }),
    ),
    aggregateDocuments: vi.fn(() =>
      Promise.resolve({
        columns: [{ name: "_id", dataType: "objectId" }],
        rows: [[1]],
        rawDocuments: [{ _id: 1 }],
        totalCount: 1,
        executionTimeMs: 5,
      }),
    ),
  });
});

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

  it("loadCollections stores collections under collections[connId][db]", async () => {
    await useDocumentStore
      .getState()
      .loadCollections("conn-1", "table_view_test");
    const state = useDocumentStore.getState();
    expect(state.collections["conn-1"]?.["table_view_test"]).toHaveLength(1);
    expect(state.collections["conn-1"]?.["table_view_test"]?.[0]?.name).toBe(
      "users",
    );
  });

  it("loadCollections stale response does not overwrite a newer response", async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    vi.mocked(tauri.listMongoCollections)
      .mockImplementationOnce(() => slow as Promise<never>)
      .mockResolvedValueOnce([collectionFixture("fresh", "db", 99)]);

    const p1 = useDocumentStore.getState().loadCollections("conn-1", "db");
    const p2 = useDocumentStore.getState().loadCollections("conn-1", "db");
    await p2; // fresh write lands
    expect(
      useDocumentStore.getState().collections["conn-1"]?.["db"]?.[0]?.name,
    ).toBe("fresh");

    // Now let the slow call resolve — its stale write should be dropped.
    resolveSlow([collectionFixture("stale", "db", 0)]);
    await p1;
    expect(
      useDocumentStore.getState().collections["conn-1"]?.["db"]?.[0]?.name,
    ).toBe("fresh");
  });

  it("inferFields caches under fieldsCache[connId][db][collection] and returns the columns", async () => {
    const returned = await useDocumentStore
      .getState()
      .inferFields("conn-1", "db", "users");
    expect(returned).toHaveLength(1);
    expect(returned[0]?.name).toBe("_id");
    expect(
      useDocumentStore.getState().fieldsCache["conn-1"]?.["db"]?.["users"],
    ).toHaveLength(1);
  });

  it("loadCollectionIndexes caches under indexesCache[connId][db][collection] and returns the indexes", async () => {
    const returned = await useDocumentStore
      .getState()
      .loadCollectionIndexes("conn-1", "db", "users");
    expect(returned).toHaveLength(2);
    expect(returned[1]?.name).toBe("email_1");
    expect(tauri.listMongoIndexes).toHaveBeenCalledWith(
      "conn-1",
      "db",
      "users",
    );
    expect(
      useDocumentStore.getState().indexesCache["conn-1"]?.["db"]?.["users"],
    ).toHaveLength(2);
  });

  it("loadCollectionIndexes reuses cached indexes unless force refresh is requested", async () => {
    await useDocumentStore
      .getState()
      .loadCollectionIndexes("conn-1", "db", "users");
    const cached = await useDocumentStore
      .getState()
      .loadCollectionIndexes("conn-1", "db", "users");

    expect(cached).toHaveLength(2);
    expect(tauri.listMongoIndexes).toHaveBeenCalledTimes(1);

    vi.mocked(tauri.listMongoIndexes).mockResolvedValueOnce([
      indexFixture("created_at_1", ["created_at"]),
    ]);
    const refreshed = await useDocumentStore
      .getState()
      .loadCollectionIndexes("conn-1", "db", "users", { force: true });

    expect(tauri.listMongoIndexes).toHaveBeenCalledTimes(2);
    expect(refreshed[0]?.name).toBe("created_at_1");
    expect(
      useDocumentStore.getState().indexesCache["conn-1"]?.["db"]?.["users"],
    ).toEqual(refreshed);
  });

  it("runFind caches the DocumentQueryResult and returns it", async () => {
    const result = await useDocumentStore
      .getState()
      .runFind("conn-1", "db", "users");
    expect(result.totalCount).toBe(1);
    expect(
      useDocumentStore.getState().queryResults["conn-1"]?.["db"]?.["users"]
        ?.rows,
    ).toHaveLength(1);
  });

  it("normalizes a legacy snake-case cached find result before storing it", async () => {
    vi.mocked(tauri.findDocuments).mockResolvedValueOnce({
      columns: [{ name: "_id", data_type: "objectId" }],
      rows: [[1]],
      raw_documents: [{ _id: 1 }],
      total_count: 7,
      execution_time_ms: 3,
    } as never);

    const result = await useDocumentStore
      .getState()
      .runFind("conn-1", "db", "users");

    expect(result.totalCount).toBe(7);
    expect(result.columns[0]?.dataType).toBe("objectId");
    expect(result.rawDocuments[0]?._id).toBe(1);
    expect(
      useDocumentStore.getState().queryResults["conn-1"]?.["db"]?.["users"]
        ?.totalCount,
    ).toBe(7);
  });

  it("runFind stale response does not overwrite a newer response", async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    const freshResult = {
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 42,
      executionTimeMs: 1,
    };
    vi.mocked(tauri.findDocuments)
      .mockImplementationOnce(() => slow as Promise<never>)
      .mockResolvedValueOnce(freshResult);

    const p1 = useDocumentStore.getState().runFind("conn-1", "db", "users");
    const p2 = useDocumentStore.getState().runFind("conn-1", "db", "users");
    await p2;
    expect(
      useDocumentStore.getState().queryResults["conn-1"]?.["db"]?.["users"]
        ?.totalCount,
    ).toBe(42);

    resolveSlow({
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 999,
      executionTimeMs: 99,
    });
    await p1;
    expect(
      useDocumentStore.getState().queryResults["conn-1"]?.["db"]?.["users"]
        ?.totalCount,
    ).toBe(42);
  });

  it("catalog reload does not invalidate an in-flight find result", async () => {
    let resolveFind: (value: unknown) => void = () => {};
    const slowFind = new Promise((r) => {
      resolveFind = r;
    });
    vi.mocked(tauri.findDocuments).mockImplementationOnce(
      () => slowFind as Promise<never>,
    );

    const findPromise = useDocumentStore
      .getState()
      .runFind("conn-1", "db", "users");
    await useDocumentStore.getState().loadCollections("conn-1", "db");

    resolveFind({
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 5,
      executionTimeMs: 1,
    });
    await findPromise;

    const state = useDocumentStore.getState();
    expect(state.collections["conn-1"]?.["db"]?.[0]?.name).toBe("users");
    expect(state.queryResults["conn-1"]?.["db"]?.["users"]?.totalCount).toBe(5);
  });

  it("clearConnection removes every cache entry scoped to that connection", async () => {
    await useDocumentStore.getState().loadDatabases("conn-1");
    await useDocumentStore.getState().loadCollections("conn-1", "db");
    await useDocumentStore.getState().inferFields("conn-1", "db", "users");
    await useDocumentStore
      .getState()
      .loadCollectionIndexes("conn-1", "db", "users");
    await useDocumentStore.getState().runFind("conn-1", "db", "users");

    useDocumentStore.getState().clearConnection("conn-1");

    const s = useDocumentStore.getState();
    expect(s.databases["conn-1"]).toBeUndefined();
    expect(s.collections["conn-1"]).toBeUndefined();
    expect(s.fieldsCache["conn-1"]).toBeUndefined();
    expect(s.indexesCache["conn-1"]).toBeUndefined();
    expect(s.queryResults["conn-1"]).toBeUndefined();
  });

  // -- Sprint 73: runAggregate ----------------------------------------------

  it("runAggregate calls aggregateDocuments with the pipeline and caches the result", async () => {
    const pipeline = [{ $match: { active: true } }, { $limit: 10 }];
    const result = await useDocumentStore
      .getState()
      .runAggregate("conn-1", "db", "users", pipeline);

    expect(tauri.aggregateDocuments).toHaveBeenCalledWith(
      "conn-1",
      "db",
      "users",
      pipeline,
    );
    expect(result.totalCount).toBe(1);

    const pipelineKey = JSON.stringify(pipeline);
    expect(
      useDocumentStore.getState().aggregateResults["conn-1"]?.["db"]?.[
        "users"
      ]?.[pipelineKey]?.rows,
    ).toHaveLength(1);
  });

  it("runAggregate stale response does not overwrite a newer response", async () => {
    const pipeline = [{ $match: {} }];
    let resolveSlow: (value: unknown) => void = () => {};
    const slow = new Promise((r) => {
      resolveSlow = r;
    });
    const freshResult = {
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 77,
      executionTimeMs: 1,
    };
    vi.mocked(tauri.aggregateDocuments)
      .mockImplementationOnce(() => slow as Promise<never>)
      .mockResolvedValueOnce(freshResult);

    const p1 = useDocumentStore
      .getState()
      .runAggregate("conn-1", "db", "users", pipeline);
    const p2 = useDocumentStore
      .getState()
      .runAggregate("conn-1", "db", "users", pipeline);
    await p2;

    const pipelineKey = JSON.stringify(pipeline);
    expect(
      useDocumentStore.getState().aggregateResults["conn-1"]?.["db"]?.[
        "users"
      ]?.[pipelineKey]?.totalCount,
    ).toBe(77);

    resolveSlow({
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 999,
      executionTimeMs: 99,
    });
    await p1;
    expect(
      useDocumentStore.getState().aggregateResults["conn-1"]?.["db"]?.[
        "users"
      ]?.[pipelineKey]?.totalCount,
    ).toBe(77);
  });

  it("runAggregate caches separately from runFind for the same collection", async () => {
    vi.mocked(tauri.findDocuments).mockResolvedValueOnce({
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 3,
      executionTimeMs: 1,
    });
    vi.mocked(tauri.aggregateDocuments).mockResolvedValueOnce({
      columns: [],
      rows: [],
      rawDocuments: [],
      totalCount: 7,
      executionTimeMs: 1,
    });

    await useDocumentStore.getState().runFind("conn-1", "db", "users");
    await useDocumentStore
      .getState()
      .runAggregate("conn-1", "db", "users", [{ $match: {} }]);

    const s = useDocumentStore.getState();
    // find caches under queryResults at the (connId, db, collection) path.
    expect(s.queryResults["conn-1"]?.["db"]?.["users"]?.totalCount).toBe(3);
    // aggregate caches under its own axis so the two never alias.
    const pipelineKey = JSON.stringify([{ $match: {} }]);
    expect(
      s.aggregateResults["conn-1"]?.["db"]?.["users"]?.[pipelineKey]
        ?.totalCount,
    ).toBe(7);
  });

  it("clearConnection also drops cached aggregate results", async () => {
    await useDocumentStore
      .getState()
      .runAggregate("conn-1", "db", "users", [{ $match: {} }]);
    const pipelineKey = JSON.stringify([{ $match: {} }]);
    expect(
      useDocumentStore.getState().aggregateResults["conn-1"]?.["db"]?.[
        "users"
      ]?.[pipelineKey],
    ).toBeDefined();

    useDocumentStore.getState().clearConnection("conn-1");

    expect(
      useDocumentStore.getState().aggregateResults["conn-1"],
    ).toBeUndefined();
  });

  // -- Sprint 265 — cross-connection isolation (new) -----------------------

  it("loadCollections for different connections don't share cache slots (AC-265-01)", async () => {
    vi.mocked(tauri.listMongoCollections)
      .mockResolvedValueOnce([collectionFixture("users", "db", 1)])
      .mockResolvedValueOnce([collectionFixture("products", "db", 2)]);

    await useDocumentStore.getState().loadCollections("conn-A", "db");
    await useDocumentStore.getState().loadCollections("conn-B", "db");

    const s = useDocumentStore.getState();
    expect(s.collections["conn-A"]?.["db"]?.[0]?.name).toBe("users");
    expect(s.collections["conn-B"]?.["db"]?.[0]?.name).toBe("products");
  });

  it("clearConnection preserves other connections' caches (AC-265-01)", async () => {
    await useDocumentStore.getState().loadCollections("conn-A", "db");
    await useDocumentStore.getState().loadCollections("conn-B", "db");

    useDocumentStore.getState().clearConnection("conn-A");

    const s = useDocumentStore.getState();
    expect(s.collections["conn-A"]).toBeUndefined();
    expect(s.collections["conn-B"]?.["db"]).toBeDefined();
  });
});

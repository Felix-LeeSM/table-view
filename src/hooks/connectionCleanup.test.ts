import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DocumentQueryResult } from "@/types/document";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: () => "unit-window",
  };
});

import { cleanupConnectionFrontendState } from "./connectionCleanup";
import { useSchemaStore } from "@stores/schemaStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
import { entryKey, useDataGridEditStore } from "@stores/dataGridEditStore";
import { useWorkspaceStore } from "@stores/workspaceStore";

const RESULT: DocumentQueryResult = {
  columns: [],
  rows: [],
  rawDocuments: [],
  totalCount: 0,
  executionTimeMs: 1,
};

function seedTableWorkspace(connectionId: string, database: string): void {
  useWorkspaceStore.getState().addTab(connectionId, {
    type: "table",
    title: "users",
    connectionId,
    closable: true,
    schema: "public",
    table: "users",
    subView: "records",
    database,
    permanent: true,
  });
}

function resetStores(): void {
  useSchemaStore.setState({
    databases: {},
    schemas: {},
    tables: {},
    views: {},
    functions: {},
    tableColumnsCache: {},
    triggers: {},
    loading: false,
    error: null,
  });
  useDocumentCatalogStore.setState({
    databases: {},
    collections: {},
    fieldsCache: {},
    loading: false,
    error: null,
  });
  useDocumentQueryStore.setState({
    queryResults: {},
    aggregateResults: {},
  });
  useWorkspaceStore.setState({ workspaces: {} });
  useDataGridEditStore.setState({ entries: new Map() });
}

describe("connection cleanup orchestrator", () => {
  beforeEach(() => {
    resetStores();
  });

  it("[RISK-040] clears caches, workspace tabs, and pending edits for one connection only", () => {
    useSchemaStore.setState({
      databases: { conn1: [{ name: "dbA" }], conn2: [{ name: "dbA" }] },
      schemas: { conn1: { dbA: [] }, conn2: { dbA: [] } },
      tables: { conn1: { dbA: { public: [] } }, conn2: { dbA: {} } },
      views: { conn1: { dbA: { public: [] } }, conn2: { dbA: {} } },
      functions: { conn1: { dbA: { public: [] } }, conn2: { dbA: {} } },
      tableColumnsCache: {
        conn1: { dbA: { public: { users: [] } } },
        conn2: { dbA: {} },
      },
      triggers: {
        conn1: { dbA: { public: { users: [] } } },
        conn2: { dbA: {} },
      },
    });
    useDocumentCatalogStore.setState({
      databases: { conn1: [], conn2: [] },
      collections: { conn1: { dbA: [] }, conn2: { dbA: [] } },
      fieldsCache: {
        conn1: { dbA: { users: [] } },
        conn2: { dbA: { users: [] } },
      },
    });
    useDocumentQueryStore.setState({
      queryResults: {
        conn1: { dbA: { users: RESULT } },
        conn2: { dbA: { users: RESULT } },
      },
      aggregateResults: {
        conn1: { dbA: { users: { "[]": RESULT } } },
        conn2: { dbA: { users: { "[]": RESULT } } },
      },
    });
    seedTableWorkspace("conn1", "dbA");
    seedTableWorkspace("conn2", "dbA");

    const conn1Key = entryKey("conn1", "dbA", "public", "users");
    const conn2Key = entryKey("conn2", "dbA", "public", "users");
    const orphanKey = entryKey("conn1", "dbB", "public", "orders");
    useDataGridEditStore
      .getState()
      .setSlice(conn1Key, "pendingEdits", new Map([["0-1", "a"]]));
    useDataGridEditStore
      .getState()
      .setSlice(conn2Key, "pendingEdits", new Map([["0-1", "b"]]));
    useDataGridEditStore
      .getState()
      .setSlice(orphanKey, "pendingEdits", new Map([["0-1", "orphan"]]));

    cleanupConnectionFrontendState("conn1");

    expect(useSchemaStore.getState().databases.conn1).toBeUndefined();
    expect(useSchemaStore.getState().databases.conn2).toBeDefined();
    expect(useSchemaStore.getState().schemas.conn1).toBeUndefined();
    expect(useSchemaStore.getState().schemas.conn2).toBeDefined();
    expect(useDocumentCatalogStore.getState().databases.conn1).toBeUndefined();
    expect(useDocumentCatalogStore.getState().databases.conn2).toBeDefined();
    expect(useDocumentQueryStore.getState().queryResults.conn1).toBeUndefined();
    expect(useDocumentQueryStore.getState().queryResults.conn2).toBeDefined();
    expect(useWorkspaceStore.getState().workspaces.conn1).toBeUndefined();
    expect(useWorkspaceStore.getState().workspaces.conn2).toBeDefined();
    expect(useDataGridEditStore.getState().entries.has(conn1Key)).toBe(false);
    expect(useDataGridEditStore.getState().entries.has(orphanKey)).toBe(false);
    expect(useDataGridEditStore.getState().entries.has(conn2Key)).toBe(true);
  });

  it("[RISK-040] repeated cleanup is idempotent", () => {
    seedTableWorkspace("conn1", "dbA");
    const key = entryKey("conn1", "dbA", "public", "users");
    useDataGridEditStore
      .getState()
      .setSlice(key, "pendingEdits", new Map([["0-1", "a"]]));

    cleanupConnectionFrontendState("conn1");
    const afterFirstWorkspace = useWorkspaceStore.getState().workspaces;
    const afterFirstEntries = useDataGridEditStore.getState().entries;

    cleanupConnectionFrontendState("conn1");

    expect(useWorkspaceStore.getState().workspaces).toBe(afterFirstWorkspace);
    expect(useDataGridEditStore.getState().entries).toBe(afterFirstEntries);
    expect(useWorkspaceStore.getState().workspaces.conn1).toBeUndefined();
    expect(useDataGridEditStore.getState().entries.has(key)).toBe(false);
  });
});

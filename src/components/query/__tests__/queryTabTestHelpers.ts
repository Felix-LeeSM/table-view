// Sprint 218 — shared helpers extracted from `QueryTab.test.tsx` (P11
// step 2) so the behaviour-axis test files can reuse the same `vi.fn()`
// instances + `mockEditorProps` snapshot + fixture builders + store seed
// pattern. The 5 mock functions, the `mockEditorProps` ref, the fixture
// builders, and the `resetQueryTabStores` cleaner mirror the original
// mega-test verbatim — no behaviour change. Each axis file imports these
// and re-applies them in its own `beforeEach` so worker isolation +
// `mockReset()` keep state from leaking across cases.
//
// `vi.mock(...)` factories cannot live here because ES module hoisting
// pulls them above any import; each axis file declares the 7 factories at
// its module top-level instead.
import { vi } from "vitest";
import { useTabStore, type QueryTab as QueryTabType } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { __resetDocumentStoreForTests } from "@stores/documentStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import type { QueryResult } from "@/types/query";
import { useToastStore } from "@lib/toast";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

export const MOCK_RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
  ],
  rows: [[1, "Alice"]],
  total_count: 1,
  execution_time_ms: 5,
  query_type: "select",
};

export const MOCK_DOC_RESULT = {
  columns: [
    { name: "_id", data_type: "objectId" },
    { name: "name", data_type: "string" },
  ],
  rows: [[1, "Alice"]],
  raw_documents: [{ _id: 1, name: "Alice" }],
  total_count: 1,
  execution_time_ms: 4,
};

// ---------------------------------------------------------------------------
// Mock fn instances (shared across axis files via worker isolation)
// ---------------------------------------------------------------------------

export const mockExecuteQuery = vi.fn();
export const mockCancelQuery = vi.fn();
export const mockFindDocuments = vi.fn();
export const mockAggregateDocuments = vi.fn();
export const mockVerifyActiveDb = vi.fn();

/**
 * Shared ref the tests read to assert which SQLDialect the real QueryTab
 * passed down to QueryEditor. Using a module-level holder (instead of adding
 * a DOM attribute) keeps the dialect object reference intact so the test
 * can compare with `toBe(MySQL)` etc.
 *
 * Sprint 83 — also records the `mongoExtensions` prop so tests can assert
 * on the extension array identity, length, and hook-provided structure
 * without constructing a real CodeMirror view.
 */
export const mockEditorProps: {
  lastDialect: SQLDialect | undefined;
  dialectHistory: (SQLDialect | undefined)[];
  lastMongoExtensions: readonly Extension[] | undefined;
  mongoExtensionsHistory: (readonly Extension[] | undefined)[];
  lastParadigm: string | undefined;
  lastQueryMode: string | undefined;
} = {
  lastDialect: undefined,
  dialectHistory: [],
  lastMongoExtensions: undefined,
  mongoExtensionsHistory: [],
  lastParadigm: undefined,
  lastQueryMode: undefined,
};

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

export function makeQueryTab(
  overrides: Partial<QueryTabType> = {},
): QueryTabType {
  return {
    type: "query",
    id: "query-1",
    title: "Query 1",
    connectionId: "conn1",
    closable: true,
    sql: "SELECT 1",
    queryState: { status: "idle" },
    paradigm: "rdb",
    queryMode: "sql",
    ...overrides,
  };
}

export function makeConn(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  const dbType: DatabaseType = overrides.db_type ?? "postgresql";
  return {
    id: "conn1",
    name: "Test",
    db_type: dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "db",
    group_id: null,
    color: null,
    has_password: false,
    paradigm: "rdb",
    ...overrides,
  };
}

export function makeDocTab(
  overrides: Partial<QueryTabType> = {},
): QueryTabType {
  return makeQueryTab({
    connectionId: "conn-mongo",
    sql: "{}",
    paradigm: "document",
    queryMode: "find",
    database: "table_view_test",
    collection: "users",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Store + mock reset helper (mirrors the original `beforeEach` body)
// ---------------------------------------------------------------------------

export function resetQueryTabStores(): void {
  useTabStore.setState({ tabs: [], activeTabId: null });
  useQueryHistoryStore.setState({ entries: [] });
  useConnectionStore.setState({ connections: [] });
  mockExecuteQuery.mockReset();
  mockCancelQuery.mockReset();
  mockFindDocuments.mockReset();
  mockAggregateDocuments.mockReset();
  mockVerifyActiveDb.mockReset();
  // Sprint 132 — reset toast queue so the warning-mismatch test can
  // assert on its own toast without contamination from earlier tests.
  useToastStore.setState({ toasts: [] });
  mockEditorProps.lastDialect = undefined;
  mockEditorProps.dialectHistory = [];
  mockEditorProps.lastMongoExtensions = undefined;
  mockEditorProps.mongoExtensionsHistory = [];
  mockEditorProps.lastParadigm = undefined;
  mockEditorProps.lastQueryMode = undefined;
  __resetDocumentStoreForTests();
}

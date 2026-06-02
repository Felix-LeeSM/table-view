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
import {
  useWorkspaceStore,
  type QueryTab as QueryTabType,
} from "@stores/workspaceStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { __resetDocumentStoreForTests } from "@/test-utils/documentStore";
import type { ConnectionConfig, DatabaseType } from "@/types/connection";
import type { QueryResult } from "@/types/query";
import { useToastStore } from "@stores/toastStore";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import type { SqlCompletionContext } from "@lib/sql/sqlCompletionContext";
import type { RedisKeySuggestion } from "@lib/redis/redisCommandCompletion";

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

export const MOCK_RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [[1, "Alice"]],
  totalCount: 1,
  executionTimeMs: 5,
  queryType: "select",
};

export const MOCK_DOC_RESULT = {
  columns: [
    { name: "_id", dataType: "objectId", category: "unknown" },
    { name: "name", dataType: "string", category: "unknown" },
  ],
  rows: [[1, "Alice"]],
  rawDocuments: [{ _id: 1, name: "Alice" }],
  totalCount: 1,
  executionTimeMs: 4,
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
  lastRedisKeySuggestions: readonly RedisKeySuggestion[] | undefined;
  redisKeySuggestionsHistory: (readonly RedisKeySuggestion[] | undefined)[];
  lastCompletionContext: SqlCompletionContext | undefined;
  completionContextHistory: (SqlCompletionContext | undefined)[];
  lastParadigm: string | undefined;
  lastQueryMode: string | undefined;
} = {
  lastDialect: undefined,
  dialectHistory: [],
  lastMongoExtensions: undefined,
  mongoExtensionsHistory: [],
  lastRedisKeySuggestions: undefined,
  redisKeySuggestionsHistory: [],
  lastCompletionContext: undefined,
  completionContextHistory: [],
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
  const dbType: DatabaseType = overrides.dbType ?? "postgresql";
  return {
    id: "conn1",
    name: "Test",
    dbType: dbType,
    host: "localhost",
    port: 5432,
    user: "postgres",
    database: "db",
    groupId: null,
    color: null,
    hasPassword: false,
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
  useWorkspaceStore.setState({ workspaces: {} });
  // sprint-373 (2026-05-17) — entries/globalLog retired. `recentVisible` 가
  // 유일한 store slot.
  useQueryHistoryStore.setState({ recentVisible: [] });
  useConnectionStore.setState({ connections: [] });
  // Sprint 231 — reset Safe Mode mode so the persisted localStorage state
  // (or a previous case's `setMode` mutation) cannot leak between tests.
  // `strict` is the production default + matches existing fixture
  // expectations for the (rare) tests that don't set it explicitly.
  useSafeModeStore.setState({ mode: "strict" });
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
  mockEditorProps.lastRedisKeySuggestions = undefined;
  mockEditorProps.redisKeySuggestionsHistory = [];
  mockEditorProps.lastCompletionContext = undefined;
  mockEditorProps.completionContextHistory = [];
  mockEditorProps.lastParadigm = undefined;
  mockEditorProps.lastQueryMode = undefined;
  __resetDocumentStoreForTests();
}

// Sprint 218 — `dialect` axis split from `QueryTab.test.tsx` (P11
// step 2). Covers Sprint 82 provider-aware SQL dialect prop (Postgres /
// MySQL / SQLite mapping, missing-connection / non-RDB StandardSQL
// fallback, dbType flip) and Sprint 83 Mongo autocomplete + operator
// highlight wiring (no mongoExtensions on RDB tabs, 2-entry array on
// document tabs, queryMode-driven identity rebuild, fieldsCache feed,
// fieldsCache isolation from RDB tabs). Cases are byte-equivalent to
// the originals — no behaviour change.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, act } from "@testing-library/react";
import {
  MySQL,
  PostgreSQL,
  SQLite,
  StandardSQL,
  type SQLDialect,
} from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useDocumentStore } from "@stores/documentStore";
import {
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  mockEditorProps,
  makeQueryTab,
  makeConn,
  makeDocTab,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
  });
});

// Sprint 132 — the QueryTab raw-query hook calls `verifyActiveDb` after
// optimistic `setActiveDb`. The wrapper itself is unit-tested in
// `verifyActiveDb.test.ts`; here we mock it so the test can fix the
// "backend says X" return value per scenario.
vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

// Sprint 139 — QueryTab now routes directly to SqlQueryEditor /
// MongoQueryEditor based on `tab.paradigm`. Both editors are mocked to a
// shared DOM testbed (`data-testid="mock-editor"`) so the existing
// fixtures keep working — the mock records `paradigm` from a synthesised
// prop so the dialect / mongo / paradigm assertions stay meaningful.
vi.mock("./SqlQueryEditor", async () => {
  const React = await import("react");
  const MockSqlQueryEditor = React.forwardRef<
    unknown,
    {
      onExecute: () => void;
      sql: string;
      sqlDialect?: SQLDialect;
    }
  >(function MockSqlQueryEditor(props) {
    mockEditorProps.lastDialect = props.sqlDialect;
    mockEditorProps.dialectHistory.push(props.sqlDialect);
    mockEditorProps.lastMongoExtensions = undefined;
    mockEditorProps.mongoExtensionsHistory.push(undefined);
    mockEditorProps.lastParadigm = "rdb";
    mockEditorProps.lastQueryMode = "sql";
    return (
      <div data-testid="mock-editor" data-paradigm="rdb" data-sql={props.sql}>
        <button data-testid="execute-btn" onClick={props.onExecute}>
          Execute
        </button>
      </div>
    );
  });
  MockSqlQueryEditor.displayName = "MockSqlQueryEditor";
  return { default: MockSqlQueryEditor };
});

vi.mock("./MongoQueryEditor", async () => {
  const React = await import("react");
  const MockMongoQueryEditor = React.forwardRef<
    unknown,
    {
      onExecute: () => void;
      sql: string;
      mongoExtensions?: readonly Extension[];
      queryMode?: string;
    }
  >(function MockMongoQueryEditor(props) {
    mockEditorProps.lastDialect = undefined;
    mockEditorProps.dialectHistory.push(undefined);
    mockEditorProps.lastMongoExtensions = props.mongoExtensions;
    mockEditorProps.mongoExtensionsHistory.push(props.mongoExtensions);
    mockEditorProps.lastParadigm = "document";
    mockEditorProps.lastQueryMode = props.queryMode;
    return (
      <div
        data-testid="mock-editor"
        data-paradigm="document"
        data-sql={props.sql}
      >
        <button data-testid="execute-btn" onClick={props.onExecute}>
          Execute
        </button>
      </div>
    );
  });
  MockMongoQueryEditor.displayName = "MockMongoQueryEditor";
  return { default: MockMongoQueryEditor };
});

vi.mock("./QueryResultGrid", () => ({
  default: ({ queryState }: { queryState: unknown }) => (
    <div data-testid="mock-result" data-status={JSON.stringify(queryState)} />
  ),
}));

vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) => {
    // Simple split by semicolons for testing
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

describe("QueryTab — dialect", () => {
  beforeEach(() => {
    resetQueryTabStores();
  });

  // ── Sprint 82: provider-aware SQL dialect prop ──────────────────────────

  // AC-01: Postgres connection → QueryEditor receives the Postgres dialect.
  it("passes the PostgreSQL dialect when the active connection is postgres", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", dbType: "postgresql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(PostgreSQL);
  });

  // AC-02: MySQL connection → MySQL dialect.
  it("passes the MySQL dialect when the active connection is mysql", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", dbType: "mysql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(MySQL);
  });

  // AC-03: SQLite connection → SQLite dialect.
  it("passes the SQLite dialect when the active connection is sqlite", () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", dbType: "sqlite" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(SQLite);
  });

  // AC-07: Missing connection (deleted mid-session) → silent StandardSQL
  // fallback. Users see the editor keep working with generic highlighting
  // instead of an error, matching the existing pre-Sprint-82 contract.
  it("falls back to StandardSQL when the tab's connection is missing from the store", () => {
    // Store is empty — connection was deleted between render cycles.
    useConnectionStore.setState({ connections: [] });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(StandardSQL);
  });

  // AC-07 parity: MongoDB connection reaches a SQL query tab (rare, but the
  // guard exists in `databaseTypeToSqlDialect`). Still falls back.
  it("falls back to StandardSQL when the connection paradigm is non-RDB", () => {
    useConnectionStore.setState({
      connections: [
        makeConn({ id: "conn1", dbType: "mongodb", paradigm: "document" }),
      ],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(StandardSQL);
  });

  // AC-05: changing the active connection's dbType swaps the dialect prop
  // without recreating the QueryTab / QueryEditor.
  it("updates the dialect prop when connection dbType flips", async () => {
    useConnectionStore.setState({
      connections: [makeConn({ id: "conn1", dbType: "postgresql" })],
    });
    const tab = makeQueryTab();
    render(<QueryTab tab={tab} />);
    expect(mockEditorProps.lastDialect).toBe(PostgreSQL);

    await act(async () => {
      useConnectionStore.setState({
        connections: [makeConn({ id: "conn1", dbType: "mysql" })],
      });
    });
    expect(mockEditorProps.lastDialect).toBe(MySQL);
  });

  // ── Sprint 83: Mongo autocomplete + operator highlight wiring ─────────────

  // AC-S139-04: Sprint 139 split the editor by paradigm. RDB tabs route
  // to SqlQueryEditor which does NOT accept mongoExtensions; the mock
  // therefore records `lastMongoExtensions === undefined`. Document tabs
  // route to MongoQueryEditor and forward the hook's 2-entry extension
  // array. The earlier "always passes" assertion no longer applies after
  // the structural split.
  it("does NOT pass mongoExtensions to the SQL editor on RDB tabs", () => {
    const rdbTab = makeQueryTab();
    render(<QueryTab tab={rdbTab} />);
    expect(mockEditorProps.lastParadigm).toBe("rdb");
    expect(mockEditorProps.lastMongoExtensions).toBeUndefined();
  });

  it("passes a 2-entry mongoExtensions array to MongoQueryEditor on document tabs", () => {
    const docTab = makeDocTab();
    useWorkspaceStore.setState(seedWorkspace([docTab], "query-1"));
    render(<QueryTab tab={docTab} />);
    expect(mockEditorProps.lastParadigm).toBe("document");
    expect(mockEditorProps.lastMongoExtensions).toBeDefined();
    expect(Array.isArray(mockEditorProps.lastMongoExtensions)).toBe(true);
    expect(mockEditorProps.lastMongoExtensions?.length).toBe(2);
  });

  // Sprint 309 — the "queryMode flip rebuilds mongoExtensions" assertion
  // (AC-10 Sprint 83 era) is intentionally deleted. The Find/Aggregate
  // toggle is gone and `useMongoAutocomplete` no longer takes a
  // queryMode argument, so a tab.queryMode change can no longer drive a
  // memo recompute through this prop. The fieldNames-driven rebuild
  // below remains the live regression guard for the hook's memo key.

  // AC-11: Document-paradigm tabs surface cached field names from the
  // documentStore through the mongoExtensions prop. Populating
  // `fieldsCache` under the tab's connection:db:collection key causes
  // QueryTab to rebuild the memo and hand QueryEditor a fresh extension
  // set. The extension internals are exercised by
  // mongoAutocomplete.test.ts; here we only need to assert wiring.
  it("feeds documentStore.fieldsCache into mongoExtensions for document tabs", async () => {
    const docTab = makeDocTab();
    useWorkspaceStore.setState(seedWorkspace([docTab], "query-1"));
    const { rerender } = render(<QueryTab tab={docTab} />);
    const before = mockEditorProps.lastMongoExtensions;
    expect(before).toBeDefined();

    // Populate fieldsCache with the tab's nested (conn, db, collection)
    // path. The memo dep is the whole `fieldsCache` object so the identity
    // change triggers a recompute and produces a new mongoExtensions array.
    // Sprint 265 — cache lifted from flat colon-keys to nested maps.
    await act(async () => {
      useDocumentStore.setState({
        fieldsCache: {
          "conn-mongo": {
            table_view_test: {
              users: [
                {
                  name: "_id",
                  data_type: "objectId",
                  nullable: false,
                  default_value: null,
                  is_primary_key: true,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
                {
                  name: "email",
                  data_type: "string",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      });
      rerender(<QueryTab tab={docTab} />);
    });

    expect(mockEditorProps.lastMongoExtensions).toBeDefined();
    expect(mockEditorProps.lastMongoExtensions).not.toBe(before);
    expect(mockEditorProps.lastMongoExtensions?.length).toBe(2);
  });

  // AC-S139-04 regression: RDB tabs route to SqlQueryEditor which never
  // receives mongoExtensions in the first place — fieldsCache mutations
  // can never bleed into the SQL editor. After the Sprint 139 split this
  // is structurally enforced (the editor doesn't even accept the prop)
  // rather than gated behind a `paradigm` check inside the editor.
  it("does not pull fieldsCache into the SQL editor for RDB tabs", async () => {
    const rdbTab = makeQueryTab();
    useWorkspaceStore.setState(seedWorkspace([rdbTab], "query-1"));
    const { rerender } = render(<QueryTab tab={rdbTab} />);
    expect(mockEditorProps.lastParadigm).toBe("rdb");
    expect(mockEditorProps.lastMongoExtensions).toBeUndefined();

    await act(async () => {
      useDocumentStore.setState({
        fieldsCache: {
          someOther: {
            conn: {
              users: [
                {
                  name: "ignored",
                  data_type: "string",
                  nullable: true,
                  default_value: null,
                  is_primary_key: false,
                  is_foreign_key: false,
                  fk_reference: null,
                  comment: null,
                },
              ],
            },
          },
        },
      });
      rerender(<QueryTab tab={rdbTab} />);
    });

    expect(mockEditorProps.lastMongoExtensions).toBeUndefined();
    expect(mockEditorProps.lastParadigm).toBe("rdb");
  });
});

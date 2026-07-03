// Purpose: the SQL the result grid judges edit-ability against must be the
// EXECUTED snapshot stored on `queryState.completed.sql`, not the live editor
// text — and it must survive a QueryTab remount (tab switch), where the
// component-local approach reset. Pre-fix, a JOIN result whose editor was later
// edited to a single-table SELECT could flip to falsely-editable after a
// remount → wrong-row write. User report + PR #1236 review, issue #1226.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSchemaStore } from "@stores/schemaStore";
import {
  MOCK_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  makeConn,
  makeQueryTab,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";

const PK_COLUMNS = [
  {
    name: "id",
    dataType: "integer",
    category: "unknown",
    nullable: false,
    default_value: null,
    is_primary_key: true,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
  {
    name: "name",
    dataType: "text",
    category: "unknown",
    nullable: true,
    default_value: null,
    is_primary_key: false,
    is_foreign_key: false,
    fk_reference: null,
    comment: null,
  },
];

beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
    getTableColumns: vi.fn(async () => PK_COLUMNS),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

// Only the editor is mocked (boundary: CodeMirror). The result grid is the
// REAL component so the `queryState.sql` snapshot judgment is exercised.
// `sqlUtils` is NOT mocked — it is our own util, not a boundary (P6).
vi.mock("./SqlQueryEditor", async () => {
  const React = await import("react");
  const MockSqlQueryEditor = React.forwardRef<
    unknown,
    { onExecute: () => void; sql: string }
  >(function MockSqlQueryEditor(props) {
    return (
      <div data-testid="mock-editor" data-sql={props.sql}>
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
  const MockMongoQueryEditor = React.forwardRef<unknown, { sql: string }>(
    function MockMongoQueryEditor() {
      return <div data-testid="mock-editor" data-paradigm="document" />;
    },
  );
  MockMongoQueryEditor.displayName = "MockMongoQueryEditor";
  return { default: MockMongoQueryEditor };
});

vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

describe("QueryTab — result editability snapshot (#1226)", () => {
  beforeEach(() => {
    resetQueryTabStores();
    useSchemaStore.setState({
      tableColumnsCache: {},
      fileAnalyticsSources: {},
    });
  });

  // Reason: issue #1226 + PR #1236 review — after a run completes, switching
  // away and back to the tab (QueryTab unmount → remount) must keep the grid's
  // edit-ability judgment pinned to the executed snapshot, even though the
  // editor now holds a different (JOIN) query. The completed result lives in
  // the store, so the executed SQL snapshot must live there too (2026-07-03).
  it("keeps edit-ability on the executed snapshot across a tab-switch remount", async () => {
    mockExecuteQuery.mockResolvedValue(MOCK_RESULT);
    useConnectionStore.setState({ connections: [makeConn()] });
    const tab = makeQueryTab({
      sql: "SELECT id, name FROM public.users",
      database: "db1",
    });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    const { unmount } = render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    // First mount: the executed single-table SELECT is editable.
    expect(await screen.findByText(/Editable/)).toBeInTheDocument();

    // Grab the tab as it now lives in the store (completed queryState carrying
    // the executed-SQL snapshot), then simulate a tab-switch remount where the
    // editor text has since been edited to a JOIN.
    const stored = getTestWorkspace().tabs.find((t) => t.id === "query-1");
    if (!stored || stored.type !== "query") throw new Error("tab missing");
    unmount();
    const editedTab = {
      ...stored,
      sql: "SELECT * FROM users u JOIN orders o ON u.id = o.uid",
    };
    render(<QueryTab tab={editedTab} />);

    // Still editable — judged against the snapshot, not the live JOIN text.
    expect(await screen.findByText(/Editable/)).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/)).toBeNull();
  });
});

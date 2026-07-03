// Purpose: the SQL handed to QueryResultGrid for editability judgment must be
// the EXECUTED snapshot, not the live editor text. Pre-fix, QueryTab passed
// `tab.sql` (live), so editing the editor after a run toggled the already-shown
// result's edit affordance without re-executing. User report (2026-07-03),
// issue #1226 (symptom #1).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import { seedWorkspace } from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, act, waitFor } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  MOCK_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockVerifyActiveDb,
  makeQueryTab,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";

// Records every `sql` prop QueryResultGrid received, in render order, so the
// test can assert what the grid judged editability against.
const capturedSql: (string | undefined)[] = [];

beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
  });
});

vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: (...args: unknown[]) => mockVerifyActiveDb(...args),
}));

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

vi.mock("./QueryResultGrid", () => ({
  default: ({ sql }: { sql?: string }) => {
    capturedSql.push(sql);
    return <div data-testid="mock-result" data-sql={sql ?? ""} />;
  },
}));

vi.mock("@hooks/useSqlAutocomplete", () => ({
  useSqlAutocomplete: () => ({}),
}));

vi.mock("@lib/sql/sqlUtils", () => ({
  splitSqlStatements: (sql: string) =>
    sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean),
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

describe("QueryTab — result editability snapshot (#1226)", () => {
  beforeEach(() => {
    resetQueryTabStores();
    capturedSql.length = 0;
  });

  // Reason: issue #1226 symptom #1 — after a run completes, editing the editor
  // (parent re-renders QueryTab with new `tab.sql`) must NOT change the SQL the
  // grid judges editability against; that stays pinned to the executed text
  // until the next run (2026-07-03).
  it("keeps the executed SQL snapshot after the editor text changes", async () => {
    mockExecuteQuery.mockResolvedValue(MOCK_RESULT);
    const executedSql = "SELECT id, name FROM public.users";
    const tab = makeQueryTab({ sql: executedSql });
    useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
    const { rerender } = render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });
    await waitFor(() => {
      const state = useWorkspaceStore
        .getState()
        .workspaces["conn1"]?.["db1"]?.tabs.find((t) => t.id === "query-1");
      expect(state?.type === "query" && state.queryState.status).toBe(
        "completed",
      );
    });

    // Simulate the user editing the editor to a JOIN query WITHOUT re-running:
    // the parent (MainArea) re-renders QueryTab with the new live `tab.sql`.
    const editedSql = "SELECT * FROM users u JOIN orders o ON u.id = o.uid";
    rerender(<QueryTab tab={{ ...tab, sql: editedSql }} />);

    // The grid must still judge editability against the executed snapshot,
    // never the live edited JOIN text.
    expect(capturedSql[capturedSql.length - 1]).toBe(executedSql);
    expect(capturedSql).not.toContain(editedSql);
  });
});

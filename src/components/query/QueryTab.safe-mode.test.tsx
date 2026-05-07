// Sprint 231 — `QueryTab` raw RDB query Safe Mode gate. 8 cases per
// contract `docs/sprints/sprint-231/contract.md`. date 2026-05-07.
//
// The single-statement and multi-statement RDB branches in
// `useQueryExecution.handleExecute` previously dispatched `executeQuery`
// without consulting Safe Mode, so production users could run UPDATE /
// DELETE / DROP TABLE without confirmation. This file mirrors the gate
// pattern from the Mongo aggregate path (`pendingMongoConfirm`) and the
// grid edit path (`useDataGridEdit.safe-mode.test.ts`).
//
// Matrix coverage (per AC-231-01..03):
//   - production + strict + dangerous single → block (no executeQuery)
//   - production + strict + safe single      → allow
//   - production + warn   + dangerous single → confirm dialog (no execute)
//   - production + off    + dangerous single → block (prod-auto)
//   - non-production + strict + dangerous    → allow (env-gated)
//   - production + strict + multi (mixed)    → block, batch aborted
//   - production + warn   + multi (mixed)    → confirm-then-run = 2 calls
//   - production + warn   + cancel            → state cleared, no call
//
// AC-231-06 mandates that at least one case demonstrates the previous-version
// FAIL: `[AC-231-01a]` is the canary — Sprint 230 code calls executeQuery
// directly, so the `not.toHaveBeenCalled()` assertion captures the red state.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useTabStore } from "@stores/tabStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  MOCK_RESULT,
  mockExecuteQuery,
  mockCancelQuery,
  mockFindDocuments,
  mockAggregateDocuments,
  mockEditorProps,
  makeQueryTab,
  makeConn,
  resetQueryTabStores,
} from "./__tests__/queryTabTestHelpers";
import type { SQLDialect } from "@codemirror/lang-sql";
import type { Extension } from "@codemirror/state";

vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
  findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
  aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
}));

// `verifyActiveDb` is fired post-execute by `dispatchDbMutationHint`. Stub
// it so the safe-mode tests don't accidentally exercise the real IPC.
vi.mock("@lib/api/verifyActiveDb", () => ({
  verifyActiveDb: vi.fn().mockResolvedValue(""),
}));

// Mirror QueryTab.execution.test.tsx — mock both editors so the test
// can drive `onExecute` via a button click, paradigm-agnostically.
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
    const parts = sql
      .split(";")
      .map((s: string) => s.trim())
      .filter(Boolean);
    return parts.length > 0 ? parts : [];
  },
  formatSql: (sql: string) => sql.toUpperCase(),
  uglifySql: (sql: string) => sql.replace(/\s+/g, " ").trim(),
}));

function seedConnection(env: string | null) {
  useConnectionStore.setState({
    connections: [makeConn({ id: "conn1", environment: env })],
  });
}

function seedTab(sql: string) {
  const tab = makeQueryTab({ sql });
  useTabStore.setState({ tabs: [tab], activeTabId: "query-1" });
  return tab;
}

describe("QueryTab — Sprint 231 raw RDB Safe Mode gate", () => {
  beforeEach(() => {
    resetQueryTabStores();
    // Default mode = strict (matches user's persisted store; tests that
    // need a different mode override locally).
    useSafeModeStore.setState({ mode: "strict" });
  });

  // ── AC-231-01a: Block on production + strict + WHERE-less DELETE ──
  // This is the TDD canary — Sprint 230 code dispatches executeQuery
  // unconditionally, so the `not.toHaveBeenCalled` assertion fails until
  // the gate is wired in.
  it("[AC-231-01a] production + strict + WHERE-less DELETE → block, executeQuery NOT called, queryState=error", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    const state = useTabStore.getState();
    const updated = state.tabs.find((t) => t.id === "query-1");
    expect(updated?.type === "query" && updated.queryState.status).toBe(
      "error",
    );
    if (
      updated &&
      updated.type === "query" &&
      updated.queryState.status === "error"
    ) {
      expect(updated.queryState.error).toMatch(/Safe Mode blocked/);
      expect(updated.queryState.error).toMatch(/DELETE without WHERE/);
    }
    // History on block: status=error, duration=0, no dispatch hint.
    const history = useQueryHistoryStore.getState().entries;
    expect(history).toHaveLength(1);
    expect(history[0]!.status).toBe("error");
    expect(history[0]!.duration).toBe(0);
  });

  // ── AC-231-01e: Allow on production + strict + safe SELECT ──
  it("[AC-231-01e] production + strict + safe SELECT → allow, executeQuery called once", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("SELECT * FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-231-01b: Confirm on production + warn + dangerous ──
  it("[AC-231-01b] production + warn + WHERE-less DELETE → confirm dialog, executeQuery NOT called", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // Dialog rendered with the analyzer reason verbatim.
    await waitFor(() => {
      expect(
        screen.getByLabelText("Type danger reason to confirm"),
      ).toBeInTheDocument();
    });
    // The reason appears in multiple places (header description + "type
    // X to confirm" instruction + preview pane), so we assert >= 1
    // match instead of pinning a specific occurrence.
    expect(
      screen.getAllByText(/DELETE without WHERE clause/).length,
    ).toBeGreaterThan(0);
  });

  // ── AC-231-01c: Block on production + off + dangerous (prod-auto) ──
  it("[AC-231-01c] production + off + DROP TABLE → block (prod-auto override copy)", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "off" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    const updated = useTabStore.getState().tabs.find((t) => t.id === "query-1");
    if (
      updated &&
      updated.type === "query" &&
      updated.queryState.status === "error"
    ) {
      expect(updated.queryState.error).toMatch(
        /production environment forces Safe Mode/,
      );
    } else {
      throw new Error("expected query state to be in error after block");
    }
  });

  // ── AC-231-01d: Allow on non-production (env-gated) ──
  it("[AC-231-01d] development + strict + DROP TABLE → allow (env-gated)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-231-02a: Multi-statement (mixed) → block aborts entire batch ──
  it("[AC-231-02a] production + strict + multi (safe + dangerous) → block, executeQuery NOT called", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("SELECT 1; DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    const updated = useTabStore.getState().tabs.find((t) => t.id === "query-1");
    expect(updated?.type === "query" && updated.queryState.status).toBe(
      "error",
    );
  });

  // ── AC-231-02b: confirm-then-run runs full batch in order ──
  it("[AC-231-02b] production + warn + multi (UPDATE + DELETE) → confirm dialog; on confirm, executeQuery called twice in order", async () => {
    mockExecuteQuery.mockResolvedValue(MOCK_RESULT);
    seedConnection("production");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab(
      "UPDATE users SET active = 1 WHERE id = 1; DELETE FROM logs",
    );
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // The reason text is the FIRST dangerous statement's reason —
    // here the UPDATE (with WHERE) is safe, so DELETE without WHERE wins.
    const input = await screen.findByLabelText("Type danger reason to confirm");
    // Verify both statements appear verbatim in the preview.
    const preview = await screen.findByLabelText("Statement preview");
    expect(preview.textContent).toContain(
      "UPDATE users SET active = 1 WHERE id = 1",
    );
    expect(preview.textContent).toContain("DELETE FROM logs");

    // Type the reason verbatim and Enter to confirm.
    await act(async () => {
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      const fireEvent = (await import("@testing-library/react")).fireEvent;
      fireEvent.change(input, {
        target: { value: "DELETE without WHERE clause" },
      });
    });
    await act(async () => {
      const fireEvent = (await import("@testing-library/react")).fireEvent;
      fireEvent.keyDown(input, { key: "Enter" });
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "UPDATE users SET active = 1 WHERE id = 1",
      expect.any(String),
    );
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "DELETE FROM logs",
      expect.any(String),
    );
  });

  // ── AC-231-03 cancel: dialog → cancel → no execute, dialog gone ──
  it("[AC-231-03] cancel pendingRdbConfirm → dialog cleared, executeQuery NOT called, queryState NOT running", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    // Dialog mounted.
    const cancelBtn = await screen.findByRole("button", { name: "Cancel" });

    await act(async () => {
      cancelBtn.click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // Dialog disappears.
    await waitFor(() => {
      expect(
        screen.queryByLabelText("Type danger reason to confirm"),
      ).not.toBeInTheDocument();
    });
    // Tab state stays idle (running invariant: never entered running).
    const updated = useTabStore.getState().tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
  });
});

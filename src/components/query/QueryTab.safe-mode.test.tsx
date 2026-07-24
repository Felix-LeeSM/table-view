// QueryTab raw RDB Safe Mode gate — SURFACE WIRING contract only.
//
// Sprint 231 originally enumerated the full env×mode×severity matrix
// (prod/strict|warn|off × destructive/safe) here, duplicating the same matrix
// already verified on `EditableQueryResultGrid.safe-mode.test.tsx`. Issue #1623
// (2026-07-24) dedups to the unit SOT:
//   - `src/lib/safeMode.test.ts` (`decideSafeModeAction` L1..L8 + reason copy)
//   - `src/hooks/useSafeModeGate.test.ts` (store/env wiring, incl. #1114
//     env-unset=allow and #1125 non-canonical tag)
// WARN-tier SqlPreviewDialog handoff (INSERT skip, UPDATE WHERE / CREATE →
// dialog → Execute) is owned by `QueryTab.warn-dialog.test.tsx`; the destructive
// ConfirmDestructiveDialog rendering (prod vs non-prod header, reason copy,
// confirm arming) by `ConfirmDestructiveDialog.test.tsx`; the allow→executeQuery
// happy path by `QueryTab.execution.test.tsx` / `useQueryExecution.*`.
//
// Kept representative cells prove the gate decision is wired to THIS surface's
// raw execution path (`executeQuery`):
//   - prod+strict destructive → confirm dialog, executeQuery NOT called
//   - prod+warn confirm → executeQuery runs the batch in order (confirm→exec)
//   - cancel pendingRdbConfirm → executeQuery NOT called (security path)
// Plus [AC-906-01] Oracle PL/SQL package hard-block — an orthogonal
// dialect-specific analyzer block (not the env×mode matrix), kept as its own
// error/history contract.
//
// date 2026-05-07 (initial), 2026-07-24 (#1623 matrix dedup).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, waitFor, act } from "@testing-library/react";
import QueryTab from "./QueryTab";
import { useWorkspaceStore } from "@stores/workspaceStore";
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
beforeEach(() => {
  setupTauriMock({
    executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
    cancelQuery: (...args: unknown[]) => mockCancelQuery(...args),
    findDocuments: (...args: unknown[]) => mockFindDocuments(...args),
    aggregateDocuments: (...args: unknown[]) => mockAggregateDocuments(...args),
    // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
  });
});

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

function seedConnection(
  env: string | null,
  overrides: Parameters<typeof makeConn>[0] = {},
) {
  useConnectionStore.setState({
    connections: [makeConn({ id: "conn1", environment: env, ...overrides })],
  });
}

function seedTab(sql: string) {
  const tab = makeQueryTab({ sql });
  useWorkspaceStore.setState(seedWorkspace([tab], "query-1"));
  return tab;
}

describe("QueryTab — Safe Mode gate → executeQuery wiring", () => {
  beforeEach(() => {
    resetQueryTabStores();
    // Default mode = strict (matches user's persisted store; tests that
    // need a different mode override locally).
    useSafeModeStore.setState({ mode: "strict" });
  });

  // ── Representative: prod+strict destructive → confirm dialog ──
  // TDD canary (AC-231-06): Sprint 230 dispatched executeQuery
  // unconditionally, so `not.toHaveBeenCalled` captured the red state.
  it("[AC-231-01a] production + strict + WHERE-less DELETE → confirm dialog, executeQuery NOT called", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // Dialog rendered; tab stays idle (no error transition) so the user can
    // confirm or cancel.
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    const state = getTestWorkspace();
    const updated = state.tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
    // History entry NOT recorded on confirm (only on actual execute / cancel).
    const history = useQueryHistoryStore.getState().recentVisible;
    expect(history).toHaveLength(0);
  });

  it("[AC-906-01] development + warn + Oracle PL/SQL package → error block, executeQuery NOT called", async () => {
    // Orthogonal to the env×mode matrix: the analyzer hard-blocks Oracle
    // PL/SQL package/routine DDL regardless of Safe Mode, transitioning the
    // tab to error + recording an error history entry.
    seedConnection("development", {
      dbType: "oracle",
      port: 1521,
      user: "app",
      database: "FREEPDB1",
    });
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab("CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      const updated = getTestWorkspace().tabs.find((t) => t.id === "query-1");
      if (!updated || updated.type !== "query") {
        throw new Error("query tab missing");
      }
      expect(updated.queryState.status).toBe("error");
      if (updated.queryState.status === "error") {
        expect(updated.queryState.error).toMatch(
          /Oracle PL\/SQL package\/routine DDL/,
        );
      }
    });
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().recentVisible[0]).toMatchObject({
      status: "error",
      sqlRedacted: "CREATE OR REPLACE PACKAGE app_pkg AS END app_pkg",
    });
  });

  // ── Representative: prod+warn confirm → executeQuery (confirm-then-run
  // runs the full batch in order) ──
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
    // Sprint 246 — Confirm is a single-click button; the full batch preview
    // still surfaces verbatim so the user can review.
    const confirmBtn = await screen.findByTestId("confirm-destructive-confirm");
    const preview = await screen.findByLabelText("Statement preview");
    expect(preview.textContent).toContain(
      "UPDATE users SET active = 1 WHERE id = 1",
    );
    expect(preview.textContent).toContain("DELETE FROM logs");

    // #1111 — Confirm arms after a short delay; wait before clicking.
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    await act(async () => {
      confirmBtn.click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
    });
    // Sprint 266 — 4th arg is `expectedDatabase` (opt-in db mismatch guard).
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      1,
      "conn1",
      "UPDATE users SET active = 1 WHERE id = 1",
      expect.any(String),
      expect.any(String),
      // Issue #1112 — confirmed destructive batch forwards the proof.
      true,
    );
    expect(mockExecuteQuery).toHaveBeenNthCalledWith(
      2,
      "conn1",
      "DELETE FROM logs",
      expect.any(String),
      expect.any(String),
      true,
    );
  });

  // ── Security path: dialog → cancel → no execute, dialog gone ──
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
        screen.queryByTestId("confirm-destructive-confirm"),
      ).not.toBeInTheDocument();
    });
    // Tab state stays idle (running invariant: never entered running).
    const updated = getTestWorkspace().tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
  });
});

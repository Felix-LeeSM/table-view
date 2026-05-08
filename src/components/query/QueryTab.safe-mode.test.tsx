// Sprint 231 — `QueryTab` raw RDB query Safe Mode gate. Originally 8
// cases per contract `docs/sprints/sprint-231/contract.md`. date
// 2026-05-07.
//
// Sprint 244 (2026-05-08) tightened to "prod+strict|off = read-only" —
// REVERTED in Sprint 245 (ADR 0022 Phase 1). The 4 Sprint 244
// regression cases (`[AC-244-11..14]`) were removed because they
// asserted block on safe writes that now pass through, and one new
// case (`[AC-245-N1]`) covers the M.1 non-prod + strict destructive
// dialog flow.
//
// Matrix coverage (Sprint 245 — destructive-only):
//   - prod+strict|warn + WHERE-less DELETE single → confirm dialog
//     (was block for strict under Sprint 244)
//   - prod+strict + safe SELECT single → allow
//   - prod+warn  + safe write (INSERT) single → allow
//   - prod+off   + DROP TABLE single → confirm dialog with prod-auto
//     reason copy (was block under Sprint 244)
//   - non-prod + warn / off + DROP TABLE → allow (env-gated)
//   - non-prod + strict + DROP TABLE → confirm dialog (M.1 NEW flow)
//   - prod+warn + multi (UPDATE WHERE + WHERE-less DELETE) → confirm
//     then 2 sequential executeQuery calls on confirm
//   - prod+warn + cancel pendingRdbConfirm → state cleared
//
// AC-231-06 mandates that at least one case demonstrates the previous-
// version FAIL: `[AC-231-01a]` (now expecting confirm) is the canary —
// Sprint 230 code calls executeQuery directly, so the
// `not.toHaveBeenCalled()` assertion captures the red state.
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
  // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
  executeQueryDryRun: vi.fn(() => Promise.resolve([])),
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

  // ── AC-231-01a: Confirm on production + strict + WHERE-less DELETE ──
  // This is the TDD canary — Sprint 230 code dispatches executeQuery
  // unconditionally, so the `not.toHaveBeenCalled` assertion fails until
  // the gate is wired in. Sprint 245 (ADR 0022 Phase 1) — was "block",
  // now "confirm dialog" because the destructive-only policy raises a
  // dialog (not an error) for prod+strict+destructive.
  it("[AC-231-01a] production + strict + WHERE-less DELETE → confirm dialog, executeQuery NOT called", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    // Dialog rendered (mirrors AC-231-01b warn-tier flow); tab stays
    // idle (no error transition) so the user can confirm or cancel.
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    const state = useTabStore.getState();
    const updated = state.tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
    // History entry NOT recorded on confirm (only on actual execute /
    // cancel). Mirrors warn-tier behaviour from Sprint 231.
    const history = useQueryHistoryStore.getState().entries;
    expect(history).toHaveLength(0);
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

  // ── AC-245-C4: Sprint 245 prod+strict safe write pass-through ──
  // Was [AC-244-11..14] under Sprint 244 (block on safe DML/DDL);
  // reverted in Sprint 245 — safe writes flow through on production
  // regardless of mode, dialog only opens on destructive statements.
  it("[AC-245-C4] production + strict + INSERT INTO → executeQuery called once (Sprint 244 block reverted)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("INSERT INTO users (name) VALUES ('alice')");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    // No confirm dialog should have mounted.
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();
  });

  it("[AC-245-C4-2] production + strict + UPDATE WHERE pk → executeQuery called once", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("UPDATE users SET name = 'x' WHERE id = 1");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  it("[AC-245-C4-3] production + strict + CREATE TABLE → executeQuery called once (additive DDL passes)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("CREATE TABLE foo (id int)");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-245-N1: M.1 NEW flow — non-prod + strict + destructive → confirm ──
  // Strict mode now opens the destructive dialog in non-production too
  // (shared-staging / learning environments). warn / off on non-prod
  // remain unguarded for dev workflows.
  it("[AC-245-N1] development + strict + DROP TABLE → confirm dialog (M.1 NEW flow)", async () => {
    seedConnection("development");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    // Reason carries the strict-mode hint copy so downstream UI guidance
    // can differentiate it from the prod+strict / prod+warn copy.
    expect(
      screen.getAllByText(
        /Safe Mode strict — destructive statement in non-production/,
      ).length,
    ).toBeGreaterThan(0);
  });

  it("[AC-245-N2] development + warn + DROP TABLE → executeQuery called once (warn unguarded outside prod)", async () => {
    // Paired with N1 to lock the matrix: warn / off on non-prod do not
    // open the dialog even on destructive statements.
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByTestId("confirm-destructive-confirm"),
    ).not.toBeInTheDocument();
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
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    // The reason appears in multiple places (header description + "type
    // X to confirm" instruction + preview pane), so we assert >= 1
    // match instead of pinning a specific occurrence.
    expect(
      screen.getAllByText(/DELETE without WHERE clause/).length,
    ).toBeGreaterThan(0);
  });

  // ── AC-231-01c: Confirm on production + off + dangerous (prod-auto) ──
  // Sprint 245 (ADR 0022 Phase 1) — was "block (prod-auto override
  // copy)". The destructive-only policy opens the confirm dialog
  // instead; prod-auto reason copy is preserved in the dialog body so
  // off remains distinguishable from warn on production.
  it("[AC-231-01c] production + off + DROP TABLE → confirm dialog with prod-auto reason copy", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "off" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getAllByText(/production environment forces Safe Mode/).length,
    ).toBeGreaterThan(0);
  });

  // ── AC-231-01d: Allow on non-production (env-gated) — warn / off ──
  // Sprint 245 (ADR 0022 Phase 1) — under the new M.1 flow, dev +
  // strict + destructive opens the confirm dialog (covered by
  // [AC-245-N1]). Re-pin this AC to dev + warn so it still asserts
  // "non-prod = unguarded" without overlapping the strict M.1 path.
  it("[AC-231-01d] development + warn + DROP TABLE → allow (env-gated)", async () => {
    mockExecuteQuery.mockResolvedValueOnce(MOCK_RESULT);
    seedConnection("development");
    useSafeModeStore.setState({ mode: "warn" });
    const tab = seedTab("DROP TABLE users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    await waitFor(() => {
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
  });

  // ── AC-231-02a: Multi-statement (mixed) → confirm dialog (Sprint 245) ──
  // Was block under Sprint 244 (read-only policy). Under the
  // destructive-only policy, prod+strict+multi(safe SELECT +
  // WHERE-less DELETE) opens the same warn-tier confirm dialog
  // because the DELETE is destructive. The dialog covers the whole
  // batch (per-statement individual approval forbidden by AC-231-02).
  it("[AC-231-02a] production + strict + multi (safe + destructive) → confirm dialog, executeQuery NOT called", async () => {
    seedConnection("production");
    useSafeModeStore.setState({ mode: "strict" });
    const tab = seedTab("SELECT 1; DELETE FROM users");
    render(<QueryTab tab={tab} />);

    await act(async () => {
      screen.getByTestId("execute-btn").click();
    });

    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-destructive-confirm"),
      ).toBeInTheDocument();
    });
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
    // Sprint 246 (ADR 0022 Phase 2) — Confirm is a single-click button;
    // the prior verbatim-typing + Enter gate is gone. The full batch
    // preview still surfaces verbatim so the user can review.
    const confirmBtn = await screen.findByTestId("confirm-destructive-confirm");
    const preview = await screen.findByLabelText("Statement preview");
    expect(preview.textContent).toContain(
      "UPDATE users SET active = 1 WHERE id = 1",
    );
    expect(preview.textContent).toContain("DELETE FROM logs");

    await act(async () => {
      confirmBtn.click();
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
        screen.queryByTestId("confirm-destructive-confirm"),
      ).not.toBeInTheDocument();
    });
    // Tab state stays idle (running invariant: never entered running).
    const updated = useTabStore.getState().tabs.find((t) => t.id === "query-1");
    if (updated && updated.type === "query") {
      expect(updated.queryState.status).toBe("idle");
    }
  });
});

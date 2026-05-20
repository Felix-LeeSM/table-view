// AC-185-05 — EditableQueryResultGrid Safe Mode gate. 4 cases per Sprint 185.
// AC-186-05 — Sprint 186 adds warn-tier dialog handoff (3 cases).
// Sprint 244 (2026-05-08) tightened the policy to "production+strict|off
// = read-only" — REVERTED in Sprint 245 (ADR 0022 Phase 1). `[AC-244-09]`
// (block on prod+strict + safe DML) was re-inverted back to a
// pass-through assertion below as `[AC-245-C3]`.
// date 2026-05-01 (initial), 2026-05-08 (Sprint 244 → Sprint 245).
//
// Current policy (Sprint 245 — ADR 0022 Phase 1, destructive-only):
//   - production + any mode: SELECT and safe writes (INSERT, UPDATE
//     WHERE, DELETE WHERE, CREATE, ALTER additive) flow through;
//     destructive opens the confirm dialog (mode-specific reason copy).
//   - non-production + strict: destructive opens the dialog (M.1 new
//     flow); safe writes / SELECT pass.
//   - non-production + warn / off: bypass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useConnectionStore } from "@stores/connectionStore";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/sql/rawQuerySqlBuilder";
import type { ConnectionConfig } from "@/types/connection";

const mockExecuteQueryBatch = vi.fn();
const mockToastError = vi.fn();
const mockToastInfo = vi.fn();
beforeEach(() => {
  setupTauriMock({
    executeQuery: vi.fn(),
    executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
    // Sprint 247 — `<DryRunPreview>` IPC stub for confirm dialog.
    executeQueryDryRun: vi.fn(() => Promise.resolve([])),
    cancelQuery: vi.fn(() => Promise.resolve("cancelled")),
  });
});

vi.mock("@lib/toast", () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: vi.fn(),
    info: (msg: string) => mockToastInfo(msg),
    warn: vi.fn(),
  },
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer", category: "unknown" },
    { name: "name", data_type: "text", category: "unknown" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  total_count: 2,
  execution_time_ms: 5,
  query_type: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name"],
};

function makeConnection(
  id: string,
  environment: string | null,
): ConnectionConfig {
  return {
    id,
    name: `conn-${id}`,
    db_type: "postgres",
    host: "localhost",
    port: 5432,
    database: "app",
    username: "u",
    password: null,
    environment,
  } as unknown as ConnectionConfig;
}

function setup(env: string | null, mode: "strict" | "warn" | "off") {
  // Seed the connection store with a single connection that has the
  // requested environment tag. Reset any pending state on the safe mode
  // store between tests for hygiene.
  useConnectionStore.setState({
    connections: [makeConnection("conn1", env)],
  });
  useSafeModeStore.setState({ mode });
}

// We mock the SQL builder so each test can inject the exact statement the
// gate should see. The generator is PK-bounded and would never emit a
// WHERE-less DELETE on its own — so we substitute the builder's output
// to exercise the gate's response to dangerous shapes.
vi.mock("@lib/sql/rawQuerySqlBuilder", async (orig) => {
  const actual = await orig<typeof import("@lib/sql/rawQuerySqlBuilder")>();
  return {
    ...actual,
    buildRawEditSql: vi.fn(),
  };
});

import { buildRawEditSql } from "@lib/sql/rawQuerySqlBuilder";

describe("EditableQueryResultGrid — Sprint 185 Safe Mode gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteQueryBatch.mockResolvedValue([]);
  });

  function renderGrid() {
    return render(
      <EditableQueryResultGrid
        result={RESULT}
        connectionId="conn1"
        plan={PLAN}
      />,
    );
  }

  async function clickExecute(buildSqls: string[]) {
    vi.mocked(buildRawEditSql).mockReturnValue(buildSqls);
    renderGrid();
    const tds = document.querySelectorAll(
      '[role="row"][aria-rowindex="2"] [role="gridcell"]',
    );
    act(() => {
      fireEvent.doubleClick(tds[1]!);
    });
    const input = screen.getByLabelText("Editing name") as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: "Alicia" } });
    });
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    act(() => {
      screen.getByLabelText("Commit pending changes").click();
    });
    await waitFor(() => screen.getByLabelText("Execute SQL"));
    act(() => {
      screen.getByLabelText("Execute SQL").click();
    });
  }

  async function openPreviewAndExecute(buildSqls: string[]) {
    await clickExecute(buildSqls);
    // Strict + off + non-prod paths immediately fire either the toast (block)
    // or executeQueryBatch (pass). Warn paths use clickExecute directly and
    // assert against the dialog.
    await waitFor(() => {
      return (
        mockToastError.mock.calls.length +
          mockExecuteQueryBatch.mock.calls.length >
        0
      );
    });
  }

  it("[AC-185-05a] production + strict + WHERE-less DELETE → confirm dialog opens, executeQueryBatch not called", async () => {
    // Sprint 245 (ADR 0022 Phase 1) — was "block" under Sprint 244's
    // read-only policy. Production destructive now opens the confirm
    // dialog regardless of mode.
    setup("production", "strict");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-245-C3] production + strict + safe DML (UPDATE WHERE pk) → executeQueryBatch called once (Sprint 244 block reverted)", async () => {
    // Sprint 245 — was [AC-244-09] "block". Safe writes flow through
    // on production regardless of mode under the destructive-only
    // policy; Cmd+Z (Phase 5) is the safety net.
    setup("production", "strict");
    await openPreviewAndExecute([
      "UPDATE users SET name = 'Alicia' WHERE id = 1",
    ]);

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-185-05c] non-production + strict + WHERE-less DELETE → confirm dialog (M.1 new flow)", async () => {
    // Sprint 245 — was "passes through". Strict on non-production now
    // also opens the destructive dialog (M.1 — for shared-staging /
    // learning environments). Sprint 246 (ADR 0022 Phase 2) — non-prod
    // header reads "Destructive statement" + "Safe Mode (strict)"
    // subcaption (no "PRODUCTION DATABASE" shout).
    setup("development", "strict");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("Destructive statement");
    expect(screen.queryByText("PRODUCTION DATABASE")).not.toBeInTheDocument();
    expect(screen.getByText(/Safe Mode \(strict\)/)).toBeInTheDocument();
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
  });

  it("[AC-185-05c-2] non-production + warn + WHERE-less DELETE → passes through", async () => {
    // Sprint 245 — paired with the M.1 new flow above so the matrix
    // coverage stays complete: warn on non-prod does NOT open the
    // dialog even on destructive statements.
    setup("development", "warn");
    await openPreviewAndExecute(["DELETE FROM users"]);

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-245-L6] production + off + WHERE-less DELETE → confirm dialog with prod-auto reason copy", async () => {
    // Sprint 245 — was [AC-190-01-4] "block (prod-auto)". The
    // destructive-only policy opens the confirm dialog instead of
    // blocking; prod-auto reason copy ("production environment forces
    // Safe Mode — change connection environment tag to override") is
    // preserved in the dialog body.
    setup("production", "off");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(
      screen.getAllByText(/production environment forces Safe Mode/).length,
    ).toBeGreaterThan(0);
  });

  it("[AC-186-05a] production + warn + WHERE-less DELETE → ConfirmDestructiveDialog opens, executeQueryBatch not called", async () => {
    // Sprint 246 (ADR 0022 Phase 2) — header is "PRODUCTION DATABASE"
    // and the Confirm button is enabled immediately (no type-to-confirm
    // gate). The mount-only invariant (no commit until user clicks
    // Confirm) is preserved.
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    const confirmBtn = screen.getByTestId("confirm-destructive-confirm");
    expect(confirmBtn).not.toBeDisabled();
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-186-05b] warn dialog Confirm click → executeQueryBatch called", async () => {
    // Sprint 246 — Confirm is a single click; type-to-confirm gate
    // removed.
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    act(() => {
      screen.getByTestId("confirm-destructive-confirm").click();
    });
    await waitFor(() => {
      expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    });
  });

  it("[AC-186-05c] warn dialog Cancel → executeError set with warn message + toast.info", async () => {
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    act(() => {
      screen.getByTestId("confirm-destructive-cancel").click();
    });
    await waitFor(() => {
      expect(mockToastInfo).toHaveBeenCalledWith(
        expect.stringMatching(/Safe Mode \(warn\): confirmation cancelled/),
      );
    });
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /confirmation cancelled/,
    );
  });
});

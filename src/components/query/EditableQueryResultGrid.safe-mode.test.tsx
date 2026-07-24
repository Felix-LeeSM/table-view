// EditableQueryResultGrid Safe Mode gate — SURFACE WIRING contract only.
//
// Sprint 185/186 originally enumerated the full env×mode×severity matrix
// (prod/strict|warn|off × destructive/safe) here AND in
// `QueryTab.safe-mode.test.tsx` — the same decision matrix re-verified on two
// surfaces. Issue #1623 (2026-07-24) dedups: the decision matrix SOT is the
// unit layer —
//   - `src/lib/safeMode.test.ts` (`decideSafeModeAction`, L1..L8 + reason copy)
//   - `src/hooks/useSafeModeGate.test.ts` (store/env wiring into that decision)
// the ConfirmDestructiveDialog rendering (prod vs non-prod header, reason copy,
// confirm arming) is owned by `ConfirmDestructiveDialog.test.tsx`, and the
// allow→executeQueryBatch happy path by `EditableQueryResultGrid.test.tsx`.
//
// This file keeps only the representative cells that prove the gate decision
// is wired into THIS surface's real commit path (`executeQueryBatch`):
//   - prod+strict destructive → ConfirmDestructiveDialog opens, batch NOT run
//   - prod+warn confirm click → batch runs (and NOT before confirm)
//   - dialog Cancel → batch NOT run, cancellation surfaced (security path)
//
// date 2026-05-01 (initial), 2026-07-24 (#1623 matrix dedup).
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

vi.mock("@lib/runtime/toast", () => ({
  toast: {
    error: (msg: string) => mockToastError(msg),
    success: vi.fn(),
    info: (msg: string) => mockToastInfo(msg),
    warn: vi.fn(),
  },
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", dataType: "integer", category: "unknown" },
    { name: "name", dataType: "text", category: "unknown" },
  ],
  rows: [
    [1, "Alice"],
    [2, "Bob"],
  ],
  totalCount: 2,
  executionTimeMs: 5,
  queryType: "select",
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
    dbType: "postgres",
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

describe("EditableQueryResultGrid — Safe Mode gate → executeQueryBatch wiring", () => {
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

  it("[AC-185-05a] production + strict + destructive → confirm dialog opens, executeQueryBatch NOT called", async () => {
    // Representative "destructive → dialog" wiring: the gate decision
    // (confirm) routes to ConfirmDestructiveDialog instead of the commit
    // path. Full env×mode matrix lives in the unit SOT (safeMode.test.ts /
    // useSafeModeGate.test.ts). (2026-05-01)
    setup("production", "strict");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-186-05b] warn dialog Confirm click → executeQueryBatch runs (and NOT before confirm)", async () => {
    // Representative "confirm → execute" wiring. Sprint 246 — Confirm is a
    // single click; #1111 — it arms after a short delay to absorb a
    // reflexive Enter, so we wait for it to enable before asserting the
    // commit path fires exactly once. (2026-05-01)
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("PRODUCTION DATABASE");
    const confirmBtn = screen.getByTestId("confirm-destructive-confirm");
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());
    // Gate held the commit until the user confirms.
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    act(() => {
      confirmBtn.click();
    });
    await waitFor(() => {
      expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    });
  });

  it("[AC-186-05c] warn dialog Cancel → executeError set with warn message + toast.info, executeQueryBatch NOT called", async () => {
    // Security path: cancelling the destructive dialog must not commit and
    // must surface the cancellation on this surface. (2026-05-01)
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

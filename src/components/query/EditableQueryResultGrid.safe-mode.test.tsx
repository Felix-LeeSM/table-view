// AC-185-05 — EditableQueryResultGrid Safe Mode gate. 4 cases per Sprint 185.
// AC-186-05 — Sprint 186 adds warn-tier dialog handoff (3 cases).
// date 2026-05-01.
//
// Same gate shape as useDataGridEdit — block when (production + strict +
// dangerous statement). Block aborts before executeQueryBatch and surfaces
// the standardized "Safe Mode blocked: ..." message via state + toast.
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
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

vi.mock("@lib/tauri", () => ({
  executeQuery: vi.fn(),
  executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
}));

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
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
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
    const tds = document.querySelectorAll("tbody tr:first-child td");
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

  it("[AC-185-05a] production + strict + WHERE-less DELETE → blocked, executeQueryBatch not called", async () => {
    setup("production", "strict");
    await openPreviewAndExecute(["DELETE FROM users"]);

    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/Safe Mode blocked.*DELETE without WHERE/),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/Safe Mode blocked/);
  });

  it("[AC-185-05b] production + strict + safe DML → passes through to executeQueryBatch", async () => {
    setup("production", "strict");
    await openPreviewAndExecute([
      "UPDATE users SET name = 'Alicia' WHERE id = 1",
    ]);

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-185-05c] non-production + strict + WHERE-less DELETE → passes (env-gated)", async () => {
    setup("development", "strict");
    await openPreviewAndExecute(["DELETE FROM users"]);

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-185-05d] production + off + WHERE-less DELETE → passes (mode override)", async () => {
    setup("production", "off");
    await openPreviewAndExecute(["DELETE FROM users"]);

    expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  function getWarnDialog() {
    // Scope queries to the AlertDialogContent (warn dialog) so the SQL
    // preview Dialog's Cancel button doesn't collide.
    return screen
      .getByText("Confirm dangerous statement")
      .closest('[data-slot="alert-dialog-content"]')! as HTMLElement;
  }

  it("[AC-186-05a] production + warn + WHERE-less DELETE → ConfirmDangerousDialog opens, executeQueryBatch not called", async () => {
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("Confirm dangerous statement");
    const dialog = getWarnDialog();
    const confirmBtn = within(dialog).getByRole("button", {
      name: "Run anyway",
    });
    expect(confirmBtn).toBeDisabled();
    expect(mockExecuteQueryBatch).not.toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("[AC-186-05b] warn dialog Confirm with reason typed → executeQueryBatch called", async () => {
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("Confirm dangerous statement");
    const dialog = getWarnDialog();
    const input = within(dialog).getByTestId(
      "confirm-dangerous-input",
    ) as HTMLInputElement;
    act(() => {
      fireEvent.change(input, {
        target: { value: "DELETE without WHERE clause" },
      });
    });
    const confirmBtn = within(dialog).getByRole("button", {
      name: "Run anyway",
    });
    act(() => {
      confirmBtn.click();
    });
    await waitFor(() => {
      expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    });
  });

  it("[AC-186-05c] warn dialog Cancel → executeError set with warn message + toast.info", async () => {
    setup("production", "warn");
    await clickExecute(["DELETE FROM users"]);

    await screen.findByText("Confirm dangerous statement");
    const dialog = getWarnDialog();
    act(() => {
      within(dialog).getByRole("button", { name: "Cancel" }).click();
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

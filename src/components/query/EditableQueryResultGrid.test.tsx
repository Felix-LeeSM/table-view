import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import EditableQueryResultGrid from "./EditableQueryResultGrid";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/rawQuerySqlBuilder";

const mockExecuteQuery = vi.fn();
const mockExecuteQueryBatch = vi.fn();
vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
  executeQueryBatch: (...args: unknown[]) => mockExecuteQueryBatch(...args),
}));

const RESULT: QueryResult = {
  columns: [
    { name: "id", data_type: "integer" },
    { name: "name", data_type: "text" },
    { name: "email", data_type: "varchar" },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
  ],
  total_count: 2,
  execution_time_ms: 5,
  query_type: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name", "email"],
};

function renderGrid(
  overrides: Partial<React.ComponentProps<typeof EditableQueryResultGrid>> = {},
) {
  return render(
    <EditableQueryResultGrid
      result={RESULT}
      connectionId="conn1"
      plan={PLAN}
      {...overrides}
    />,
  );
}

describe("EditableQueryResultGrid", () => {
  beforeEach(() => {
    mockExecuteQuery.mockReset();
    mockExecuteQuery.mockResolvedValue({});
    mockExecuteQueryBatch.mockReset();
    // Sprint 183 — default to a happy-path batch resolve so the legacy
    // tests that don't override the mock still see a successful commit.
    mockExecuteQueryBatch.mockResolvedValue([]);
  });

  it("renders rows and PK column marker", () => {
    renderGrid();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByLabelText("Primary key")).toBeInTheDocument();
  });

  it("enters edit mode on double-click and shows the editing input", () => {
    renderGrid();
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.doubleClick(tds[1]!); // 'Alice' cell
    });

    const input = screen.getByLabelText("Editing name") as HTMLInputElement;
    expect(input.value).toBe("Alice");
  });

  it("does NOT add a pending edit when value is unchanged", () => {
    renderGrid();
    const tds = document.querySelectorAll("tbody tr:first-child td");

    act(() => {
      fireEvent.doubleClick(tds[1]!);
    });
    const input = screen.getByLabelText("Editing name") as HTMLInputElement;

    // Press Enter without changing the value
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });

    // No pending toolbar should appear
    expect(
      screen.queryByLabelText("Commit pending changes"),
    ).not.toBeInTheDocument();
  });

  it("adds pending edit when value changes; toolbar shows + commit opens preview", async () => {
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

    expect(screen.getByText(/1 edit/)).toBeInTheDocument();

    act(() => {
      screen.getByLabelText("Commit pending changes").click();
    });

    // SQL preview dialog appears with the UPDATE statement
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(
      /UPDATE "public"\."users" SET "name" = 'Alicia' WHERE "id" = 1/,
    );
  });

  it("Discard clears pending changes", () => {
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

    expect(screen.getByLabelText("Commit pending changes")).toBeInTheDocument();

    act(() => {
      screen.getByLabelText("Discard pending changes").click();
    });

    expect(
      screen.queryByLabelText("Commit pending changes"),
    ).not.toBeInTheDocument();
  });

  it("right-click → Delete Row queues a deletion and shows commit toolbar", () => {
    renderGrid();
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.contextMenu(tds[0]!, { clientX: 50, clientY: 50 });
    });

    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete Row" }));
    });

    expect(screen.getByText(/1 delete/)).toBeInTheDocument();
  });

  it("Cmd+S shortcut opens the SQL preview when there are pending changes", async () => {
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
      window.dispatchEvent(new Event("commit-changes"));
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/UPDATE/);
  });

  it("[AC-183-08c] Execute calls executeQueryBatch once with all statements and triggers onAfterCommit", async () => {
    // Sprint 183 — single transaction batch (was: N × executeQuery loop).
    const onAfterCommit = vi.fn();
    renderGrid({ onAfterCommit });
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

    const execBtn = await screen.findByLabelText("Execute SQL");
    await act(async () => {
      execBtn.click();
    });

    await waitFor(() => {
      expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    });
    // Sprint 183 — single batch call with the connection id, the array
    // of statements, and a query id. Legacy single-statement helper is
    // not invoked.
    expect(mockExecuteQueryBatch).toHaveBeenCalledWith(
      "conn1",
      [expect.stringMatching(/UPDATE/)],
      expect.any(String),
    );
    expect(mockExecuteQuery).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(onAfterCommit).toHaveBeenCalled();
    });
  });

  // [AC-182-03a] Defense-in-depth: when `analyzeResultEditability` is bypassed
  // and a PK-less plan reaches us, double-click must not open the editor.
  // 2026-05-01 — without this guard, `buildPkWhere` would emit `WHERE ;` and
  // the DB would reject with a syntax error on Commit.
  it("[AC-182-03a] does not open the editor on double-click when pkColumns is empty", () => {
    renderGrid({ plan: { ...PLAN, pkColumns: [] } });
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.doubleClick(tds[1]!);
    });
    expect(screen.queryByLabelText("Editing name")).not.toBeInTheDocument();
  });

  // [AC-182-03b] PK-less plan must mark the context-menu Delete as
  // aria-disabled so a keyboard user sees the same gate. 2026-05-01.
  it("[AC-182-03b] marks context-menu Delete as aria-disabled when pkColumns is empty", () => {
    renderGrid({ plan: { ...PLAN, pkColumns: [] } });
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.contextMenu(tds[0]!, { clientX: 50, clientY: 50 });
    });
    const item = screen.getByRole("menuitem", { name: "Delete Row" });
    expect(item).toHaveAttribute("aria-disabled", "true");
  });

  // [AC-182-03c] PK-less plan must surface a one-line banner so a future
  // caller (or a tester poking the component directly) sees why it is
  // read-only. 2026-05-01 — exact text pinned by the contract Verification
  // Plan grep.
  it("[AC-182-03c] renders the read-only banner when pkColumns is empty", () => {
    renderGrid({ plan: { ...PLAN, pkColumns: [] } });
    expect(
      screen.getByText("Read-only — primary key required to edit"),
    ).toBeInTheDocument();
  });

  // [AC-182-06a] Regression: mounting the tray must not break the legacy
  // SQL preview / Commit / Discard / Cmd+S path. 2026-05-01 — drives a
  // pending edit through the tray and asserts the existing Commit dialog
  // still opens with the same UPDATE statement.
  it("[AC-182-06a] tray mounts but Commit/SQL preview path is unchanged", async () => {
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

    // Tray header reflects the same single-source counter as the toolbar.
    expect(
      screen.getByRole("region", { name: "Pending changes" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 change pending/)).toBeInTheDocument();

    // Cmd+S still drives the dialog open with the same UPDATE.
    act(() => {
      window.dispatchEvent(new Event("commit-changes"));
    });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(
      /UPDATE "public"\."users" SET "name" = 'Alicia' WHERE "id" = 1/,
    );
  });

  // Sprint 183 — regression that the Cmd+S → SQL preview → Execute path
  // still flows all the way through to executeQueryBatch. The dialog body
  // must still render the per-statement SQL list (Sprint 87 contract) so a
  // user can review individual statements before committing.
  it("[AC-183-08d] Cmd+S → SQL preview lists each statement; Execute runs the batch", async () => {
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
      window.dispatchEvent(new Event("commit-changes"));
    });

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(
      /UPDATE "public"\."users" SET "name" = 'Alicia' WHERE "id" = 1/,
    );

    const execBtn = await screen.findByLabelText("Execute SQL");
    await act(async () => {
      execBtn.click();
    });
    await waitFor(() => {
      expect(mockExecuteQueryBatch).toHaveBeenCalledTimes(1);
    });
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  it("[AC-183-08c] Execute surfaces rolled-back batch failure without clearing the dialog", async () => {
    // Sprint 183 — backend rolls back atomically; the catch block surfaces
    // "Commit failed — all changes rolled back: <message>" and keeps the
    // SQL preview dialog open so the user can re-try without losing the
    // pending edits.
    mockExecuteQueryBatch.mockRejectedValueOnce(
      new Error("statement 1 of 1 failed: permission denied"),
    );
    renderGrid();
    const tds = document.querySelectorAll("tbody tr:first-child td");
    act(() => {
      fireEvent.contextMenu(tds[0]!, { clientX: 0, clientY: 0 });
    });
    act(() => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete Row" }));
    });
    act(() => {
      screen.getByLabelText("Commit pending changes").click();
    });

    const execBtn = await screen.findByLabelText("Execute SQL");
    await act(async () => {
      execBtn.click();
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("permission denied");
    expect(alert).toHaveTextContent("all changes rolled back");
    // Old per-statement wording is gone.
    expect(alert.textContent ?? "").not.toMatch(/executed: \d/);
  });

  it("[AC-185-06] Preview Dialog header renders environment color stripe (production red)", async () => {
    // AC-185-06 — visual confirmation that the user is committing into a
    // production-tagged connection. The stripe is a 1px coloured div above
    // the dialog header, with `data-environment-stripe` for test queries.
    // date 2026-05-01.
    const { useConnectionStore } = await import("@stores/connectionStore");
    useConnectionStore.setState({
      connections: [
        {
          id: "conn1",
          name: "prod-conn",
          db_type: "postgres",
          host: "localhost",
          port: 5432,
          database: "app",
          username: "u",
          password: null,
          environment: "production",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
    });
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
    const stripe = await waitFor(() =>
      document.querySelector('[data-environment-stripe="production"]'),
    );
    expect(stripe).not.toBeNull();
    expect((stripe as HTMLElement).style.background).toMatch(
      /#ef4444|rgb\(239,?\s*68,?\s*68\)/i,
    );
    // Reset for hygiene.
    useConnectionStore.setState({ connections: [] });
  });
});

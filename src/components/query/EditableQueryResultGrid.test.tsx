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
vi.mock("@lib/tauri", () => ({
  executeQuery: (...args: unknown[]) => mockExecuteQuery(...args),
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

  it("Execute calls executeQuery for each statement and triggers onAfterCommit", async () => {
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
      expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    });
    expect(mockExecuteQuery).toHaveBeenCalledWith(
      "conn1",
      expect.stringMatching(/UPDATE/),
      expect.any(String),
    );
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

  it("Execute surfaces errors from executeQuery without clearing the dialog", async () => {
    mockExecuteQuery.mockRejectedValueOnce(new Error("permission denied"));
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

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "permission denied",
    );
  });
});

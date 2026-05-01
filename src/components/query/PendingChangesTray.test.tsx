import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PendingChangesTray from "./PendingChangesTray";
import type { QueryResult } from "@/types/query";
import type { RawEditPlan } from "@lib/rawQuerySqlBuilder";

// Sprint 182 — pending-changes tray is the per-AC visible surface for
// AC-182-01, 02, 04, 05. The tray is stateless: every assertion below
// drives state via props and verifies the rendered DOM (no store, no
// effect timers).

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
  execution_time_ms: 1,
  query_type: "select",
};

const PLAN: RawEditPlan = {
  schema: "public",
  table: "users",
  pkColumns: ["id"],
  resultColumnNames: ["id", "name", "email"],
};

function renderTray(
  overrides: Partial<React.ComponentProps<typeof PendingChangesTray>> = {},
) {
  return render(
    <PendingChangesTray
      result={RESULT}
      pendingEdits={new Map()}
      pendingDeletedRowKeys={new Set()}
      plan={PLAN}
      onRevertEdit={vi.fn()}
      onRevertDelete={vi.fn()}
      {...overrides}
    />,
  );
}

describe("PendingChangesTray", () => {
  // [AC-182-01a] Empty inputs render nothing so the parent layout stays
  // clean. 2026-05-01 — `return null` keeps the surface from claiming a
  // row of vertical space when nothing is pending.
  it("renders nothing when there are no pending changes", () => {
    const { container } = renderTray();
    expect(container.firstChild).toBeNull();
  });

  // [AC-182-01b] Single edit shows column / old / new / SQL.
  // 2026-05-01 — the SQL cell uses `buildRawEditSql` so it stays in lock
  // step with the Sprint 87 Preview Dialog.
  it("renders one row per pending edit with column, old, new, and SQL", () => {
    const edits = new Map<string, string>([["0-1", "Alicia"]]);
    renderTray({ pendingEdits: edits });
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Alicia")).toBeInTheDocument();
    const code = screen.getByText(
      /UPDATE\s+"public"\."users"\s+SET\s+"name"\s+=\s+'Alicia'\s+WHERE\s+"id"\s+=\s+1;/,
    );
    expect(code.tagName).toBe("CODE");
  });

  // [AC-182-01c] Single delete shows DELETE label + PK identifier.
  // 2026-05-01 — the PK label condenses every PK column = value pair so
  // the user can spot which row is going away without scrolling the grid.
  it("renders one row per pending delete with DELETE label", () => {
    const deletes = new Set<string>(["row-1-0"]);
    renderTray({ pendingDeletedRowKeys: deletes });
    expect(screen.getByText("DELETE")).toBeInTheDocument();
    expect(screen.getByText("id=1")).toBeInTheDocument();
    expect(
      screen.getByText(
        /DELETE\s+FROM\s+"public"\."users"\s+WHERE\s+"id"\s+=\s+1;/,
      ),
    ).toBeInTheDocument();
  });

  // [AC-182-01d] Mixed (edit + delete) renders both rows in a stable
  // section. 2026-05-01 — Map/Set iteration order matches insertion;
  // edits come first because `buildEntries` walks edits, then deletes.
  it("renders both edit and delete rows when both are present", () => {
    const edits = new Map<string, string>([["0-2", "alice@new.com"]]);
    const deletes = new Set<string>(["row-1-1"]);
    renderTray({ pendingEdits: edits, pendingDeletedRowKeys: deletes });
    expect(screen.getByText("email")).toBeInTheDocument();
    expect(screen.getByText("alice@new.com")).toBeInTheDocument();
    expect(screen.getByText("DELETE")).toBeInTheDocument();
    expect(screen.getByText("id=2")).toBeInTheDocument();
  });

  // [AC-182-02a] X click on edit row invokes onRevertEdit with the
  // pending-edit key. 2026-05-01 — the parent is single source of truth;
  // tray only signals.
  it("invokes onRevertEdit with the key when the X button is clicked", () => {
    const onRevertEdit = vi.fn();
    const edits = new Map<string, string>([["0-1", "Alicia"]]);
    renderTray({ pendingEdits: edits, onRevertEdit });
    fireEvent.click(screen.getByRole("button", { name: /Revert name/i }));
    expect(onRevertEdit).toHaveBeenCalledWith("0-1");
  });

  // [AC-182-02b] X click on delete row invokes onRevertDelete with the
  // rowKey. 2026-05-01 — symmetric to the edit revert path.
  it("invokes onRevertDelete with the rowKey when the delete X is clicked", () => {
    const onRevertDelete = vi.fn();
    const deletes = new Set<string>(["row-1-0"]);
    renderTray({ pendingDeletedRowKeys: deletes, onRevertDelete });
    fireEvent.click(
      screen.getByRole("button", { name: /Revert delete row id=1/i }),
    );
    expect(onRevertDelete).toHaveBeenCalledWith("row-1-0");
  });

  // [AC-182-04a] Empty new value is shown as italic NULL with a
  // tooltip. 2026-05-01 — pins the historical "" → SQL NULL convention
  // visibly so the user does not mistake an empty cell for a no-op.
  it("renders italic NULL with a tooltip when the new value is empty", () => {
    const edits = new Map<string, string>([["0-1", ""]]);
    renderTray({ pendingEdits: edits });
    const nullSpan = screen.getByText("NULL");
    expect(nullSpan).toHaveClass("italic");
    expect(nullSpan.getAttribute("title")).toMatch(/SQL NULL/i);
  });

  // [AC-182-05a] Header counter equals edits + deletes from the props.
  // 2026-05-01 — single source of truth keeps the toolbar count and the
  // tray header from drifting.
  it("displays a header counter equal to edits + deletes", () => {
    const edits = new Map<string, string>([
      ["0-1", "Alicia"],
      ["0-2", "alice@new.com"],
    ]);
    const deletes = new Set<string>(["row-1-1"]);
    renderTray({ pendingEdits: edits, pendingDeletedRowKeys: deletes });
    expect(screen.getByText(/3 changes pending/)).toBeInTheDocument();
  });
});

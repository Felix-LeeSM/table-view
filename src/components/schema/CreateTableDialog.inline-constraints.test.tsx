import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import {
  activateTab,
  getColumnsPanel,
  mockAddConstraint,
  mockCreateTable,
  renderDialog,
  setDevConnection,
} from "./__tests__/createTableDialogTestHelpers";

// ── Sprint 241 — inline FK + CHECK on column row ──────────────────────
//
// Date: 2026-05-08.
//
// Why these tests exist:
//
// Sprint 241 moves single-column FK + CHECK out of the Constraints tab
// and onto the column row itself (TablePlus parity). The column-row
// `+ FK` cell opens a popover for ref schema/table/column + ON
// DELETE/UPDATE; the inline `check expression (optional, …)` text
// input takes free-text expressions. Both feed the same constraint
// chain the Constraints tab does — auto-named `fk_<table>_<col>` /
// `chk_<table>_<col>` so multiple inline declarations don't collide.
// Multi-column variants stay in the Constraints tab; the tab now
// renders a one-line scope reminder.
//
// Per AC-241 contract Test Requirements: ≥ 4 cases — column-row UI
// presence, inline CHECK chain pickup, inline FK chain pickup, the
// Constraints-tab reminder copy.
describe("Sprint 241 — inline FK + CHECK on column row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({ connections: [] });
    useSafeModeStore.setState({ mode: "off" });
    useQueryHistoryStore.setState({ recentVisible: [] });
    mockCreateTable.mockResolvedValue({
      sql: 'CREATE TABLE "public"."t" ()',
    });
    mockAddConstraint.mockImplementation(
      async (req: {
        constraint_name: string;
        definition: { type: string };
      }) => ({
        sql: `-- ${req.definition.type} ${req.constraint_name}`,
      }),
    );
    setDevConnection();
  });

  it("renders the inline FK trigger + inline CHECK input on each column row", () => {
    renderDialog();
    const columnsPanel = getColumnsPanel();
    // Empty FK trigger label = `+ FK`.
    const fkTriggers = within(columnsPanel).getAllByLabelText(
      /Foreign key for column /i,
    );
    expect(fkTriggers).toHaveLength(1);
    expect(fkTriggers[0]!.textContent).toContain("+ FK");

    // Inline CHECK input.
    const chkInputs = within(columnsPanel).getAllByLabelText(
      "Column check expression",
    );
    expect(chkInputs).toHaveLength(1);
  });

  it("inline CHECK expression flows into the constraint chain with auto-name chk_<table>_<column>", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "users" },
    });
    const columnsPanel = getColumnsPanel();
    const nameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(nameInput, { target: { value: "age" } });
    const typeInput = within(columnsPanel).getByLabelText("Column data type");
    fireEvent.change(typeInput, { target: { value: "integer" } });
    const chkInput = within(columnsPanel).getByLabelText(
      "Column check expression",
    );
    fireEvent.change(chkInput, { target: { value: "age >= 0" } });

    await waitFor(() =>
      expect(mockAddConstraint).toHaveBeenCalledWith(
        expect.objectContaining({
          constraint_name: "chk_users_age",
          definition: { type: "check", expression: "age >= 0" },
        }),
      ),
    );
  });

  it("inline FK fields flow into the constraint chain with auto-name fk_<table>_<column>", async () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText("Table name"), {
      target: { value: "orders" },
    });
    const columnsPanel = getColumnsPanel();
    const nameInput = within(columnsPanel).getByLabelText("Column name");
    fireEvent.change(nameInput, { target: { value: "user_id" } });
    const typeInput = within(columnsPanel).getByLabelText("Column data type");
    fireEvent.change(typeInput, { target: { value: "integer" } });

    // Open the FK popover and fill ref_table + ref_column via the
    // free-text fallback inputs (cache is empty — no Select renders).
    const fkTrigger = within(columnsPanel).getByLabelText(
      /Foreign key for column /i,
    );
    fireEvent.click(fkTrigger);
    const refTableInput = await screen.findByLabelText(
      "Inline FK reference table",
    );
    fireEvent.change(refTableInput, { target: { value: "users" } });
    const refColumnInput = screen.getByLabelText("Inline FK reference column");
    fireEvent.change(refColumnInput, { target: { value: "id" } });

    await waitFor(() =>
      expect(mockAddConstraint).toHaveBeenCalledWith(
        expect.objectContaining({
          constraint_name: "fk_orders_user_id",
          definition: expect.objectContaining({
            type: "foreign_key",
            columns: ["user_id"],
            reference_table: "users",
            reference_columns: ["id"],
          }),
        }),
      ),
    );
  });

  it("Constraints tab surfaces the multi-column scope reminder", () => {
    // Sprint 241 — each sub-tab carries its own tailored scope
    // reminder (FK / CHECK / UNIQUE) rather than a single combined
    // message. The FK sub-tab is active by default; its reminder is
    // visible immediately after opening the parent Constraints tab.
    renderDialog();
    activateTab("Constraints");
    expect(
      screen.getByText(
        /Single-column foreign keys are edited inline on the column row/i,
      ),
    ).toBeInTheDocument();
  });
});

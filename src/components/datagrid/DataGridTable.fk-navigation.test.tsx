/**
 * Sprint-89 (#FK-1) AC-04 — FK navigation integration test.
 *
 * Renders `DataGridTable` with a column that carries
 * `is_foreign_key: true` + `fk_reference: "<schema>.<table>(<column>)"` and
 * proves that clicking the link icon dispatches the correct
 * `onNavigateToFk(schema, table, column, value)` 4-tuple.
 *
 * Companion checks the negative space too: NULL cells must not render the
 * icon, and non-FK columns must not render it either, otherwise the user
 * would see a dead-link hint where no jump is possible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

const FK_DATA: TableData = {
  columns: [
    {
      name: "id",
      data_type: "integer",
      nullable: false,
      default_value: null,
      is_primary_key: true,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "user_id",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: true,
      fk_reference: "public.users(id)",
      comment: null,
    },
  ],
  rows: [
    [1, 42],
    [2, null],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.orders LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: FK_DATA,
    loading: false,
    sorts: [],
    columnWidths: {} as Record<string, number>,
    columnOrder: [0, 1] as number[],
    editingCell: null as { row: number; col: number } | null,
    editValue: "",
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "orders",
    onSetEditValue: vi.fn(),
    onSetEditNull: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onColumnWidthsChange: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

describe("DataGridTable — FK navigation (sprint-89 #FK-1 AC-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clicking the FK icon calls onNavigateToFk with (schema, table, column, cellValue)", async () => {
    const user = userEvent.setup();
    const onNavigateToFk = vi.fn();

    render(<DataGridTable {...makeProps({ onNavigateToFk })} />);

    // Two FK cells render in the column with one non-null row (`user_id = 42`).
    const fkButtons = screen.getAllByRole("button", {
      name: /Open referenced row in public\.users/i,
    });
    expect(fkButtons).toHaveLength(1);

    await user.click(fkButtons[0]!);

    expect(onNavigateToFk).toHaveBeenCalledTimes(1);
    expect(onNavigateToFk).toHaveBeenCalledWith("public", "users", "id", "42");
  });

  it("does not render the FK icon for NULL cells", () => {
    const onNavigateToFk = vi.fn();

    render(<DataGridTable {...makeProps({ onNavigateToFk })} />);

    // The second row's `user_id` is null — only one FK button should exist.
    const fkButtons = screen.queryAllByRole("button", {
      name: /Open referenced row in public\.users/i,
    });
    expect(fkButtons).toHaveLength(1);
  });

  it("does not render the FK icon when the column is not a foreign key", () => {
    const NON_FK_DATA: TableData = {
      ...FK_DATA,
      columns: FK_DATA.columns.map((c) => ({
        ...c,
        is_foreign_key: false,
        fk_reference: null,
      })),
    };
    const onNavigateToFk = vi.fn();

    render(
      <DataGridTable {...makeProps({ data: NON_FK_DATA, onNavigateToFk })} />,
    );

    expect(
      screen.queryByRole("button", {
        name: /Open referenced row/i,
      }),
    ).toBeNull();
  });

  it("renders the FK icon at minimum visibility (opacity-40) on every FK + non-null cell", () => {
    // Sprint-89 (#FK-3): the icon should be discoverable without hover.
    // We assert on the className contract because jsdom does not run
    // Tailwind, so computed style would not reflect group-hover state.
    const onNavigateToFk = vi.fn();

    render(<DataGridTable {...makeProps({ onNavigateToFk })} />);

    const fkButton = screen.getByRole("button", {
      name: /Open referenced row in public\.users/i,
    });
    expect(fkButton.className).toContain("opacity-40");
    expect(fkButton.className).toContain("group-hover/cell:opacity-100");
    // Pre-sprint-89 the icon was hidden by `invisible` until hover —
    // make sure we did not regress to that.
    expect(fkButton.className).not.toContain("invisible");
  });
});

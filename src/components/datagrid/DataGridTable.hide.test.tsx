// Sprint 318 (2026-05-15) — Slice D.2: DataGridTable hide column.
//
// 작성 이유: paradigm-shared `DataGridTable` 의 `hiddenColumnNames` +
// `onHideColumn` prop 도입이 (a) hidden column 의 header / row /
// pendingNewRows / aria-colcount 를 모두 drop 하고 (b) 미제공 시
// 기존 동작이 바뀌지 않는지 회귀 가드. RDB DataGrid 차원의 wire-up
// (배지 + persist) 은 `rdb/DataGrid.hide.test.tsx` 가 검증.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

const MOCK_DATA: TableData = {
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
      name: "name",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
    {
      name: "email",
      data_type: "text",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [
    [1, "Alice", "alice@example.com"],
    [2, "Bob", "bob@example.com"],
  ],
  total_count: 2,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM users",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnOrder: [0, 1, 2] as number[],
    editingCell: null as { row: number; col: number } | null,
    editValue: "",
    pendingEdits: new Map<string, string | null>(),
    selectedRowIds: new Set<number>(),
    pendingDeletedRowKeys: new Set<string>(),
    pendingNewRows: [] as unknown[][],
    page: 1,
    schema: "public",
    table: "users",
    onSetEditValue: vi.fn(),
    onSetEditNull: vi.fn(),
    onSaveCurrentEdit: vi.fn(),
    onCancelEdit: vi.fn(),
    onStartEdit: vi.fn(),
    onSelectRow: vi.fn(),
    onSort: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("DataGridTable — hide column (Sprint 318 D.2)", () => {
  it("renders every column when hiddenColumnNames is not provided (회귀 가드)", () => {
    render(<DataGridTable {...makeProps()} />);
    const headers = Array.from(
      document.querySelectorAll('[role="columnheader"]'),
    );
    expect(headers).toHaveLength(3);
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-colcount", "3");
  });

  it("drops hidden columns from the header row", () => {
    render(
      <DataGridTable
        {...makeProps({ hiddenColumnNames: new Set<string>(["email"]) })}
      />,
    );
    const headers = Array.from(
      document.querySelectorAll('[role="columnheader"]'),
    );
    expect(headers).toHaveLength(2);
    const headerTexts = headers.map((h) => h.textContent ?? "");
    expect(headerTexts.some((t) => t.includes("email"))).toBe(false);
    expect(headerTexts.some((t) => t.includes("id"))).toBe(true);
    expect(headerTexts.some((t) => t.includes("name"))).toBe(true);
  });

  it("drops hidden cells from each body row and updates aria-colcount", () => {
    render(
      <DataGridTable
        {...makeProps({ hiddenColumnNames: new Set<string>(["email"]) })}
      />,
    );
    expect(screen.queryByText("alice@example.com")).toBeNull();
    expect(screen.queryByText("bob@example.com")).toBeNull();
    // Remaining columns survive in the row.
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();

    const grid = screen.getByRole("grid");
    expect(grid).toHaveAttribute("aria-colcount", "2");

    // The CSS `--cols` template should carry exactly 2 px sizes
    // (one per visible column). `style` is set as a property.
    const cols = (grid as HTMLElement).style.getPropertyValue("--cols").trim();
    expect(cols.split(/\s+/)).toHaveLength(2);
  });

  it("forwards onHideColumn to the header context menu", () => {
    const onHideColumn = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          // include another callback so the context menu actually mounts
          onSortColumn: vi.fn(),
          onHideColumn,
        })}
      />,
    );
    const nameHeader = Array.from(
      document.querySelectorAll('[role="columnheader"]'),
    ).find((h) => h.textContent?.includes("name"))! as HTMLElement;
    fireEvent.contextMenu(nameHeader);
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide column" }));
    expect(onHideColumn).toHaveBeenCalledWith("name");
  });

  it("drops hidden columns from pendingNewRows too", () => {
    render(
      <DataGridTable
        {...makeProps({
          hiddenColumnNames: new Set<string>(["email"]),
          pendingNewRows: [[null, "Pending", "pending@example.com"]],
        })}
      />,
    );
    // The pending row contributes a `[role="row"]` with NULL / Pending
    // cells. The "pending@example.com" cell must NOT render.
    expect(screen.queryByText("pending@example.com")).toBeNull();
    // The pending row's other cells still render.
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("Hide column item is absent when no onHideColumn callback is wired", () => {
    render(<DataGridTable {...makeProps({ onSortColumn: vi.fn() })} />);
    const nameHeader = Array.from(
      document.querySelectorAll('[role="columnheader"]'),
    ).find((h) => h.textContent?.includes("name"))! as HTMLElement;
    fireEvent.contextMenu(nameHeader);
    expect(screen.queryByRole("menuitem", { name: "Hide column" })).toBeNull();
    // Sanity: other items still mounted via onSortColumn.
    expect(
      within(document.body).queryByRole("menuitem", { name: "Sort ASC" }),
    ).toBeInTheDocument();
  });
});

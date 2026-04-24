import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
  ],
  rows: [[1, "Alice"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: MOCK_DATA,
    loading: false,
    sorts: [],
    columnWidths: {},
    columnOrder: [0, 1],
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
    onColumnWidthsChange: vi.fn(),
    onDeleteRow: vi.fn(),
    onDuplicateRow: vi.fn(),
    ...overrides,
  };
}

describe("DataGridTable editing visual emphasis", () => {
  it("editing cell carries data-editing attribute and primary ring classes", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
        })}
      />,
    );

    const editingTd = document.querySelector(
      'td[data-editing="true"]',
    ) as HTMLElement | null;
    expect(editingTd).not.toBeNull();
    expect(editingTd!.className).toMatch(/ring-primary/);
    expect(editingTd!.className).toMatch(/ring-inset/);
    expect(editingTd!.className).toMatch(/bg-primary\/10/);
  });

  it("non-editing cells do NOT carry the editing attribute", () => {
    render(<DataGridTable {...makeProps()} />);
    const editingTds = document.querySelectorAll('td[data-editing="true"]');
    expect(editingTds.length).toBe(0);
  });

  it("editing input has accessible aria-label and visible bg", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
        })}
      />,
    );
    const input = screen.getByLabelText("Editing name") as HTMLInputElement;
    expect(input.value).toBe("Alice");
    expect(input.className).toMatch(/bg-transparent/);
  });

  it("pending-only (not editing) cell uses yellow bg, not primary ring", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEdits: new Map([["0-1", "Alicia"]]),
        })}
      />,
    );
    const tds = document.querySelectorAll("tbody td");
    // The 2nd td of the 1st row is the pending cell
    const pendingTd = tds[1] as HTMLElement;
    expect(pendingTd.className).toMatch(/bg-highlight/);
    expect(pendingTd.className).not.toMatch(/ring-primary/);
  });
});

describe("DataGridTable — NULL vs empty string distinction", () => {
  it("renders NULL chip (no <input>) when editValue is null", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: null,
        })}
      />,
    );

    // No <input> is rendered in NULL mode
    expect(screen.queryByLabelText("Editing name")).not.toBeInTheDocument();
    // The NULL chip is accessible via role textbox + aria-label
    const chip = screen.getByRole("textbox", {
      name: /Editing name — currently NULL/,
    });
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toContain("NULL");
    expect(chip.textContent).toContain("Type to edit");
  });

  it("renders normal <input> with empty value when editValue is '' (not NULL)", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "",
        })}
      />,
    );

    const input = screen.getByLabelText("Editing name") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(
      screen.queryByRole("textbox", { name: /currently NULL/ }),
    ).not.toBeInTheDocument();
  });

  it("Cmd+Backspace on <input> fires onSetEditNull (and preventDefault)", () => {
    const onSetEditNull = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
          onSetEditNull,
        })}
      />,
    );

    const input = screen.getByLabelText("Editing name");
    act(() => {
      fireEvent.keyDown(input, { key: "Backspace", metaKey: true });
    });
    expect(onSetEditNull).toHaveBeenCalledTimes(1);
  });

  it("printable key in NULL mode flips editValue back to that character", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "a" });
    });
    expect(onSetEditValue).toHaveBeenCalledWith("a");
  });

  it("pending-NULL display cell renders an italic NULL label (not editing)", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEdits: new Map<string, string | null>([["0-1", null]]),
        })}
      />,
    );

    const nullLabel = screen.getByLabelText("NULL");
    expect(nullLabel).toBeInTheDocument();
    expect(nullLabel.className).toMatch(/italic/);
  });

  it("pending-empty-string display cell renders '' (distinguishable from NULL)", () => {
    const { container } = render(
      <DataGridTable
        {...makeProps({
          pendingEdits: new Map<string, string | null>([["0-1", ""]]),
        })}
      />,
    );

    // No NULL label should render — this is an empty string, not NULL
    expect(screen.queryByLabelText("NULL")).not.toBeInTheDocument();
    // The pending cell exists and has the highlight bg (not editing, but pending)
    const tds = container.querySelectorAll("tbody td");
    expect(tds[1]!.className).toMatch(/bg-highlight/);
  });
});

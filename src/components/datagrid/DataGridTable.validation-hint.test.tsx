import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import DataGridTable from "./DataGridTable";
import type { TableData } from "@/types/schema";

// Sprint 75 — inline validation hint tests. When the active editing cell has
// an entry in `pendingEditErrors`, DataGridTable renders a `text-destructive`
// message under the editor. When the user modifies the cell (setEditValue /
// setEditNull) the hint clears — but the rendering side only *reads* the
// map, so the "clears on input" assertion here is simulated by the parent
// handing down an empty map on the next render.

const INT_DATA: TableData = {
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
      name: "age",
      data_type: "integer",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, 42]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

function makeProps(overrides: Record<string, unknown> = {}) {
  return {
    data: INT_DATA,
    loading: false,
    sorts: [],
    columnWidths: {},
    columnOrder: [0, 1],
    editingCell: { row: 0, col: 1 } as { row: number; col: number } | null,
    editValue: "abc" as string | null,
    pendingEdits: new Map<string, string | null>([["0-1", "abc"]]),
    pendingEditErrors: new Map<string, string>(),
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

describe("DataGridTable — Sprint 75 inline validation hint", () => {
  it("renders no hint when pendingEditErrors is empty", () => {
    render(<DataGridTable {...makeProps()} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a hint with text-destructive token when active cell has an error", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", 'Expected integer, got "abc"']]),
        })}
      />,
    );
    const hint = screen.getByRole("alert");
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/integer/i);
    expect(hint.className).toMatch(/text-destructive/);
  });

  it("hint has aria-live=polite for screen-reader announcement", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    const hint = screen.getByRole("alert");
    expect(hint.getAttribute("aria-live")).toBe("polite");
  });

  it("does not render hint for a cell that isn't currently editing", () => {
    // Error exists for 0-1, but editing is on 0-0 → no hint should render
    // because the hint is tied to the active editor, not cells in general.
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 0 },
          editValue: "1",
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the editor alongside the hint (editor stays open on error)", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    // Input still rendered.
    const input = screen.getByLabelText("Editing age") as HTMLInputElement;
    expect(input.value).toBe("abc");
    // Hint also rendered.
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("hint disappears when user changes the input (simulated by empty errors map)", () => {
    // Render with an error.
    const { rerender } = render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    // Parent hook clears the error entry when the user edits — simulate by
    // re-rendering with an empty errors map (what `setEditValue` does via
    // `clearActiveEditorError` in useDataGridEdit).
    rerender(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map(),
          editValue: "abcd",
        })}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("onChange on the input fires onSetEditValue — hook wiring test", () => {
    // Double-checks the prop contract: DataGridTable calls onSetEditValue on
    // input change, which the hook uses to clear the error entry. The clear
    // itself is verified in useDataGridEdit.validation.test.ts.
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
          onSetEditValue,
        })}
      />,
    );
    const input = screen.getByLabelText("Editing age");
    act(() => {
      fireEvent.change(input, { target: { value: "42" } });
    });
    expect(onSetEditValue).toHaveBeenCalledWith("42");
  });

  it("hint renders for NULL-chip state too (not just <input>)", () => {
    // A NULL cell with a coercion error (e.g. a prior attempt left an error
    // on this cell and the user set it back to NULL — though the hook clears
    // on setEditNull, this guards against a render-path regression).
    render(
      <DataGridTable
        {...makeProps({
          editValue: null,
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    // NULL chip rendered.
    expect(
      screen.getByRole("textbox", { name: /currently NULL/ }),
    ).toBeInTheDocument();
    // Hint is also present.
    const hint = screen.getByRole("alert");
    expect(hint.textContent).toMatch(/integer/i);
  });

  it("hint uses text-destructive token (not raw red) — ADR 0008 compliance", () => {
    render(
      <DataGridTable
        {...makeProps({
          pendingEditErrors: new Map([["0-1", "Expected integer"]]),
        })}
      />,
    );
    const hint = screen.getByRole("alert");
    // Token-based class (Tailwind semantic token, not `text-red-500`).
    expect(hint.className).toMatch(/text-destructive/);
    expect(hint.className).not.toMatch(/text-red-\d/);
  });
});

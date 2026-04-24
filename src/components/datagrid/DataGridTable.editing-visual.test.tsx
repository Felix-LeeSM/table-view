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

  it("printable key in NULL mode on a text column seeds the character", () => {
    // Sprint 74: text-column NULL → text input flip must still seed with the
    // literal keystroke (regression guard on the text-family branch of
    // deriveEditorSeed). Other types are covered in the type-aware block below.
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

  it("focuses the <input> when a string-valued edit begins", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
        })}
      />,
    );
    const input = screen.getByLabelText("Editing name");
    expect(document.activeElement).toBe(input);
  });

  it("focuses the NULL chip when editor is in NULL state", () => {
    render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: null,
        })}
      />,
    );
    const chip = screen.getByRole("textbox", {
      name: /currently NULL/,
    });
    expect(document.activeElement).toBe(chip);
  });

  it("moves focus from <input> to NULL chip when editValue flips to null", () => {
    const { rerender } = render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "Alice",
        })}
      />,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Editing name"));

    // Simulate parent flipping editValue → null (e.g. after Cmd+Backspace)
    rerender(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: null,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", { name: /currently NULL/ });
    expect(document.activeElement).toBe(chip);
  });

  it("moves focus back to <input> when editValue flips from null to a string", () => {
    const { rerender } = render(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: null,
        })}
      />,
    );
    const chip = screen.getByRole("textbox", { name: /currently NULL/ });
    expect(document.activeElement).toBe(chip);

    // Printable key flips NULL → seeded string
    rerender(
      <DataGridTable
        {...makeProps({
          editingCell: { row: 0, col: 1 },
          editValue: "a",
        })}
      />,
    );

    const input = screen.getByLabelText("Editing name");
    expect(document.activeElement).toBe(input);
  });
});

// Sprint 74 — Type-aware NULL re-entry. Fixtures below exercise column-type
// variations so the NULL-chip → typed-editor flip routes through
// deriveEditorSeed and renders the correct `<input type>`.
const DATE_DATA: TableData = {
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
      name: "birthday",
      data_type: "date",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, "2026-04-24"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

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
      name: "score",
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

const BOOL_DATA: TableData = {
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
      name: "active",
      data_type: "boolean",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, true]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

const TS_DATA: TableData = {
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
      name: "created_at",
      data_type: "timestamp",
      nullable: true,
      default_value: null,
      is_primary_key: false,
      is_foreign_key: false,
      fk_reference: null,
      comment: null,
    },
  ],
  rows: [[1, "2026-04-24T10:00:00Z"]],
  total_count: 1,
  page: 1,
  page_size: 100,
  executed_query: "SELECT * FROM public.users LIMIT 100 OFFSET 0",
};

describe("DataGridTable — Sprint 74: type-aware NULL → typed editor flip", () => {
  it("date column: 'a' from NULL chip flips with empty seed (not 'a')", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: DATE_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /Editing birthday — currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "a" });
    });
    // date editors cannot meaningfully accept a seeded letter; helper returns
    // { seed: "", accept: true }, so parent is told to flip to empty string.
    expect(onSetEditValue).toHaveBeenCalledTimes(1);
    expect(onSetEditValue).toHaveBeenCalledWith("");
  });

  it("date column renders <input type='date'> once editValue is a string", () => {
    render(
      <DataGridTable
        {...makeProps({
          data: DATE_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: "",
        })}
      />,
    );
    const input = screen.getByLabelText("Editing birthday") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("");
  });

  it("integer column: non-numeric key ('x') is swallowed — no state change", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: INT_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /Editing score — currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "x" });
    });
    expect(onSetEditValue).not.toHaveBeenCalled();
  });

  it("integer column: digit ('5') seeds the editor with '5'", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: INT_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /Editing score — currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "5" });
    });
    expect(onSetEditValue).toHaveBeenCalledWith("5");
  });

  it("boolean column: 't' flips with empty seed (Sprint 75 will coerce)", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: BOOL_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /Editing active — currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "t" });
    });
    expect(onSetEditValue).toHaveBeenCalledWith("");
  });

  it("timestamp column renders <input type='datetime-local'>", () => {
    render(
      <DataGridTable
        {...makeProps({
          data: TS_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: "",
        })}
      />,
    );
    const input = screen.getByLabelText(
      "Editing created_at",
    ) as HTMLInputElement;
    expect(input.type).toBe("datetime-local");
  });

  it("timestamp column: printable key flips to empty typed editor", () => {
    const onSetEditValue = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: TS_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: null,
          onSetEditValue,
        })}
      />,
    );

    const chip = screen.getByRole("textbox", {
      name: /Editing created_at — currently NULL/,
    });
    act(() => {
      fireEvent.keyDown(chip, { key: "a" });
    });
    expect(onSetEditValue).toHaveBeenCalledWith("");
  });

  it("Cmd+Backspace from typed (date) editor returns to NULL chip", () => {
    // AC-04: NULL re-entry via Cmd/Ctrl+Backspace must work across typed
    // editors, not just the text editor.
    const onSetEditNull = vi.fn();
    render(
      <DataGridTable
        {...makeProps({
          data: DATE_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: "2026-04-24",
          onSetEditNull,
        })}
      />,
    );

    const input = screen.getByLabelText("Editing birthday");
    act(() => {
      fireEvent.keyDown(input, { key: "Backspace", metaKey: true });
    });
    expect(onSetEditNull).toHaveBeenCalledTimes(1);
  });

  it("integer editor renders as <input type='text'> (native number filter deferred to Sprint 75)", () => {
    // Integer columns still render with type="text" because native
    // <input type="number"> behaviour conflicts with our string-based
    // editValue pipeline; Sprint 74 only gates the NULL-chip flip, SQL-side
    // coercion is Sprint 75.
    render(
      <DataGridTable
        {...makeProps({
          data: INT_DATA,
          editingCell: { row: 0, col: 1 },
          editValue: "42",
        })}
      />,
    );
    const input = screen.getByLabelText("Editing score") as HTMLInputElement;
    expect(input.type).toBe("text");
  });
});

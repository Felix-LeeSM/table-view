import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
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
  executed_query: "SELECT * FROM users LIMIT 100",
};

const defaultProps = {
  data: MOCK_DATA,
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
};

function getResizeHandles(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(".cursor-col-resize"),
  ) as HTMLElement[];
}

describe("DataGridTable — Column Resize", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up any lingering document event listeners
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("calls onColumnWidthsChange with correct colName on mouseup", () => {
    const onColumnWidthsChange = vi.fn();
    render(
      <DataGridTable
        {...defaultProps}
        onColumnWidthsChange={onColumnWidthsChange}
      />,
    );

    const handles = getResizeHandles();
    expect(handles.length).toBeGreaterThanOrEqual(1);
    const handle = handles[0]!;

    act(() => {
      // Start resize on the first column ("id")
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
        }),
      );
    });

    act(() => {
      // Drag 50px to the right
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 150 }),
      );
    });

    act(() => {
      // Release — this previously crashed with "null is not an object"
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 150 }),
      );
    });

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
    const call = onColumnWidthsChange.mock.calls[0];
    expect(call).toBeDefined();
    const updater = call![0] as (
      prev: Record<string, number>,
    ) => Record<string, number>;
    const result = updater({});
    // The first column is "id"
    expect(Object.keys(result)).toContain("id");
  });

  it("does not crash when mouseup fires after ref is cleared (regression)", () => {
    // Regression test: resizingRef.current must be captured before being nulled
    const onColumnWidthsChange = vi.fn();
    render(
      <DataGridTable
        {...defaultProps}
        onColumnWidthsChange={onColumnWidthsChange}
      />,
    );

    const handle = getResizeHandles()[0]!;

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 200,
        }),
      );
    });

    // Fire mouseup immediately without any mousemove — should not throw
    expect(() => {
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, clientX: 200 }),
        );
      });
    }).not.toThrow();

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
  });

  it("second resize uses stored columnWidths as startWidth (Issue 003)", () => {
    // Render with columnWidths already set to 200 for the "id" column
    // (simulates a previously-completed first resize).
    const onColumnWidthsChange = vi.fn();
    render(
      <DataGridTable
        {...defaultProps}
        columnWidths={{ id: 200 }}
        onColumnWidthsChange={onColumnWidthsChange}
      />,
    );

    const handle = getResizeHandles()[0]!;

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 500,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 530 }), // +30px
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 530 }),
      );
    });

    expect(onColumnWidthsChange).toHaveBeenCalledTimes(1);
    const updater = onColumnWidthsChange.mock.calls[0]![0] as (
      prev: Record<string, number>,
    ) => Record<string, number>;
    const result = updater({});
    // startWidth was 200 (from columnWidths prop), so final width should be 230.
    // DOM style.width may not be set in jsdom, so final falls back to startWidth.
    // Either 230 (if mousemove updated DOM) or 200 (jsdom fallback) is acceptable;
    // what must NOT happen is a default calc (~88px) as startWidth.
    expect(result["id"]).toBeGreaterThanOrEqual(200);
  });
});

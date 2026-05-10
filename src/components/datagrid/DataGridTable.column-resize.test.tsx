// Sprint 238 (2026-05-10) — column-resize 동작은 useColumnWidths 훅이 owning
// 하고 외부 store 연결을 끊었다. 따라서 prev 테스트의 `onColumnWidthsChange`
// mock 호출 단언은 더 이상 가능하지 않다. 대체로 drag → DOM 의 <th> style.width
// 가 변경되었는지를 검증한다 (사용자 가시성).

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
      category: "int",
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
      category: "text",
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
  onDeleteRow: vi.fn(),
  onDuplicateRow: vi.fn(),
};

function getResizeHandles(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll(".cursor-col-resize"),
  ) as HTMLElement[];
}

function getThs(): HTMLElement[] {
  return Array.from(document.querySelectorAll("th")) as HTMLElement[];
}

describe("DataGridTable — Column Resize (Sprint 238 useColumnWidths owned)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("drag → mouseup 가 자기 column <th> style.width 만 변경한다 (AC-238-04, AC-238-11)", () => {
    render(<DataGridTable {...defaultProps} />);

    const handles = getResizeHandles();
    expect(handles.length).toBeGreaterThanOrEqual(1);
    const handle = handles[0]!;

    const idWidthBefore = getThs()[0]!.style.width;
    const nameWidthBefore = getThs()[1]!.style.width;

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 100,
        }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 200 }),
      );
    });

    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 200 }),
      );
    });

    const idWidthAfter = getThs()[0]!.style.width;
    const nameWidthAfter = getThs()[1]!.style.width;

    // id column 폭이 drag 만큼 증가했다 (drag 결과 적용).
    const idPxBefore = parseFloat(idWidthBefore);
    const idPxAfter = parseFloat(idWidthAfter);
    expect(idPxAfter).toBeGreaterThan(idPxBefore);
    // 인접 column 폭은 변하지 않는다 (column 독립성).
    expect(nameWidthAfter).toBe(nameWidthBefore);
  });

  it("does not crash when mouseup fires without prior mousemove (regression)", () => {
    render(<DataGridTable {...defaultProps} />);

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

    expect(() => {
      act(() => {
        document.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, clientX: 200 }),
        );
      });
    }).not.toThrow();
  });
});

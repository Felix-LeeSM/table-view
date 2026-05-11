// Sprint 258 (2026-05-11) — DataGrid 가 `<table>` 폐기 + CSS Grid 로 전환.
// drag-resize 의 결과는 outer container 의 `--cols` CSS variable 갱신.
// 본 테스트는 drag → mouseup 시 `--cols` 의 첫 column px 가 증가했고
// 두 번째 column px 는 변하지 않았다는 사실을 잡는다.

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

function getOuterGrid(): HTMLElement {
  const el = document.querySelector('[role="grid"]') as HTMLElement | null;
  if (!el) throw new Error("outer role=grid not found");
  return el;
}

function parseColsPx(outer: HTMLElement): number[] {
  const raw = outer.style.getPropertyValue("--cols").trim();
  if (!raw) return [];
  return raw.split(/\s+/).map((tok) => parseFloat(tok));
}

describe("DataGridTable — Column Resize (Sprint 258 CSS Grid)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });

  it("drag → mouseup 가 자기 column 의 --cols px 만 변경한다 (AC-258-02, AC-258-04)", () => {
    render(<DataGridTable {...defaultProps} />);

    const handles = getResizeHandles();
    expect(handles.length).toBeGreaterThanOrEqual(1);
    const handle = handles[0]!;

    const before = parseColsPx(getOuterGrid());
    expect(before.length).toBe(2);
    const idBefore = before[0]!;
    const nameBefore = before[1]!;

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

    const after = parseColsPx(getOuterGrid());
    expect(after.length).toBe(2);
    // id column +100px (drag delta).
    expect(after[0]!).toBeGreaterThan(idBefore);
    // 인접 column 의 px 는 변하지 않는다 (column 독립성).
    expect(after[1]!).toBe(nameBefore);
  });

  // Sprint 259 — sprint-258 follow-up #6: drag *중* mousemove 단계에서도
  // 다른 column 의 --cols px 가 변하지 않는다 (mouseup 전 imperative
  // setProperty 가 자기 column 의 token 만 mutate).
  it("drag 중 (mousemove) 에 자기 column 의 --cols px 만 갱신, 다른 column 은 불변 (AC-258-02 mid-drag)", () => {
    render(<DataGridTable {...defaultProps} />);

    const handle = getResizeHandles()[0]!;
    const before = parseColsPx(getOuterGrid());
    const nameBefore = before[1]!;

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
        new MouseEvent("mousemove", { bubbles: true, clientX: 250 }),
      );
    });

    // mouseup 전 시점의 --cols 단언.
    const mid = parseColsPx(getOuterGrid());
    expect(mid.length).toBe(2);
    expect(mid[0]!).toBeGreaterThan(before[0]!);
    expect(mid[1]!).toBe(nameBefore);

    // cleanup mouseup.
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 250 }),
      );
    });
  });

  // Sprint 259 — sprint-258 follow-up #6: 3+ 컬럼 케이스에서도 single
  // column drag 가 나머지 모든 column 의 px 를 변경하지 않는다 (column
  // 독립성이 컬럼 수 무관함).
  it("3 컬럼 케이스에서 single column drag 가 나머지 두 column 의 --cols 를 변경하지 않는다", () => {
    const threeColData: TableData = {
      ...MOCK_DATA,
      columns: [
        ...MOCK_DATA.columns,
        {
          name: "extra",
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
      rows: [[1, "Alice", "x"]],
    };
    render(
      <DataGridTable
        {...defaultProps}
        data={threeColData}
        columnOrder={[0, 1, 2]}
      />,
    );

    const handle = getResizeHandles()[1]!; // middle column drag.
    const before = parseColsPx(getOuterGrid());
    expect(before.length).toBe(3);

    act(() => {
      handle.dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          clientX: 200,
        }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mousemove", { bubbles: true, clientX: 300 }),
      );
    });
    act(() => {
      document.dispatchEvent(
        new MouseEvent("mouseup", { bubbles: true, clientX: 300 }),
      );
    });

    const after = parseColsPx(getOuterGrid());
    expect(after.length).toBe(3);
    // 인접한 두 column 은 모두 불변.
    expect(after[0]!).toBe(before[0]!);
    expect(after[1]!).toBeGreaterThan(before[1]!);
    expect(after[2]!).toBe(before[2]!);
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

// #2432 — the grid is on the selectable side of the policy.
//
// Selection is off at the root, so a data cell keeps it only because the
// exception rule in `src/index.css` names the marker the grid renders. Two
// files have to agree for that to hold, and either can move on its own: the
// CSS could drop `[role="gridcell"]`, or the grid could stop marking cells
// that way. So the selector is read out of the stylesheet at runtime and
// matched against the cells the grid actually rendered, instead of being
// retyped here where it would keep passing after the CSS moved.
//
// jsdom applies no stylesheets, so this cannot assert the computed value —
// `Element.matches` against the shipped selector is the reachable half.
// `index-css.select-policy.test.ts` covers the other one, that the rule is
// the only place selection is decided.

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { selectableSelector } from "@/test-utils/selectPolicy";
import type { TableData } from "@/types/schema";
import DataGridTable from "./DataGridTable";

function makeData(): TableData {
  return {
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
        name: "email",
        data_type: "text",
        nullable: false,
        default_value: null,
        is_primary_key: false,
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
        category: "text",
      },
    ],
    rows: [[1, "ada@example.com"]],
    total_count: 1,
    page: 1,
    page_size: 100,
    executed_query: "SELECT * FROM users LIMIT 100",
  };
}

const baseProps = {
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

describe("DataGridTable — selection policy (#2432)", () => {
  it("[select-policy] every rendered data cell matches the selector the stylesheet keeps selectable", () => {
    render(<DataGridTable {...baseProps} data={makeData()} />);

    const cells = document.querySelectorAll(
      '[role="row"][aria-rowindex="2"] [role="gridcell"]',
    );
    expect(cells).toHaveLength(2);

    const selector = selectableSelector();
    const unselectable = [...cells]
      .filter((cell) => !cell.matches(selector))
      .map((cell) => cell.textContent);
    expect(unselectable).toEqual([]);
  });
});

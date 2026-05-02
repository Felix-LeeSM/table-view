import { useCallback, useState } from "react";
import {
  Pencil,
  Trash2,
  Copy,
  Clipboard,
  FileJson,
  FileText,
  Database,
  Maximize2,
  CircleSlash,
} from "lucide-react";
import type { ContextMenuItem } from "@components/shared/ContextMenu";
import type { CopyRowData } from "@lib/format";
import {
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "@lib/format";
import type { TableData } from "@/types/schema";
import { cellToEditValue } from "../useDataGridEdit";

/**
 * `DataGridTable` 의 context menu 분리.
 *
 * 두 export:
 *   - `useContextMenu` — open/close state + `handleContextMenu` (cell /
 *     row 우클릭 시 호출). 우클릭 위치의 row 가 아직 선택되지 않았으면
 *     먼저 single-select 한 뒤 메뉴를 띄움 (TablePlus 와 동일).
 *   - `buildContextMenuItems` — 우클릭이 열려 있을 때 `<ContextMenu>` 에
 *     넘길 10 항목 배열을 빌드하는 pure 함수. Show Cell Details · Edit
 *     Cell · Set to NULL · Delete Row · Duplicate Row · separator · Copy
 *     as Plain Text · JSON · CSV · SQL Insert.
 *
 * Sprint 200 에서 entry 로부터 추출. 메뉴 항목 / 라벨 / 핸들러 동작 0
 * 변경.
 *
 * 외부 invariant:
 * - 빈 그리드 (`data.rows.length === 0`) 에서는 우클릭 무시 — 메뉴 자체가
 *   안 떠야 함. `DataGridTable.context-menu.test.tsx` 가 이 동작을 고정.
 * - "Set to NULL" 은 `onStartEdit(row, col, null)` + `onSetEditNull()`
 *   순서로 호출 — `onStartEdit` 의 in-flight commit 을 먼저 흘려보낸 뒤
 *   editor 를 NULL chip 으로 flip.
 */

export interface ContextMenuPos {
  x: number;
  y: number;
  rowIdx: number;
  colIdx: number;
}

export interface UseContextMenuArgs {
  data: TableData;
  selectedRowIds: Set<number>;
  onSelectRow: (rowIdx: number, metaKey: boolean, shiftKey: boolean) => void;
}

export interface UseContextMenuResult {
  contextMenu: ContextMenuPos | null;
  setContextMenu: (next: ContextMenuPos | null) => void;
  handleContextMenu: (
    e: React.MouseEvent,
    rowIdx: number,
    colIdx: number,
  ) => void;
}

export function useContextMenu({
  data,
  selectedRowIds,
  onSelectRow,
}: UseContextMenuArgs): UseContextMenuResult {
  const [contextMenu, setContextMenu] = useState<ContextMenuPos | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
      e.preventDefault();
      if (data.rows.length === 0) return;
      // If right-clicked row is not selected, select it first
      if (!selectedRowIds.has(rowIdx)) {
        onSelectRow(rowIdx, false, false);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx });
    },
    [data.rows.length, selectedRowIds, onSelectRow],
  );

  return { contextMenu, setContextMenu, handleContextMenu };
}

export interface BuildContextMenuItemsArgs {
  contextMenu: ContextMenuPos;
  data: TableData;
  selectedRowIds: Set<number>;
  schema: string;
  table: string;
  setCellDetail: (
    next: { data: unknown; columnName: string; dataType: string } | null,
  ) => void;
  onStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
  onSetEditNull: () => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
  copyToClipboard: (text: string) => void;
}

export function buildContextMenuItems(
  args: BuildContextMenuItemsArgs,
): ContextMenuItem[] {
  const {
    contextMenu,
    data,
    selectedRowIds,
    schema,
    table,
    setCellDetail,
    onStartEdit,
    onSetEditNull,
    onDeleteRow,
    onDuplicateRow,
    copyToClipboard,
  } = args;

  const getSelectedCopyData = (): CopyRowData => {
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const colNames = data.columns.map((c) => c.name);
    const rows = sortedIds.map((idx) => data.rows[idx] as unknown[]);
    return { columns: colNames, rows, schema, table };
  };

  return [
    {
      label: "Show Cell Details",
      icon: <Maximize2 size={14} />,
      onClick: () => {
        const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
        const col = data.columns[contextMenu.colIdx];
        if (col) {
          setCellDetail({
            data: cell,
            columnName: col.name,
            dataType: col.data_type,
          });
        }
      },
    },
    {
      label: "Edit Cell",
      icon: <Pencil size={14} />,
      onClick: () => {
        const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
        const editVal = cellToEditValue(cell);
        onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, editVal);
      },
    },
    {
      label: "Set to NULL",
      icon: <CircleSlash size={14} />,
      onClick: () => {
        onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, null);
        onSetEditNull();
      },
    },
    {
      label: "Delete Row",
      icon: <Trash2 size={14} />,
      danger: true,
      onClick: onDeleteRow,
    },
    {
      label: "Duplicate Row",
      icon: <Copy size={14} />,
      onClick: onDuplicateRow,
    },
    {
      label: "",
      separator: true,
      onClick: () => {},
    },
    {
      label: "Copy as Plain Text",
      icon: <Clipboard size={14} />,
      onClick: () => copyToClipboard(rowsToPlainText(getSelectedCopyData())),
    },
    {
      label: "Copy as JSON",
      icon: <FileJson size={14} />,
      onClick: () => copyToClipboard(rowsToJson(getSelectedCopyData())),
    },
    {
      label: "Copy as CSV",
      icon: <FileText size={14} />,
      onClick: () => copyToClipboard(rowsToCsv(getSelectedCopyData())),
    },
    {
      label: "Copy as SQL Insert",
      icon: <Database size={14} />,
      onClick: () => copyToClipboard(rowsToSqlInsert(getSelectedCopyData())),
    },
  ];
}

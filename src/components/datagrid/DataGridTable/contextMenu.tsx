import { useCallback, useRef, useState } from "react";
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
import i18n from "@lib/i18n";
import type { ContextMenuItem } from "@components/shared/ContextMenu";
import type { CopyRowData } from "@lib/format";
import {
  rowsToPlainText,
  rowsToJson,
  rowsToCsv,
  rowsToSqlInsert,
} from "@lib/format";
import type { TableData } from "@/types/schema";
import { cellToEditValue } from "../dataGridEditFsm";

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
 * Invariants:
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

  // Issue #1446 — read selection from a ref so `handleContextMenu` keeps a
  // stable identity across selection changes (it lives in the memoized
  // rowCtx). It's only read on a right-click, so latest-value is correct.
  const selectedRowIdsRef = useRef(selectedRowIds);
  selectedRowIdsRef.current = selectedRowIds;

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, rowIdx: number, colIdx: number) => {
      e.preventDefault();
      if (data.rows.length === 0) return;
      // If right-clicked row is not selected, select it first
      if (!selectedRowIdsRef.current.has(rowIdx)) {
        onSelectRow(rowIdx, false, false);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, rowIdx, colIdx });
    },
    [data.rows.length, onSelectRow],
  );

  return { contextMenu, setContextMenu, handleContextMenu };
}

export interface BuildContextMenuItemsArgs {
  contextMenu: ContextMenuPos;
  data: TableData;
  selectedRowIds: Set<number>;
  canEditRows?: boolean;
  /**
   * Issue #1052 — false for a statically read-only engine (DuckDB). Unlike
   * `canEditRows` (stateful: read-only SQLite connection / no-PK table →
   * disabled), an engine that can never edit rows HIDES the row-write items
   * outright (ui-parity §4: static unsupported = hide). Defaults to true.
   */
  rowEditingSupported?: boolean;
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
    canEditRows = true,
    rowEditingSupported = true,
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

  const t = (key: string) => i18n.t(`datagrid:${key}`);

  // #1052 — a statically read-only engine (DuckDB) omits the row-write items
  // entirely; a stateful block (read-only SQLite / no-PK table) keeps them
  // visible-but-disabled via `canEditRows`.
  const editItems: ContextMenuItem[] = rowEditingSupported
    ? [
        {
          label: t("editCell"),
          icon: <Pencil size={14} />,
          disabled: !canEditRows,
          onClick: () => {
            const cell = data.rows[contextMenu.rowIdx]?.[contextMenu.colIdx];
            const editVal = cellToEditValue(cell);
            onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, editVal);
          },
        },
        {
          label: t("setToNull"),
          icon: <CircleSlash size={14} />,
          disabled: !canEditRows,
          onClick: () => {
            onStartEdit(contextMenu.rowIdx, contextMenu.colIdx, null);
            onSetEditNull();
          },
        },
        {
          label: t("deleteRow"),
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: !canEditRows,
          onClick: onDeleteRow,
        },
        {
          label: t("duplicateRow"),
          icon: <Copy size={14} />,
          disabled: !canEditRows,
          onClick: onDuplicateRow,
        },
      ]
    : [];

  return [
    {
      label: t("showCellDetails"),
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
    ...editItems,
    {
      label: "",
      separator: true,
      onClick: () => {},
    },
    {
      label: t("copyAsPlainText"),
      icon: <Clipboard size={14} />,
      onClick: () => copyToClipboard(rowsToPlainText(getSelectedCopyData())),
    },
    {
      label: t("copyAsJson"),
      icon: <FileJson size={14} />,
      onClick: () => copyToClipboard(rowsToJson(getSelectedCopyData())),
    },
    {
      label: t("copyAsCsv"),
      icon: <FileText size={14} />,
      onClick: () => copyToClipboard(rowsToCsv(getSelectedCopyData())),
    },
    {
      label: t("copyAsSqlInsert"),
      icon: <Database size={14} />,
      onClick: () => copyToClipboard(rowsToSqlInsert(getSelectedCopyData())),
    },
  ];
}

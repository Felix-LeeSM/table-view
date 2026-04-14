import { useState, useCallback, useEffect } from "react";
import { useSchemaStore } from "../../stores/schemaStore";
import { useTabStore } from "../../stores/tabStore";
import type { TableData } from "../../types/schema";
import { generateSql } from "./sqlGenerator";

/**
 * Edit key helper: maps row/col indices to a unique string key.
 */
export function editKey(row: number, col: number): string {
  return `${row}-${col}`;
}

/**
 * Row key helper: identifies a row across pages.
 */
export function rowKeyFn(rowIdx: number, page: number): string {
  return `row-${page}-${rowIdx}`;
}

/**
 * Determine the HTML input type for a given column data type.
 */
export function getInputTypeForColumn(dataType: string): string {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp")) return "datetime-local";
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  return "text";
}

export interface UseDataGridEditParams {
  data: TableData | null;
  schema: string;
  table: string;
  connectionId: string;
  page: number;
  fetchData: () => void;
}

export interface DataGridEditState {
  // Cell editing
  editingCell: { row: number; col: number } | null;
  editValue: string;
  setEditValue: (v: string) => void;

  // Pending changes
  pendingEdits: Map<string, string>;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;

  // SQL preview modal
  sqlPreview: string[] | null;
  setSqlPreview: (v: string[] | null) => void;

  // Row selection (multi-row)
  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;

  // Derived — backward compat: single selected row index
  selectedRowIdx: number | null;

  // Derived
  hasPendingChanges: boolean;

  // Actions
  saveCurrentEdit: () => void;
  cancelEdit: () => void;
  handleStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string,
  ) => void;
  handleSelectRow: (
    rowIdx: number,
    metaKey: boolean,
    shiftKey: boolean,
  ) => void;
  handleCommit: () => void;
  handleExecuteCommit: () => Promise<void>;
  handleDiscard: () => void;
  handleAddRow: () => void;
  handleDeleteRow: () => void;
  handleDuplicateRow: () => void;
}

export function useDataGridEdit({
  data,
  schema,
  table,
  connectionId,
  page,
  fetchData,
}: UseDataGridEditParams): DataGridEditState {
  const executeQuery = useSchemaStore((s) => s.executeQuery);
  const activeTabId = useTabStore((s) => s.activeTabId);
  const promoteTab = useTabStore((s) => s.promoteTab);

  // Cell editing state
  const [editingCell, setEditingCell] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingEdits, setPendingEdits] = useState<Map<string, string>>(
    new Map(),
  );

  // SQL preview modal state
  const [sqlPreview, setSqlPreview] = useState<string[] | null>(null);

  // Row selection state (multi-row)
  const [selectedRowIds, setSelectedRowIds] = useState<Set<number>>(new Set());
  const [anchorRowIdx, setAnchorRowIdx] = useState<number | null>(null);

  // Reset selection when page changes
  useEffect(() => {
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
  }, [page]);

  const [pendingNewRows, setPendingNewRows] = useState<unknown[][]>([]);
  const [pendingDeletedRowKeys, setPendingDeletedRowKeys] = useState<
    Set<string>
  >(new Set());

  const saveCurrentEdit = useCallback(() => {
    if (!editingCell) return;
    const key = editKey(editingCell.row, editingCell.col);
    setPendingEdits((prev) => {
      const next = new Map(prev);
      next.set(key, editValue);
      return next;
    });
    setEditingCell(null);
    setEditValue("");
  }, [editingCell, editValue]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue("");
  }, []);

  const handleSelectRow = useCallback(
    (rowIdx: number, metaKey: boolean, shiftKey: boolean) => {
      if (metaKey) {
        // Cmd/Ctrl+Click: toggle individual row
        setSelectedRowIds((prev) => {
          const next = new Set(prev);
          if (next.has(rowIdx)) {
            next.delete(rowIdx);
          } else {
            next.add(rowIdx);
          }
          return next;
        });
        // Set anchor if this is the first selection
        setAnchorRowIdx((prev) => (prev === null ? rowIdx : prev));
      } else if (shiftKey && anchorRowIdx !== null) {
        // Shift+Click with anchor: range selection
        const start = Math.min(anchorRowIdx, rowIdx);
        const end = Math.max(anchorRowIdx, rowIdx);
        const range = new Set<number>();
        for (let i = start; i <= end; i++) {
          range.add(i);
        }
        setSelectedRowIds(range);
      } else if (shiftKey && anchorRowIdx === null) {
        // Shift+Click without anchor: fallback to single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      } else {
        // Normal click: single selection
        setSelectedRowIds(new Set([rowIdx]));
        setAnchorRowIdx(rowIdx);
      }
    },
    [anchorRowIdx],
  );

  const handleStartEdit = useCallback(
    (rowIdx: number, colIdx: number, currentValue: string) => {
      // Save any existing edit first
      if (editingCell) {
        const key = editKey(editingCell.row, editingCell.col);
        setPendingEdits((prev) => {
          const next = new Map(prev);
          next.set(key, editValue);
          return next;
        });
      }
      setEditingCell({ row: rowIdx, col: colIdx });
      setEditValue(currentValue);
      // Promote preview tab on inline edit start
      if (activeTabId) promoteTab(activeTabId);
    },
    [editingCell, editValue, activeTabId, promoteTab],
  );

  const handleCommit = useCallback(() => {
    if (!data) return;
    const sqlStatements = generateSql(
      data,
      schema,
      table,
      pendingEdits,
      pendingDeletedRowKeys,
      pendingNewRows,
    );
    if (sqlStatements.length === 0) return;
    setSqlPreview(sqlStatements);
  }, [
    data,
    pendingEdits,
    pendingDeletedRowKeys,
    pendingNewRows,
    schema,
    table,
  ]);

  const handleExecuteCommit = useCallback(async () => {
    if (!sqlPreview) return;
    try {
      for (const sql of sqlPreview) {
        await executeQuery(connectionId, sql, `edit-${Date.now()}`);
      }
      setSqlPreview(null);
      setPendingEdits(new Map());
      setPendingNewRows([]);
      setPendingDeletedRowKeys(new Set());
      setSelectedRowIds(new Set());
      setAnchorRowIdx(null);
      // Refresh data
      fetchData();
    } catch {
      // Error handling is done via the fetchData flow
    }
  }, [sqlPreview, executeQuery, connectionId, fetchData]);

  const handleDiscard = useCallback(() => {
    setPendingEdits(new Map());
    setEditingCell(null);
    setEditValue("");
    setPendingNewRows([]);
    setPendingDeletedRowKeys(new Set());
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
  }, []);

  const handleAddRow = useCallback(() => {
    if (!data) return;
    const emptyRow = data.columns.map(() => null);
    setPendingNewRows((prev) => [...prev, emptyRow]);
    // Promote preview tab on row add
    if (activeTabId) promoteTab(activeTabId);
  }, [data, activeTabId, promoteTab]);

  const handleDeleteRow = useCallback(() => {
    if (selectedRowIds.size === 0) return;
    setPendingDeletedRowKeys((prev) => {
      const next = new Set(prev);
      selectedRowIds.forEach((rowIdx) => {
        const rk = rowKeyFn(rowIdx, page);
        next.add(rk);
      });
      return next;
    });
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
    // Promote preview tab on row delete
    if (activeTabId) promoteTab(activeTabId);
  }, [selectedRowIds, page, activeTabId, promoteTab]);

  const handleDuplicateRow = useCallback(() => {
    if (!data || selectedRowIds.size === 0) return;
    const sortedIds = [...selectedRowIds].sort((a, b) => a - b);
    const newRows = sortedIds.map((rowIdx) => {
      const row = data.rows[rowIdx];
      return row ? [...(row as unknown[])] : data.columns.map(() => null);
    });
    setPendingNewRows((prev) => [...prev, ...newRows]);
    setSelectedRowIds(new Set());
    setAnchorRowIdx(null);
    if (activeTabId) promoteTab(activeTabId);
  }, [data, selectedRowIds, activeTabId, promoteTab]);

  const hasPendingChanges =
    pendingEdits.size > 0 ||
    pendingNewRows.length > 0 ||
    pendingDeletedRowKeys.size > 0;

  // Derived: single selected row index (backward compat)
  const selectedRowIdx =
    selectedRowIds.size === 1 ? [...selectedRowIds][0]! : null;

  return {
    editingCell,
    editValue,
    setEditValue,
    pendingEdits,
    pendingNewRows,
    pendingDeletedRowKeys,
    sqlPreview,
    setSqlPreview,
    selectedRowIds,
    anchorRowIdx,
    selectedRowIdx,
    hasPendingChanges,
    saveCurrentEdit,
    cancelEdit,
    handleStartEdit,
    handleSelectRow,
    handleCommit,
    handleExecuteCommit,
    handleDiscard,
    handleAddRow,
    handleDeleteRow,
    handleDuplicateRow,
  };
}

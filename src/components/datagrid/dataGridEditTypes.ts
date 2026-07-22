import type { MqlPreview } from "@/lib/mongo/mqlGenerator";
import type { TableData } from "@/types/schema";
import type { CommitError } from "./dataGridEditFsm";

export interface UseDataGridEditParams {
  data: TableData | null;
  database: string;
  schema: string;
  table: string;
  connectionId: string;
  page: number;
  fetchData: () => void;
  paradigm?: "rdb" | "document" | "search" | "kv";
  canEditRows?: boolean;
  /**
   * Issue #1704 — the document paradigm's original (non-sentinelised) documents
   * for the current page, index-aligned with `data.rows`. The MQL generator
   * needs the real array shape to splice an array-element delete instead of
   * emitting a positional `$unset` (a `null` hole). RDB grids omit this.
   */
  rawDocuments?: ReadonlyArray<Record<string, unknown>>;
}

export interface DataGridEditState {
  editingCell: { row: number; col: number } | null;
  editValue: string | null;
  setEditValue: (v: string | null) => void;
  setEditNull: () => void;

  pendingEdits: Map<string, string | null>;
  setPendingEdits: (next: Map<string, string | null>) => void;
  pendingNewRows: unknown[][];
  pendingDeletedRowKeys: Set<string>;
  pendingEditErrors: Map<string, string>;
  /**
   * Issue #1174 — row-identity anchors captured at edit time, keyed by the
   * base cell key `${rowIdx}-${colIdx}`. The render overlay reads these to
   * follow a pending edit to its actual row across pagination / sort /
   * filter instead of lighting up the same visual row index.
   */
  pendingEditRowSnapshots: ReadonlyMap<string, ReadonlyArray<unknown>>;

  sqlPreview: string[] | null;
  setSqlPreview: (v: string[] | null) => void;
  commitError: CommitError | null;
  setCommitError: (v: CommitError | null) => void;
  mqlPreview: MqlPreview | null;
  setMqlPreview: (v: MqlPreview | null) => void;

  selectedRowIds: Set<number>;
  anchorRowIdx: number | null;
  selectedRowIdx: number | null;
  hasPendingChanges: boolean;
  isCommitFlashing: boolean;

  saveCurrentEdit: () => void;
  cancelEdit: () => void;
  handleStartEdit: (
    rowIdx: number,
    colIdx: number,
    currentValue: string | null,
  ) => void;
  handleSelectRow: (
    rowIdx: number,
    metaKey: boolean,
    shiftKey: boolean,
  ) => void;
  handleCommit: () => void;
  handleExecuteCommit: () => Promise<void>;
  pendingConfirm: {
    reason: string;
    sql: string;
    statementIndex: number;
  } | null;
  confirmDangerous: () => Promise<void>;
  cancelDangerous: () => void;
  handleDiscard: () => void;
  handleAddRow: () => void;
  handleDeleteRow: () => void;
  handleDuplicateRow: () => void;
  undo: () => void;
  canUndo: boolean;
  // Issue #1527 (ADR 0050) — symmetric redo of a pending-edit undo.
  redo: () => void;
  canRedo: boolean;
}

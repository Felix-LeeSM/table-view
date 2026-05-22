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
}

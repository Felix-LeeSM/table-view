import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  X,
  Plus,
  Trash2,
  Copy,
  Filter,
  Eye,
} from "lucide-react";
import type { SortInfo, TableData } from "../../types/schema";

const PAGE_SIZE_OPTIONS = [100, 300, 500, 1000];

export interface DataGridToolbarProps {
  data: TableData | null;
  schema: string;
  table: string;
  page: number;
  pageSize: number;
  totalPages: number;
  sorts: SortInfo[];
  activeFilterCount: number;
  showFilters: boolean;
  showQuickLook: boolean;
  hasPendingChanges: boolean;
  pendingEditsSize: number;
  pendingNewRowsCount: number;
  pendingDeletedRowKeysSize: number;
  selectedRowIdsCount: number;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  onAddRow: () => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
}

export default function DataGridToolbar({
  data,
  schema,
  table,
  page,
  pageSize,
  totalPages,
  sorts,
  activeFilterCount,
  showFilters,
  showQuickLook,
  hasPendingChanges,
  pendingEditsSize,
  pendingNewRowsCount,
  pendingDeletedRowKeysSize,
  selectedRowIdsCount,
  onSetPage,
  onSetPageSize,
  onToggleFilters,
  onToggleQuickLook,
  onCommit,
  onDiscard,
  onAddRow,
  onDeleteRow,
  onDuplicateRow,
}: DataGridToolbarProps) {
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs text-secondary-foreground">
        {data ? (
          <>
            {data.total_count.toLocaleString()} rows
            {sorts.length > 0 && (
              <span className="text-muted-foreground">
                Sorted by{" "}
                {sorts.map((s) => `${s.column} ${s.direction}`).join(", ")}
              </span>
            )}
            {pendingEditsSize > 0 && (
              <span className="text-yellow-500">
                {pendingEditsSize} edit{pendingEditsSize !== 1 ? "s" : ""}
              </span>
            )}
            {(pendingNewRowsCount > 0 || pendingDeletedRowKeysSize > 0) && (
              <span className="text-yellow-500">
                {pendingNewRowsCount > 0 && `${pendingNewRowsCount} new`}
                {pendingNewRowsCount > 0 &&
                  pendingDeletedRowKeysSize > 0 &&
                  ", "}
                {pendingDeletedRowKeysSize > 0 &&
                  `${pendingDeletedRowKeysSize} del`}
              </span>
            )}
            {hasPendingChanges && (
              <>
                <button
                  className="flex items-center gap-1 rounded bg-green-600/20 px-2 py-0.5 text-xs text-green-400 hover:bg-green-600/30"
                  onClick={onCommit}
                  aria-label="Commit changes"
                  title="Commit changes"
                >
                  <Check size={12} />
                  Commit
                </button>
                <button
                  className="flex items-center gap-1 rounded bg-red-600/20 px-2 py-0.5 text-xs text-red-400 hover:bg-red-600/30"
                  onClick={onDiscard}
                  aria-label="Discard changes"
                  title="Discard changes"
                >
                  <X size={12} />
                  Discard
                </button>
              </>
            )}
          </>
        ) : (
          `${schema}.${table}`
        )}
      </div>
      <div className="flex items-center gap-2">
        {data && (
          <>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted"
              onClick={onAddRow}
              aria-label="Add row"
              title="Add row"
            >
              <Plus size={14} />
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              onClick={onDeleteRow}
              disabled={selectedRowIdsCount === 0}
              aria-label="Delete row"
              title="Delete row"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-30"
              onClick={onDuplicateRow}
              disabled={selectedRowIdsCount === 0}
              aria-label="Duplicate row"
              title="Duplicate row"
            >
              <Copy size={14} />
            </button>
            {selectedRowIdsCount > 1 && (
              <span className="text-xs text-muted-foreground">
                {selectedRowIdsCount} selected
              </span>
            )}
          </>
        )}
        <button
          className={`relative rounded p-1 hover:bg-muted ${
            showQuickLook ? "text-primary" : "text-muted-foreground"
          }`}
          onClick={onToggleQuickLook}
          aria-label="Toggle Quick Look"
          title="Quick Look (Cmd+L)"
        >
          <Eye size={14} />
        </button>
        <button
          className={`relative rounded p-1 hover:bg-muted ${
            showFilters ? "text-primary" : "text-muted-foreground"
          }`}
          onClick={onToggleFilters}
          aria-label="Toggle filters"
          title="Toggle filters"
        >
          <Filter size={14} />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </button>
        {data && totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={page <= 1}
              onClick={() => onSetPage(1)}
              aria-label="First page"
            >
              <ChevronsLeft size={14} />
            </button>
            <button
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={page <= 1}
              onClick={() => onSetPage(Math.max(1, page - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} />
            </button>
            <span className="text-xs text-muted-foreground">
              {page} / {totalPages}
            </span>
            <input
              type="number"
              min={1}
              max={totalPages}
              className="w-10 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label="Jump to page"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const val = parseInt(
                    (e.target as HTMLInputElement).value,
                    10,
                  );
                  if (val >= 1 && val <= totalPages) {
                    onSetPage(val);
                  }
                }
              }}
            />
            <button
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={page >= totalPages}
              onClick={() => onSetPage(Math.min(totalPages, page + 1))}
              aria-label="Next page"
            >
              <ChevronRight size={14} />
            </button>
            <button
              className="rounded p-0.5 hover:bg-muted disabled:opacity-30"
              disabled={page >= totalPages}
              onClick={() => onSetPage(totalPages)}
              aria-label="Last page"
            >
              <ChevronsRight size={14} />
            </button>
          </div>
        )}
        {data && (
          <select
            className="rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground"
            value={pageSize}
            aria-label="Page size"
            onChange={(e) => {
              onSetPageSize(Number(e.target.value));
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}

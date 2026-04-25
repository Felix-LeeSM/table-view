import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  Loader2,
  X,
  Plus,
  Trash2,
  Copy,
  Filter,
  Eye,
} from "lucide-react";
import type { SortInfo, TableData } from "@/types/schema";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";

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
  /**
   * Sprint 98 — short-lived flash flag from `useDataGridEdit`. When `true`,
   * the Commit button swaps its `Check` icon for a spinning `Loader2` and
   * advertises `aria-busy="true"` + `data-committing="true"` so screen
   * readers + DOM-driven tests can observe the immediate Cmd+S feedback
   * before the SQL Preview modal mounts. Defaults to `false` so existing
   * callers that don't pass the prop keep their current rendering.
   */
  isCommitFlashing?: boolean;
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
  isCommitFlashing = false,
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
              <span className="text-warning">
                {pendingEditsSize} edit{pendingEditsSize !== 1 ? "s" : ""}
              </span>
            )}
            {(pendingNewRowsCount > 0 || pendingDeletedRowKeysSize > 0) && (
              <span className="text-warning">
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
                <Button
                  variant="ghost"
                  size="xs"
                  className="bg-success/20 text-success hover:bg-success/30 hover:text-success"
                  onClick={onCommit}
                  aria-label="Commit changes"
                  title="Commit changes"
                  // Sprint 98 — surface the flash state to AT + tests. We
                  // intentionally do NOT set `disabled` here: the button is
                  // sync-only, so the click handler returns immediately, and
                  // existing tests (commit-shortcut, multi-select, paradigm)
                  // assume the button stays enabled while pending changes
                  // exist. Disabling on flash would either need a follow-up
                  // sprint to update those tests or bake in a 400ms gap
                  // where the user can't click — both worse than the status
                  // quo for the AC-04 invariant.
                  aria-busy={isCommitFlashing || undefined}
                  data-committing={isCommitFlashing ? "true" : undefined}
                >
                  {isCommitFlashing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Commit
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="bg-destructive/20 text-destructive hover:bg-destructive/30 hover:text-destructive"
                  onClick={onDiscard}
                  aria-label="Discard changes"
                  title="Discard changes"
                >
                  <X />
                  Discard
                </Button>
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
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onAddRow}
              aria-label="Add row"
              title="Add row"
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onDeleteRow}
              disabled={selectedRowIdsCount === 0}
              aria-label="Delete row"
              title="Delete row"
            >
              <Trash2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onDuplicateRow}
              disabled={selectedRowIdsCount === 0}
              aria-label="Duplicate row"
              title="Duplicate row"
            >
              <Copy />
            </Button>
            {selectedRowIdsCount > 1 && (
              <span className="text-xs text-muted-foreground">
                {selectedRowIdsCount} selected
              </span>
            )}
          </>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={`relative ${showQuickLook ? "text-primary" : "text-muted-foreground"}`}
          onClick={onToggleQuickLook}
          aria-label="Toggle Quick Look"
          title="Quick Look (Cmd+L)"
        >
          <Eye />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={`relative ${showFilters ? "text-primary" : "text-muted-foreground"}`}
          onClick={onToggleFilters}
          aria-label="Toggle filters"
          title="Toggle filters"
        >
          <Filter />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary text-5xs font-bold text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>
        {data && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page <= 1}
              onClick={() => onSetPage(1)}
              aria-label="First page"
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page <= 1}
              onClick={() => onSetPage(Math.max(1, page - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft />
            </Button>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={page}
              className="w-10 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              aria-label="Jump to page"
              onChange={(e) => {
                const val = parseInt(e.target.value, 10);
                if (val >= 1 && val <= totalPages) {
                  onSetPage(val);
                }
              }}
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
            <span className="text-xs text-muted-foreground">
              / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => onSetPage(Math.min(totalPages, page + 1))}
              aria-label="Next page"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => onSetPage(totalPages)}
              aria-label="Last page"
            >
              <ChevronsRight />
            </Button>
          </div>
        )}
        {data && (
          <Select
            value={String(pageSize)}
            onValueChange={(v) => onSetPageSize(Number(v))}
          >
            <SelectTrigger
              className="rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground"
              aria-label="Page size"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

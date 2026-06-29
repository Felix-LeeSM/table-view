import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Check,
  Columns3,
  Loader2,
  X,
  Plus,
  Trash2,
  Copy,
  Filter,
  Eye,
  Undo2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SortInfo, TableData } from "@/types/schema";
import { PARADIGM_VOCABULARY } from "@/lib/strings/paradigm-vocabulary";
import { Button } from "@components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@components/ui/select";

const PAGE_SIZE_OPTIONS = [100, 300, 500, 1000];

// Toolbar defaults source from the paradigm dictionary so the dictionary
// stays the single source of truth, but we lowercase here because the
// dictionary's `rdb` entry is title-cased for schema-tree vocabulary
// while the toolbar tone is sentence-case.
const RDB_TOOLBAR_LABELS = {
  rowCountLabel: PARADIGM_VOCABULARY.rdb.records.toLowerCase(),
  addRowLabel: `Add ${PARADIGM_VOCABULARY.rdb.record.toLowerCase()}`,
  deleteRowLabel: `Delete ${PARADIGM_VOCABULARY.rdb.record.toLowerCase()}`,
  duplicateRowLabel: `Duplicate ${PARADIGM_VOCABULARY.rdb.record.toLowerCase()}`,
} as const;

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
  canEditRows?: boolean;
  /**
   * Short-lived flash from `useDataGridEdit`. When `true`, Commit swaps
   * its Check icon for a spinning Loader2 and advertises `aria-busy` +
   * `data-committing` so AT and DOM-driven tests observe the immediate
   * Cmd+S feedback before the SQL Preview modal mounts.
   */
  isCommitFlashing?: boolean;
  pendingEditsSize: number;
  pendingNewRowsCount: number;
  pendingDeletedRowKeysSize: number;
  selectedRowIdsCount: number;
  /**
   * Wording overrides — the document grid passes "documents" / "Add
   * document" etc. RDB callers can omit and pick up the RDB defaults.
   */
  rowCountLabel?: string;
  addRowLabel?: string;
  deleteRowLabel?: string;
  duplicateRowLabel?: string;
  /** Right-side slot — typically hosts the ExportButton inline. */
  exportSlot?: React.ReactNode;
  /**
   * Paradigm-specific bulk-write slot. Document grids host
   * "Delete matching" / "Update matching" here driven by `activeFilter`.
   * RDB grids leave this empty — bulk DML is the user's job in the SQL
   * editor.
   */
  bulkOpsSlot?: React.ReactNode;
  onSetPage: (page: number) => void;
  onSetPageSize: (size: number) => void;
  onToggleFilters: () => void;
  onToggleQuickLook: () => void;
  onCommit: () => void;
  onDiscard: () => void;
  onAddRow: () => void;
  onDeleteRow: () => void;
  onDuplicateRow: () => void;
  /**
   * Sprint 249 (ADR 0022 Phase 5) — pending-edit undo. The Toolbar
   * surfaces a small Undo button when `canUndo` is true so users who
   * don't know Cmd+Z can still recover from a mis-Add / mis-Delete /
   * accidental cell change before commit. Callers that don't yet wire
   * the action default the prop to a noop + `canUndo=false` so the
   * button stays disabled (existing DocumentDataGrid path).
   */
  onUndo?: () => void;
  canUndo?: boolean;
  /**
   * Sprint 238 AC-238-12 — `useColumnWidths.reset()` 트리거. callback 이
   * 제공된 grid (records / document) 에서만 toolbar 버튼이 렌더된다 —
   * structure 뷰 등 (c) 산식 적용 대상이 아닌 곳은 prop 을 omit.
   */
  onResetColumnWidths?: () => void;
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
  canEditRows = true,
  isCommitFlashing = false,
  pendingEditsSize,
  pendingNewRowsCount,
  pendingDeletedRowKeysSize,
  selectedRowIdsCount,
  rowCountLabel = RDB_TOOLBAR_LABELS.rowCountLabel,
  addRowLabel = RDB_TOOLBAR_LABELS.addRowLabel,
  deleteRowLabel = RDB_TOOLBAR_LABELS.deleteRowLabel,
  duplicateRowLabel = RDB_TOOLBAR_LABELS.duplicateRowLabel,
  exportSlot,
  bulkOpsSlot,
  onSetPage,
  onSetPageSize,
  onToggleFilters,
  onToggleQuickLook,
  onCommit,
  onDiscard,
  onAddRow,
  onDeleteRow,
  onDuplicateRow,
  onUndo,
  canUndo = false,
  onResetColumnWidths,
}: DataGridToolbarProps) {
  const { t } = useTranslation("datagrid");
  return (
    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
      <div className="flex items-center gap-2 text-xs text-secondary-foreground">
        {data ? (
          <>
            {data.total_count.toLocaleString()} {rowCountLabel}
            {sorts.length > 0 && (
              <span className="text-muted-foreground">
                {t("sortedBy")}{" "}
                {sorts.map((s) => `${s.column} ${s.direction}`).join(", ")}
              </span>
            )}
            {pendingEditsSize > 0 && (
              <span className="text-warning">
                {t("pendingEdits", { count: pendingEditsSize })}
              </span>
            )}
            {(pendingNewRowsCount > 0 || pendingDeletedRowKeysSize > 0) && (
              <span className="text-warning">
                {pendingNewRowsCount > 0 &&
                  t("pendingNew", { count: pendingNewRowsCount })}
                {pendingNewRowsCount > 0 &&
                  pendingDeletedRowKeysSize > 0 &&
                  ", "}
                {pendingDeletedRowKeysSize > 0 &&
                  t("pendingDel", { count: pendingDeletedRowKeysSize })}
              </span>
            )}
            {canEditRows && hasPendingChanges && (
              <>
                <Button
                  variant="ghost"
                  size="xs"
                  className="bg-success/20 text-success hover:bg-success/30 hover:text-success"
                  onClick={onCommit}
                  aria-label={t("commitAria")}
                  title={t("commitAria")}
                  // Surface the flash to AT + tests via aria-busy /
                  // data-committing only. We do NOT set `disabled` —
                  // the click handler is sync, so disabling would just
                  // bake in a ~400ms window where the user can't click.
                  aria-busy={isCommitFlashing || undefined}
                  data-committing={isCommitFlashing ? "true" : undefined}
                >
                  {isCommitFlashing ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  {t("commit")}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="bg-destructive/20 text-destructive hover:bg-destructive/30 hover:text-destructive"
                  onClick={onDiscard}
                  aria-label={t("discardAria")}
                  title={t("discardAria")}
                >
                  <X />
                  {t("discard")}
                </Button>
              </>
            )}
            {canEditRows && onUndo && (
              // Sprint 249 (ADR 0022 Phase 5) — discoverable Undo for users
              // who don't know the Cmd+Z binding. Disabled when the undo
              // stack is empty so a click never silently no-ops.
              <Button
                variant="ghost"
                size="xs"
                onClick={onUndo}
                disabled={!canUndo}
                aria-label={t("undoAria")}
                title={t("undoTitle")}
              >
                <Undo2 />
                {t("undo")}
              </Button>
            )}
          </>
        ) : (
          `${schema}.${table}`
        )}
      </div>
      <div className="flex items-center gap-2">
        {data && canEditRows && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onAddRow}
              aria-label={addRowLabel}
              title={addRowLabel}
            >
              <Plus />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onDeleteRow}
              disabled={selectedRowIdsCount === 0}
              aria-label={deleteRowLabel}
              title={deleteRowLabel}
            >
              <Trash2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={onDuplicateRow}
              disabled={selectedRowIdsCount === 0}
              aria-label={duplicateRowLabel}
              title={duplicateRowLabel}
            >
              <Copy />
            </Button>
            {selectedRowIdsCount > 1 && (
              <span className="text-xs text-muted-foreground">
                {t("selectedCount", { count: selectedRowIdsCount })}
              </span>
            )}
          </>
        )}
        {bulkOpsSlot}
        {exportSlot}
        {onResetColumnWidths && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="relative text-muted-foreground"
            onClick={onResetColumnWidths}
            aria-label={t("resetColumnWidthsAria")}
            title={t("resetColumnWidthsTitle")}
          >
            <Columns3 />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          className={`relative ${showQuickLook ? "text-primary" : "text-muted-foreground"}`}
          onClick={onToggleQuickLook}
          aria-label={t("toggleQuickLookAria")}
          title={t("toggleQuickLookTitle")}
        >
          <Eye />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className={`relative ${showFilters ? "text-primary" : "text-muted-foreground"}`}
          onClick={onToggleFilters}
          aria-label={t("toggleFiltersAria")}
          title={t("toggleFiltersTitle")}
        >
          <Filter />
          {activeFilterCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-primary text-5xs font-bold text-primary-foreground">
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
              aria-label={t("firstPage")}
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page <= 1}
              onClick={() => onSetPage(Math.max(1, page - 1))}
              aria-label={t("prevPage")}
            >
              <ChevronLeft />
            </Button>
            <PageJumpInput
              page={page}
              totalPages={totalPages}
              onCommit={onSetPage}
            />
            <span className="text-xs text-muted-foreground">
              / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => onSetPage(Math.min(totalPages, page + 1))}
              aria-label={t("nextPage")}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              disabled={page >= totalPages}
              onClick={() => onSetPage(totalPages)}
              aria-label={t("lastPage")}
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
              size="xs"
              className="rounded border border-border bg-background px-1 text-foreground shadow-none"
              aria-label={t("pageSizeAria")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              align="end"
              className="min-w-[var(--radix-select-trigger-width)]"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem
                  key={size}
                  value={String(size)}
                  className="py-1 pr-6 pl-2 text-xs"
                >
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

interface PageJumpInputProps {
  page: number;
  totalPages: number;
  onCommit: (page: number) => void;
}

/**
 * Sprint 289 — page input draft. 매 키스트로크마다 fetch 가 발생하던 종전
 * onChange 결합 (`<input onChange={... onSetPage(val) ...}>`) 을 분리: 사용자
 * 가 자유롭게 숫자를 타이핑하는 동안은 local draft 만 변하고, commit 은
 * Enter / blur 두 시점에서만. invalid 입력은 외부 page 로 reset (revert).
 *
 * 외부 page 가 다른 경로 (Prev/Next/Filter reset) 로 바뀌면 draft 도 동기화 —
 * 사용자가 input 에 focus 중이라도 stale 한 숫자가 남지 않도록.
 */
function PageJumpInput({ page, totalPages, onCommit }: PageJumpInputProps) {
  const { t } = useTranslation("datagrid");
  const [draft, setDraft] = useState<string>(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const commit = () => {
    const val = parseInt(draft, 10);
    if (Number.isFinite(val) && val >= 1 && val <= totalPages) {
      if (val !== page) onCommit(val);
      setDraft(String(val));
    } else {
      setDraft(String(page));
    }
  };

  return (
    <input
      type="number"
      min={1}
      max={totalPages}
      value={draft}
      className="w-10 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      aria-label={t("jumpToPage")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.currentTarget as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(String(page));
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
    />
  );
}

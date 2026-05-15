import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import Decimal from "decimal.js";
import { Loader2, Trash2, FileEdit, Filter } from "lucide-react";
import { useDocumentStore } from "@stores/documentStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { isDocumentSentinel } from "@/types/document";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useHiddenColumns } from "@/hooks/useHiddenColumns";
import { useDocumentSchemaAccumulator } from "@/hooks/useDocumentSchemaAccumulator";
import { useColumnResize } from "@components/datagrid/DataGridTable/useColumnResize";
import HeaderRow from "@components/datagrid/DataGridTable/HeaderRow";
import { getDefaultRem, type ColumnCategory } from "@/lib/columnCategory";
import type { ColumnInfo, SortInfo } from "@/types/schema";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import { ExportButton } from "@components/shared/ExportButton";
import DataGridToolbar from "@components/datagrid/DataGridToolbar";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import {
  editKey,
  cellToEditValue,
  useDataGridEdit,
} from "@components/datagrid/useDataGridEdit";
import MqlPreviewModal from "@components/document/MqlPreviewModal";
import ProjectionDialog from "@components/document/ProjectionDialog";
import AddDocumentModal from "@components/document/AddDocumentModal";
import CollectionReadOnlyBanner from "@components/document/CollectionReadOnlyBanner";
import DocumentFilterBar from "@components/document/DocumentFilterBar";
import { DocumentTreePanel } from "@components/document/DocumentTreePanel";
import { Button } from "@components/ui/button";
import { DOCUMENT_LABELS } from "@/lib/strings/document";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { insertDocument } from "@lib/tauri";
import { cn } from "@lib/utils";
import { DEFAULT_PAGE_SIZE } from "@lib/gridPolicy";
import { useDocumentGridData } from "./DocumentDataGrid/useDocumentGridData";
import { useMongoBulkOps } from "./DocumentDataGrid/useMongoBulkOps";
import DocumentBulkDeleteDialog from "./DocumentDataGrid/DocumentBulkDeleteDialog";
import DocumentBulkUpdateDialog from "./DocumentDataGrid/DocumentBulkUpdateDialog";

interface DocumentDataGridProps {
  connectionId: string;
  database: string;
  collection: string;
}

/**
 * Sprint 322 — Slice F.2 helper: pendingEdits 에서 한 (row, col) 의
 * nested edits 만 추려 `Map<dotPath, value>` 로 변환. NestedExpandPopover
 * 가 entry 별 pending 표시 + inline input 의 prefill 에 사용한다.
 * `value` 가 string | null — null 은 popover 가 빈 문자열로 취급.
 */
function buildNestedPendingByPath(
  pendingEdits: ReadonlyMap<string, string | null>,
  rowIdx: number,
  colIdx: number,
): Map<string, string | Record<string, unknown>> {
  const prefix = `${rowIdx}-${colIdx}:`;
  const out = new Map<string, string | Record<string, unknown>>();
  pendingEdits.forEach((value, key) => {
    if (!key.startsWith(prefix)) return;
    const path = key.slice(prefix.length);
    if (typeof value === "string" && value.startsWith(BSON_TAG)) {
      try {
        const parsed = JSON.parse(value.slice(BSON_TAG.length)) as unknown;
        if (typeof parsed === "object" && parsed !== null) {
          out.set(path, parsed as Record<string, unknown>);
          return;
        }
      } catch {
        // fall through to string fallback
      }
    }
    out.set(path, value ?? "");
  });
  return out;
}

/**
 * Sprint 324 — Slice G.2: pendingEdits Map type 은 `string | null` 만
 * 허용하므로 BSON wrapper 객체를 보관하려면 prefix-tagged string 으로
 * 직렬화한다. mqlGenerator 가 같은 prefix 를 인지하고 wrapper 로 복원.
 *
 * Format: `__bson__:<canonical EJSON JSON.stringify(wrapper)>`.
 */
const BSON_TAG = "__bson__:";

function tagBsonWrapper(wrapper: Record<string, unknown>): string {
  // safeStringifyCell 로 BigInt / Decimal 대응 — wrapper 안에 들어올 수
  // 있는 Mongo Int64 / Decimal128 이 raw JSON.stringify 로는 throw 함.
  return `${BSON_TAG}${safeStringifyCell(wrapper)}`;
}

/**
 * Editable grid for the document paradigm. Same workflow as the SQL
 * grid (double-click → edit → Commit → preview → Execute) backed by the
 * MQL generator + Tauri insert/update/delete commands.
 *
 * Sentinel cells (`"{...}"` / `"[N items]"`) stay read-only — the MQL
 * generator rejects sentinel edits server-side, and `onDoubleClick`
 * short-circuits so the user doesn't see an editor that will fail.
 *
 * Toolbar Add opens {@link AddDocumentModal} and dispatches a single
 * `insertDocument`; the positional `handleAddRow` is unused because
 * one-shot inserts fit MongoDB's idiom better than cell-by-cell editing
 * of a schemaless row.
 *
 * Fetch/cancel/pagination/stale-guard pipeline lives in
 * `DocumentDataGrid/useDocumentGridData`; bulk-write decision flow in
 * `useMongoBulkOps`; confirm dialogs in the sibling components. This
 * entry only wires them.
 */
export default function DocumentDataGrid({
  connectionId,
  database,
  collection,
}: DocumentDataGridProps) {
  const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);
  const fieldsCacheEntry = useDocumentStore(
    (s) => s.fieldsCache[connectionId]?.[database]?.[collection],
  );

  const safeModeGate = useSafeModeGate(connectionId);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  // Sprint 341 (Option D) — inline tree panel coordinate. Only one
  // cell may be expanded at a time per grid; toggling another cell
  // collapses the previous one. `null` = none expanded.
  //
  // Sprint 342 V2 feedback (2026-05-15) — `rowIdSnapshot` captures the
  // `_id` of the expanded row at expand-time. When the page rows
  // change (sort / filter / refetch / page move), an effect compares
  // the current `_id` at `rowIdx` against this snapshot and auto-
  // closes the panel if they differ. Without it, the panel either
  // (a) dangles where the row used to be after a filter, or
  // (b) silently re-attaches to the WRONG doc when a sort puts a
  // different row at the same index.
  const [expandedNested, setExpandedNested] = useState<{
    rowIdx: number;
    colIdx: number;
    rowIdSnapshot: string;
  } | null>(null);
  const [showQuickLook, setShowQuickLook] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [activeFilter, setActiveFilter] = useState<Record<string, unknown>>({});
  // Sprint 315 — Slice C.1: multi-column sort. Local state mirrors the
  // RDB DataGrid's `handleSort` mechanic (click = primary ASC↔DESC↔clear,
  // shift+click = add/cycle/remove secondary keys). D-29: kept local
  // instead of routed through workspaceStore to limit Slice C.1 blast
  // radius. Cross-session persist is a Slice C.2 (Sprint 316) decision.
  const [sorts, setSorts] = useState<SortInfo[]>([]);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  // Sprint 325 — Slice H: server-side field projection. `null` → no
  // projection (backend returns all fields). Non-empty → wire-up via
  // useDocumentGridData → find_documents body.
  const [projection, setProjection] = useState<Record<string, 0 | 1> | null>(
    null,
  );
  const [projectionOpen, setProjectionOpen] = useState(false);

  const filterFieldNames = useMemo<readonly string[]>(
    () => (fieldsCacheEntry ? fieldsCacheEntry.map((c) => c.name) : []),
    [fieldsCacheEntry],
  );

  const activeFilterCount = useMemo(
    () => Object.keys(activeFilter).length,
    [activeFilter],
  );

  const {
    data: backendData,
    queryResult,
    loading,
    error,
    fetchData,
    handleCancelRefetch,
  } = useDocumentGridData({
    connectionId,
    database,
    collection,
    page,
    pageSize,
    activeFilter,
    activeFilterCount,
    sorts,
    projection: projection ?? undefined,
  });

  // Sprint 320 — Slice E.2: client-side schema accumulator. Mongo
  // collection 은 schemaless — fetch 마다 backend 가 보내는
  // `queryResult.columns` 가 다를 수 있다. accumulator 가 페이지 간
  // 누적해 grid header / row 가 흔들리지 않게 한다. triple 변경시
  // hook 내부에서 auto-reset (sprint 319 D-43).
  const schemaAccumulator = useDocumentSchemaAccumulator({
    connId: connectionId,
    db: database,
    collection,
  });
  useEffect(() => {
    if (queryResult) {
      schemaAccumulator.merge(queryResult.columns);
    }
    // accumulator.merge 는 hook 내부에서 ref 기반 stable identity.
    // queryResult.columns 만 deps 로 충분.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryResult?.columns]);

  // Sprint 342 V2 feedback (2026-05-15) — auto-close the inline tree
  // panel when the row it points to disappears or gets replaced. We
  // compare the `_id` captured at expand-time against whatever doc is
  // currently sitting at `rowIdx`. JSON.stringify is fine for ids
  // because `_id` shapes are either scalars or shallow EJSON wrappers
  // (`{ $oid: "..." }`, `{ $date: "..." }`). Without this, sort /
  // filter / refetch silently re-attaches the panel to a different
  // doc, or leaves the panel dangling under an empty slot.
  useEffect(() => {
    if (!expandedNested) return;
    const currentDoc = queryResult?.raw_documents[expandedNested.rowIdx];
    const currentId = safeStringifyCell(currentDoc?._id);
    if (
      currentDoc === undefined ||
      currentId !== expandedNested.rowIdSnapshot
    ) {
      setExpandedNested(null);
    }
  }, [queryResult, expandedNested]);

  // Sprint 342 V2 feedback — measure the scroll container's visible
  // width so the inline tree panel can fill the viewport horizontally
  // (instead of `w-fit` which only covered the tree's intrinsic
  // width). The panel sits inside a `sticky left-0` wrapper so this
  // width is exactly the user-visible portion of the grid.
  const [scrollContainerWidth, setScrollContainerWidth] = useState(0);

  // accumulator 가 backend columns 와 다를 수 있어 (a) 누적된 column 만
  // surface 하고 (b) cell lookup 시 backend rows 의 인덱스를 찾는다.
  // accumulator 가 빈 상태 (첫 fetch 전) 면 backend columns fallback
  // 으로 flicker 방지 (D-48).
  const data = useMemo(() => {
    if (!backendData) return null;
    if (schemaAccumulator.columns.length === 0) return backendData;
    const backendIdx = new Map<string, number>();
    backendData.columns.forEach((c, i) => backendIdx.set(c.name, i));
    const effectiveColumns: ColumnInfo[] = schemaAccumulator.columns.map(
      (c) => ({
        name: c.name,
        data_type: c.data_type,
        nullable: true,
        default_value: null,
        is_primary_key: c.name === "_id",
        is_foreign_key: false,
        fk_reference: null,
        comment: null,
      }),
    );
    const effectiveRows = backendData.rows.map((row) =>
      schemaAccumulator.columns.map((c) => {
        const idx = backendIdx.get(c.name);
        return idx === undefined ? null : (row as unknown[])[idx];
      }),
    );
    return {
      ...backendData,
      columns: effectiveColumns,
      rows: effectiveRows,
    };
  }, [backendData, schemaAccumulator.columns]);

  // Cmd+L (Mac) / Ctrl+L (other) toggles the Quick Look panel. Same shape
  // as `DataGrid.tsx` so keyboard behaviour stays consistent across
  // paradigms.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "l" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setShowQuickLook((prev) => !prev);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Editing state managed by the shared hook in document paradigm mode.
  // The hook treats `schema` as the Mongo database name and `table` as the
  // collection name — see `useDataGridEdit` doc block on `paradigm`.
  const editState = useDataGridEdit({
    data,
    schema: database,
    table: collection,
    connectionId,
    page,
    fetchData,
    paradigm: "document",
  });

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total_count / pageSize))
    : 1;

  // The overlay only paints after `loading` has been continuously true
  // for 1s — sub-second refetches resolve before this flips.
  const overlayVisible = useDelayedFlag(loading, 1000);

  const showQuickLookMounted =
    showQuickLook && editState.selectedRowIds.size > 0 && !!queryResult;

  const rowKeyOf = useCallback(
    (rowIdx: number) => `row-${page}-${rowIdx}`,
    [page],
  );

  // Sprint 258 — column widths via shared hook + `--cols` CSS variable.
  // Sprint 260 (AC-260-02) — drag-resize 도 활성. 결과는 `document:<db>:<coll>`
  // 단위 localStorage 에 persist (Sprint 259 의 영속 키 유지).
  const widthColumns = useMemo(
    () =>
      (data?.columns ?? []).map((c) => ({
        name: c.name,
        category: (c.category ?? "unknown") as ColumnCategory,
      })),
    [data?.columns],
  );
  const persistenceKey = `document:${database}:${collection}`;
  const {
    widths,
    setWidth,
    reset: resetColumnWidths,
  } = useColumnWidths(widthColumns, persistenceKey);

  // Sprint 317 — Slice D.1: per-collection hide column.
  // localStorage key = `hidden-columns:document:<db>:<coll>`. Sharing
  // the same `document:<db>:<coll>` namespace as widths keeps the
  // persisted state cohesive (D-35).
  const hiddenColumns = useHiddenColumns(persistenceKey);

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  // Sprint 342 V2 feedback — keep `scrollContainerWidth` in sync with
  // the scroll container's `clientWidth` so the sticky inline-tree
  // panel can fill the viewport horizontally. Reading once on mount
  // isn't enough — window resize, sidebar collapse, and devtools
  // open/close all change the visible width.
  //
  // The deps include `data` because the scroll container is rendered
  // behind a `{data && ...}` guard. On first mount the ref is null
  // (no data yet); without re-running after data arrives, the
  // observer never attaches and the inline-tree panel stretches to
  // its parent (full table width) instead of the visible viewport.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => setScrollContainerWidth(el.clientWidth);
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [data]);

  // Sprint 317 D.1 — visible column subset. Hidden columns drop out of
  // the header row, the `--cols` template, and the per-row cell map.
  // Tuples carry the original idx so cell lookups (`row[origIdx]`) stay
  // correct after filtering.
  const visibleEntries = useMemo<
    ReadonlyArray<readonly [ColumnInfo, number]>
  >(() => {
    if (!data) return [];
    return data.columns
      .map((c, i) => [c, i] as const)
      .filter(([c]) => !hiddenColumns.hidden.has(c.name));
  }, [data, hiddenColumns.hidden]);

  const visualWidthsPx = useMemo(() => {
    if (!data) return [] as number[];
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return visibleEntries.map(([col]) => {
      const stored = widths[col.name];
      if (stored != null) return stored;
      const cat = (col.category ?? "unknown") as ColumnCategory;
      return getDefaultRem(cat) * rootFontSizePx;
    });
  }, [data, widths, visibleEntries]);

  const colsTemplate = useMemo(
    () => visualWidthsPx.map((w) => `${w}px`).join(" "),
    [visualWidthsPx],
  );

  const visualWidthsRef = useRef(visualWidthsPx);
  visualWidthsRef.current = visualWidthsPx;
  const getCurrentWidths = useCallback(() => visualWidthsRef.current, []);

  const { handleResizeStart } = useColumnResize({
    outerRef: scrollContainerRef,
    getCurrentWidths,
    onCommitWidth: setWidth,
  });

  // AC-258-08 — cmd+shift+r 단축키가 reset-column-widths 이벤트를
  // dispatch 한다. App.tsx 의 핸들러가 active grid 와 무관하게 broadcast
  // 하고, 각 mounted grid 가 자기 widths 를 리셋한다.
  useEffect(() => {
    const handler = () => resetColumnWidths();
    window.addEventListener("reset-column-widths", handler);
    return () => window.removeEventListener("reset-column-widths", handler);
  }, [resetColumnWidths]);

  // Sprint 316 — explicit sort helpers driven by the column header
  // context menu. `append` mirrors shift+click semantics. The plain
  // `handleSort` (cycle on click) below stays as-is.
  const handleSortColumn = useCallback(
    (columnName: string, direction: "ASC" | "DESC", append: boolean) => {
      setSorts((prev) => {
        const next: SortInfo = { column: columnName, direction };
        if (append) {
          const idx = prev.findIndex((s) => s.column === columnName);
          if (idx !== -1) {
            const out = [...prev];
            out[idx] = next;
            return out;
          }
          return [...prev, next];
        }
        return [next];
      });
      setPage(1);
    },
    [],
  );

  const handleClearColumnSort = useCallback((columnName: string) => {
    setSorts((prev) => prev.filter((s) => s.column !== columnName));
    setPage(1);
  }, []);

  const handleClearAllSorts = useCallback(() => {
    setSorts([]);
    setPage(1);
  }, []);

  // Sprint 315 — RDB DataGrid handleSort 패턴 1:1 복제. shift+click =
  // multi-key (ASC→DESC→remove cycle per column), plain click = single
  // key reset (ASC→DESC→clear). page=1 로 리셋해 sort 가 reflect.
  const handleSort = useCallback(
    (columnName: string, shiftKey: boolean = false) => {
      if (shiftKey) {
        setSorts((prev) => {
          const existingIndex = prev.findIndex((s) => s.column === columnName);
          if (existingIndex !== -1) {
            const existing = prev[existingIndex]!;
            if (existing.direction === "ASC") {
              const newSorts = [...prev];
              newSorts[existingIndex] = {
                column: columnName,
                direction: "DESC",
              };
              return newSorts;
            }
            return prev.filter((s) => s.column !== columnName);
          }
          return [...prev, { column: columnName, direction: "ASC" }];
        });
      } else {
        setSorts((prev) => {
          if (prev.length === 0 || prev[0]!.column !== columnName) {
            return [{ column: columnName, direction: "ASC" }];
          }
          if (prev[0]!.direction === "ASC") {
            return [{ column: columnName, direction: "DESC" }];
          }
          return [];
        });
      }
      setPage(1);
    },
    [],
  );

  const handleStartEditCell = useCallback(
    (rowIdx: number, colIdx: number) => {
      if (!data) return;
      const cell = (data.rows[rowIdx] as unknown[] | undefined)?.[colIdx];
      if (isDocumentSentinel(cell)) {
        // Sentinel cells stay read-only — the generator drops the row and
        // the backend would reject the patch anyway. Short-circuit before
        // calling the edit hook so the user never sees an input appear.
        return;
      }
      const key = editKey(rowIdx, colIdx);
      const pendingValue = editState.pendingEdits.has(key)
        ? (editState.pendingEdits.get(key) as string | null)
        : cellToEditValue(cell);
      editState.handleStartEdit(rowIdx, colIdx, pendingValue);
    },
    [data, editState],
  );

  const handleAddClick = useCallback(() => {
    setAddError(null);
    setAddModalOpen(true);
  }, []);

  const handleAddSubmit = useCallback(
    async (record: Record<string, unknown>) => {
      setAddLoading(true);
      setAddError(null);
      // Synthesise a user-readable MQL line for the history row,
      // matching the per-document format from `mqlGenerator`.
      const startedAt = Date.now();
      const recordedSql = `db.${collection}.insertOne(${safeStringifyCell(record)})`;
      try {
        await insertDocument(connectionId, database, collection, record);
        setAddModalOpen(false);
        await fetchData();
        addHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          database,
          collection,
          source: "mongo-op",
        });
      } catch (e) {
        setAddError(e instanceof Error ? e.message : String(e));
        addHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "document",
          queryMode: "find",
          database,
          collection,
          source: "mongo-op",
        });
      } finally {
        setAddLoading(false);
      }
    },
    [connectionId, database, collection, fetchData, addHistoryEntry],
  );

  const handleExecuteMql = useCallback(async () => {
    setExecuting(true);
    try {
      await editState.handleExecuteCommit();
    } finally {
      setExecuting(false);
    }
  }, [editState]);

  const bulkOps = useMongoBulkOps({
    connectionId,
    database,
    collection,
    activeFilter,
    safeModeGate,
    fetchData,
  });

  const mqlPreview = editState.mqlPreview;
  const mqlErrors = useMemo(
    () =>
      mqlPreview?.errors.map((err) => {
        if (err.kind === "missing-id") {
          return { row: err.rowIdx, message: "missing or unsupported _id" };
        }
        if (err.kind === "id-in-patch") {
          return {
            row: err.rowIdx,
            message: `cannot edit field ${err.column} in a patch`,
          };
        }
        if (err.kind === "sentinel-edit") {
          return {
            row: err.rowIdx,
            message: `nested field ${err.column} is not editable`,
          };
        }
        return { row: err.rowIdx, message: err.reason };
      }) ?? [],
    [mqlPreview],
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <CollectionReadOnlyBanner />
      <DataGridToolbar
        data={data}
        schema={database}
        table={collection}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sorts={sorts}
        activeFilterCount={activeFilterCount}
        showFilters={showFilters}
        hasPendingChanges={editState.hasPendingChanges}
        pendingEditsSize={editState.pendingEdits.size}
        pendingNewRowsCount={editState.pendingNewRows.length}
        pendingDeletedRowKeysSize={editState.pendingDeletedRowKeys.size}
        selectedRowIdsCount={editState.selectedRowIds.size}
        rowCountLabel={DOCUMENT_LABELS.rowCountLabel}
        addRowLabel={DOCUMENT_LABELS.addRowLabel}
        deleteRowLabel={DOCUMENT_LABELS.deleteRowLabel}
        duplicateRowLabel={DOCUMENT_LABELS.duplicateRowLabel}
        exportSlot={
          <ExportButton
            context={{ kind: "collection", name: collection }}
            headers={(data?.columns ?? []).map((c) => c.name)}
            getRows={() => (data?.rows ?? []) as unknown[][]}
          />
        }
        bulkOpsSlot={
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={bulkOps.handleDeleteManyClick}
              aria-label="Delete matching documents"
              title={
                activeFilterCount > 0
                  ? `Delete documents matching the current filter`
                  : "Delete every document in this collection"
              }
            >
              <Trash2 />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              onClick={bulkOps.handleUpdateManyClick}
              aria-label="Update matching documents"
              title={
                activeFilterCount > 0
                  ? `Update documents matching the current filter`
                  : "Update every document in this collection"
              }
            >
              <FileEdit />
            </Button>
            {/* Sprint 325 — Slice H: field projection dialog trigger. */}
            <Button
              variant="ghost"
              size="icon-xs"
              className={
                projection && Object.keys(projection).length > 0
                  ? "text-primary"
                  : "text-muted-foreground"
              }
              onClick={() => setProjectionOpen(true)}
              aria-label="Field projection"
              title={
                projection && Object.keys(projection).length > 0
                  ? `Projection: ${Object.keys(projection).length} field(s)`
                  : "Server-side field projection"
              }
            >
              <Filter />
            </Button>
          </>
        }
        onSetPage={setPage}
        onSetPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onToggleFilters={() => setShowFilters((prev) => !prev)}
        showQuickLook={showQuickLook}
        onToggleQuickLook={() => setShowQuickLook((prev) => !prev)}
        onCommit={editState.handleCommit}
        onDiscard={editState.handleDiscard}
        onAddRow={handleAddClick}
        onDeleteRow={editState.handleDeleteRow}
        onDuplicateRow={editState.handleDuplicateRow}
      />

      {/* Sprint 317 D.1 — hidden columns badge. Only shown when at
          least one column is hidden. "Show all" wipes the persisted
          state for the current collection (D-37). */}
      {hiddenColumns.hidden.size > 0 && (
        <div
          className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-1.5 text-xs"
          aria-label="Hidden columns badge"
        >
          <span className="text-muted-foreground">
            {hiddenColumns.hidden.size === 1
              ? "1 column hidden"
              : `${hiddenColumns.hidden.size} columns hidden`}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="text-primary hover:text-primary/80"
            onClick={() => hiddenColumns.clear()}
            aria-label="Show all hidden columns"
          >
            Show all
          </Button>
        </div>
      )}

      {showFilters && (
        <DocumentFilterBar
          fieldNames={filterFieldNames}
          onApply={(filter) => {
            setActiveFilter(filter);
            setPage(1);
          }}
          onClose={() => setShowFilters(false)}
          onClear={() => {
            setActiveFilter({});
            setPage(1);
          }}
        />
      )}

      {error && (
        <div
          role="alert"
          className="border-b border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      )}

      {data && (
        <div
          ref={scrollContainerRef}
          className="relative flex-1 overflow-auto text-sm"
          role="grid"
          aria-rowcount={1 + data.rows.length}
          aria-colcount={visibleEntries.length}
          style={{ "--cols": colsTemplate } as CSSProperties}
        >
          {/* `AsyncProgressOverlay` paints only after `loading` has
              been continuously true for 1s and internally hardens
              against pointer-event leaks. Cancel clears loading
              synchronously and best-effort cancels the backend driver. */}
          <AsyncProgressOverlay
            visible={overlayVisible}
            onCancel={handleCancelRefetch}
          />

          {/* Sprint 315 — paradigm-shared HeaderRow. order=identity
              (column reorder 미지원). RDB DataGrid 와 동일한 sort
              indicator (rank + ▲/▼) 가 column 별로 표시된다. */}
          <HeaderRow
            data={data}
            order={visibleEntries.map(([, i]) => i)}
            sorts={sorts}
            editingCell={editState.editingCell}
            onSort={handleSort}
            onSaveCurrentEdit={editState.saveCurrentEdit}
            onResizeStart={handleResizeStart}
            onSortColumn={handleSortColumn}
            onClearColumnSort={handleClearColumnSort}
            onClearAllSorts={handleClearAllSorts}
            onHideColumn={hiddenColumns.hide}
          />

          <div role="rowgroup">
            {data.rows.map((row, rowIdx) => {
              const selected = editState.selectedRowIds.has(rowIdx);
              const isDeleted = editState.pendingDeletedRowKeys.has(
                rowKeyOf(rowIdx),
              );
              const isExpandedHere = expandedNested?.rowIdx === rowIdx;
              const expandedColName = isExpandedHere
                ? (visibleEntries[expandedNested!.colIdx]?.[0]?.name ?? null)
                : null;
              const expandedRawValue =
                isExpandedHere && expandedColName
                  ? queryResult?.raw_documents[rowIdx]?.[expandedColName]
                  : undefined;
              return (
                <Fragment key={`row-${page}-${rowIdx}`}>
                  <div
                    role="row"
                    aria-rowindex={rowIdx + 2}
                    aria-selected={selected}
                    onClick={(e) =>
                      editState.handleSelectRow(
                        rowIdx,
                        e.metaKey || e.ctrlKey,
                        e.shiftKey,
                      )
                    }
                    className={cn(
                      "min-h-8 cursor-pointer border-b border-border hover:bg-muted",
                      selected && "bg-accent dark:bg-accent/60",
                      isDeleted &&
                        "bg-destructive/10 line-through opacity-60 hover:bg-destructive/20",
                    )}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "var(--cols)",
                      minWidth: "max-content",
                    }}
                  >
                    {visibleEntries.map(([col, colIdx], visualIdx) => {
                      const cell = (row as unknown[])[colIdx];
                      const isSentinel = isDocumentSentinel(cell);
                      const isNull = cell == null;
                      const key = editKey(rowIdx, colIdx);
                      const isEditing =
                        editState.editingCell?.row === rowIdx &&
                        editState.editingCell?.col === colIdx;
                      const hasPendingEdit = editState.pendingEdits.has(key);
                      const pendingValue = hasPendingEdit
                        ? (editState.pendingEdits.get(key) as string | null)
                        : null;

                      return (
                        <div
                          key={col.name}
                          role="gridcell"
                          aria-colindex={visualIdx + 1}
                          data-editing={isEditing ? "true" : undefined}
                          className={cn(
                            "flex min-w-0 items-center overflow-hidden border-r border-border px-3 py-1 text-xs",
                            isEditing &&
                              "bg-primary/10 ring-2 ring-inset ring-primary",
                            !isEditing && hasPendingEdit && "bg-highlight/20",
                          )}
                          title={
                            isNull
                              ? "null"
                              : cell instanceof Decimal
                                ? cell.toString()
                                : typeof cell === "bigint"
                                  ? cell.toString()
                                  : typeof cell === "object"
                                    ? safeStringifyCell(cell)
                                    : String(cell)
                          }
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            handleStartEditCell(rowIdx, colIdx);
                          }}
                        >
                          {isEditing ? (
                            <input
                              type="text"
                              autoFocus
                              aria-label={`Editing ${col.name}`}
                              className="w-full bg-transparent px-1 py-0 text-xs text-foreground outline-none"
                              value={editState.editValue ?? ""}
                              onChange={(e) =>
                                editState.setEditValue(e.target.value)
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  editState.saveCurrentEdit();
                                } else if (e.key === "Escape") {
                                  e.stopPropagation();
                                  editState.cancelEdit();
                                }
                              }}
                              onBlur={() => editState.saveCurrentEdit()}
                            />
                          ) : hasPendingEdit ? (
                            pendingValue === null ? (
                              <span
                                className="italic text-muted-foreground"
                                aria-label="NULL"
                              >
                                NULL
                              </span>
                            ) : (
                              <span
                                dir="auto"
                                className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
                              >
                                {pendingValue}
                              </span>
                            )
                          ) : isNull ? (
                            <span className="italic text-muted-foreground">
                              null
                            </span>
                          ) : isSentinel ? (
                            // Sprint 341 (Option D) — sentinel cell 가
                            // 자체적으로 inline tree 토글을 갖는다. closed
                            // 형태는 `{ ... }` / `[ N items ]`; open 형태는
                            // `{ ✕ }` / `[ ✕ ]`. detail row 는 별도 master/
                            // detail row 로 grid 안에 삽입된다 (아래).
                            // pendingByPath / onCommitEdit 흐름은 Sprint 322
                            // F.2 NestedExpandPopover 와 동일하게 유지.
                            (() => {
                              const sentinelStr = String(cell);
                              const isArr = sentinelStr.startsWith("[");
                              const isOpen =
                                expandedNested?.rowIdx === rowIdx &&
                                expandedNested?.colIdx === colIdx;
                              const innerLabel = isOpen
                                ? "✕"
                                : isArr
                                  ? sentinelStr.slice(1, -1).trim() // "3 items"
                                  : "...";
                              const hasPending =
                                buildNestedPendingByPath(
                                  editState.pendingEdits,
                                  rowIdx,
                                  colIdx,
                                ).size > 0;
                              return (
                                <span className="flex min-w-0 items-center gap-1 font-mono text-muted-foreground">
                                  <span>{isArr ? "[" : "{"}</span>
                                  <button
                                    type="button"
                                    data-testid={`nested-toggle-${rowIdx}-${colIdx}`}
                                    aria-expanded={isOpen}
                                    aria-label={`${isOpen ? "Close" : "Expand"} ${col.name}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isOpen) {
                                        setExpandedNested(null);
                                        return;
                                      }
                                      // Sprint 342 V2 feedback — snapshot
                                      // the `_id` so a downstream sort /
                                      // filter that moves rows around
                                      // can be detected and auto-close
                                      // the panel.
                                      const rawId =
                                        queryResult?.raw_documents[rowIdx]?._id;
                                      setExpandedNested({
                                        rowIdx,
                                        colIdx,
                                        rowIdSnapshot: safeStringifyCell(rawId),
                                      });
                                    }}
                                    className={cn(
                                      // Sprint 341 feedback (3) — closed
                                      // state reads as a normal button:
                                      // border + bg + hover. Open state
                                      // flips to the primary fill so the
                                      // expanded cell is obvious at a
                                      // glance.
                                      "inline-flex items-center justify-center rounded border border-border bg-muted px-1.5 font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                                      isOpen &&
                                        "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                                      hasPending && "ring-1 ring-highlight",
                                    )}
                                  >
                                    {innerLabel}
                                  </button>
                                  <span>{isArr ? "]" : "}"}</span>
                                </span>
                              );
                            })()
                          ) : (
                            <span
                              dir="auto"
                              className="block overflow-hidden text-ellipsis whitespace-nowrap text-foreground [unicode-bidi:isolate]"
                            >
                              {cell instanceof Decimal
                                ? cell.toString()
                                : typeof cell === "object"
                                  ? safeStringifyCell(cell)
                                  : String(cell)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {isExpandedHere && expandedNested && expandedColName && (
                    <div
                      role="row"
                      data-testid={`nested-detail-row-${rowIdx}`}
                      className="border-b border-border bg-secondary/20"
                      style={{
                        // Sprint 342 V2 feedback (2026-05-15) — detail
                        // row must use the same grid template as the
                        // data rows above. Without this, gridColumn:
                        // "1 / -1" inside is a no-op (parent isn't a
                        // grid), the cell width collapses to the
                        // sticky inner's pixel width, and a horizontal
                        // scroll past that width pushes the panel off-
                        // screen to the left — the sticky-left-0
                        // contract relies on the cell being as wide as
                        // the scroll container's content (≥ all cols).
                        display: "grid",
                        gridTemplateColumns: "var(--cols)",
                        minWidth: "max-content",
                      }}
                    >
                      <div
                        role="gridcell"
                        style={{ gridColumn: "1 / -1" }}
                        className="p-0"
                      >
                        {/*
                          Sprint 341 feedback (2) — keep the panel visible
                          when the grid is scrolled horizontally. The
                          inner wrapper sticks to viewport's left edge so
                          the panel does not drift off-screen with the
                          first column.
                          Sprint 342 V2 feedback — fill the visible
                          width: `w-fit` only covered the tree's
                          intrinsic width, leaving most of the grid
                          right-blank. We size the sticky wrapper to
                          the scroll container's `clientWidth` so the
                          panel spans the user-visible portion.
                        */}
                        <div
                          className="sticky left-0"
                          style={{ width: scrollContainerWidth || undefined }}
                        >
                          <DocumentTreePanel
                            value={expandedRawValue}
                            fieldName={expandedColName}
                            pendingByPath={buildNestedPendingByPath(
                              editState.pendingEdits,
                              rowIdx,
                              expandedNested.colIdx,
                            )}
                            onCommitEdit={(path, value) => {
                              const next = new Map(editState.pendingEdits);
                              const serialized =
                                typeof value === "string"
                                  ? value
                                  : tagBsonWrapper(value);
                              next.set(
                                `${rowIdx}-${expandedNested.colIdx}:${path}`,
                                serialized,
                              );
                              editState.setPendingEdits(next);
                            }}
                            onClose={() => setExpandedNested(null)}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
            {data.rows.length === 0 && (
              <div
                role="row"
                className="border-b border-border"
                style={{ minWidth: "max-content" }}
              >
                <div
                  role="gridcell"
                  aria-colindex={1}
                  style={{ gridColumn: "1 / -1" }}
                  className="px-3 py-4 text-center text-xs text-muted-foreground"
                >
                  No documents
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showQuickLookMounted && queryResult && (
        <QuickLookPanel
          mode="document"
          rawDocuments={queryResult.raw_documents}
          selectedRowIds={editState.selectedRowIds}
          database={database}
          collection={collection}
          onClose={() => setShowQuickLook(false)}
          editState={editState}
          data={data ?? undefined}
        />
      )}

      {mqlPreview && (
        <MqlPreviewModal
          previewLines={mqlPreview.previewLines}
          errors={mqlErrors}
          loading={executing}
          onExecute={handleExecuteMql}
          onCancel={() => editState.setMqlPreview(null)}
        />
      )}

      <ProjectionDialog
        open={projectionOpen}
        onOpenChange={setProjectionOpen}
        columns={data?.columns ?? []}
        initial={projection}
        onApply={(next) => {
          setProjection(Object.keys(next).length === 0 ? null : next);
          setProjectionOpen(false);
        }}
        onClear={() => {
          setProjection(null);
          setProjectionOpen(false);
        }}
      />

      {addModalOpen && (
        <AddDocumentModal
          loading={addLoading}
          error={addError}
          connectionId={connectionId}
          database={database}
          collection={collection}
          onSubmit={handleAddSubmit}
          onCancel={() => {
            if (addLoading) return;
            setAddModalOpen(false);
            setAddError(null);
          }}
        />
      )}

      <DocumentBulkDeleteDialog
        open={bulkOps.deleteManyDialogOpen}
        onOpenChange={bulkOps.setDeleteManyDialogOpen}
        database={database}
        collection={collection}
        activeFilter={activeFilter}
        loading={bulkOps.deleteManyLoading}
        onConfirm={bulkOps.handleConfirmDeleteMany}
      />

      <DocumentBulkUpdateDialog
        open={bulkOps.updateManyDialogOpen}
        onOpenChange={bulkOps.setUpdateManyDialogOpen}
        database={database}
        collection={collection}
        activeFilter={activeFilter}
        patchInput={bulkOps.updatePatchInput}
        onPatchInputChange={bulkOps.setUpdatePatchInput}
        error={bulkOps.updateManyError}
        loading={bulkOps.updateManyLoading}
        onConfirm={bulkOps.handleConfirmUpdateMany}
      />
    </div>
  );
}

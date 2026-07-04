import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import { isDocumentSentinel } from "@/types/document";
import { safeStringifyCell } from "@lib/jsonCell";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { useHiddenColumns } from "@/hooks/useHiddenColumns";
import { useDocumentSchemaAccumulator } from "@/hooks/useDocumentSchemaAccumulator";
import { getDefaultRem, type ColumnCategory } from "@/lib/columnCategory";
import type { ColumnInfo, SortInfo } from "@/types/schema";
import QuickLookPanel from "@components/shared/QuickLookPanel";
import AsyncProgressOverlay from "@components/feedback/AsyncProgressOverlay";
import {
  DataGridHeaderRow as HeaderRow,
  cellToEditValue,
  editKey,
  pendingEditAnchorMatches,
  rowIdentityKey,
  useColumnResize,
  useDocumentDataGridEdit,
  useGridRoving,
} from "@components/datagrid";
import MqlPreviewModal from "@components/document/MqlPreviewModal";
import ProjectionDialog from "@components/document/ProjectionDialog";
import AddDocumentModal from "@components/document/AddDocumentModal";
import { useDelayedFlag } from "@/hooks/useDelayedFlag";
import { useSafeModeGate } from "@hooks/useSafeModeGate";
import { insertDocument } from "@lib/tauri";
import { DEFAULT_PAGE_SIZE } from "@lib/gridPolicy";
import { useDocumentGridData } from "./DocumentDataGrid/useDocumentGridData";
import DocumentGridControls from "./DocumentDataGrid/DocumentGridControls";
import DocumentGridRows, {
  type ExpandedNestedCell,
} from "./DocumentDataGrid/cellRenderers/DocumentGridRows";

export interface DocumentDataGridProps {
  connectionId: string;
  database: string;
  collection: string;
}

export default function DocumentDataGrid({
  connectionId,
  database,
  collection,
}: DocumentDataGridProps) {
  // sprint-373 — `recordHistoryEntry` 가 disable gate + wire shape normalise.
  const fieldsCacheEntry = useDocumentCatalogStore(
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
  const [expandedNested, setExpandedNested] =
    useState<ExpandedNestedCell | null>(null);
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
    const currentDoc = queryResult?.rawDocuments[expandedNested.rowIdx];
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
        data_type: c.dataType,
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

  // Editing state managed by the document-specific hook. It treats `schema`
  // as the Mongo database name and `table` as the collection name.
  const editState = useDocumentDataGridEdit({
    data,
    database,
    schema: database,
    table: collection,
    connectionId,
    page,
    fetchData,
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
  // Sprint 260 (AC-260-02) — drag-resize 활성.
  // Sprint 369 (Phase 4) — `datagrid_column_prefs` SQLite SOT 로 전환.
  // PK 의 `namespace` 는 Mongo 의 경우 db_name 과 동일 (codex 7차 #2 동의어 통일).
  const widthColumns = useMemo(
    () =>
      (data?.columns ?? []).map((c) => ({
        name: c.name,
        category: (c.category ?? "unknown") as ColumnCategory,
      })),
    [data?.columns],
  );
  const columnPrefsPk = useMemo(
    () => ({
      connectionId,
      paradigm: "document" as const,
      dbName: database,
      namespace: database,
      tableName: collection,
    }),
    [connectionId, database, collection],
  );
  const {
    widths,
    setWidth,
    reset: resetColumnWidths,
  } = useColumnWidths(widthColumns, columnPrefsPk);

  // Sprint 317 — Slice D.1: per-collection hide column.
  // Sprint 369 — 같은 PK 5-tuple 사용. backend partial patch 가 widths /
  // hiddenColumns 의 독립성 보장 (codex 7차 #1).
  const hiddenColumns = useHiddenColumns(columnPrefsPk);

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

  const { handleResizeStart, handleResizeKeyDown } = useColumnResize({
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
      // Issue #1174 — only seed from the pending value when the row now at
      // this index still matches the edit-time anchor; otherwise this is a
      // different row (paginated / sorted / filtered in) so seed its real
      // cell value, matching what the overlay shows.
      const anchored =
        editState.pendingEdits.has(key) &&
        pendingEditAnchorMatches(
          key,
          rowIdentityKey(data.rows[rowIdx] as unknown[], data.columns),
          data.columns,
          editState.pendingEditRowSnapshots,
        );
      const pendingValue = anchored
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
        recordHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "success",
          connectionId,
          paradigm: "document",
          queryMode: "insertOne",
          database,
          collection,
          source: "mongo-op",
        });
      } catch (e) {
        setAddError(e instanceof Error ? e.message : String(e));
        recordHistoryEntry({
          sql: recordedSql,
          executedAt: startedAt,
          duration: Date.now() - startedAt,
          status: "error",
          connectionId,
          paradigm: "document",
          queryMode: "insertOne",
          database,
          collection,
          source: "mongo-op",
        });
      } finally {
        setAddLoading(false);
      }
    },
    [connectionId, database, collection, fetchData],
  );

  const handleExecuteMql = useCallback(async () => {
    setExecuting(true);
    try {
      await editState.handleExecuteCommit();
    } finally {
      setExecuting(false);
    }
  }, [editState]);

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

  // WAI-ARIA grid roving tabindex + 방향키 2D nav (data cell 만). container 는
  // scrollContainerRef 의 role="grid" div. onFocus=state-only / keyboard=focus
  // split 은 hook 내부 문서 참고.
  const roving = useGridRoving(
    data?.rows.length ?? 0,
    visibleEntries.length,
    scrollContainerRef,
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <DocumentGridControls
        data={data}
        database={database}
        collection={collection}
        connectionId={connectionId}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        sorts={sorts}
        activeFilter={activeFilter}
        activeFilterCount={activeFilterCount}
        filterFieldNames={filterFieldNames}
        showFilters={showFilters}
        showQuickLook={showQuickLook}
        editState={editState}
        hiddenColumnCount={hiddenColumns.hidden.size}
        projection={projection}
        loading={loading}
        error={error}
        safeModeGate={safeModeGate}
        fetchData={fetchData}
        onSetPage={setPage}
        onSetPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        onToggleFilters={() => setShowFilters((prev) => !prev)}
        onToggleQuickLook={() => setShowQuickLook((prev) => !prev)}
        onAddRow={handleAddClick}
        onApplyFilter={(filter) => {
          setActiveFilter(filter);
          setPage(1);
        }}
        onCloseFilters={() => setShowFilters(false)}
        onClearFilters={() => {
          setActiveFilter({});
          setPage(1);
        }}
        onShowAllHiddenColumns={hiddenColumns.clear}
        onOpenProjection={() => setProjectionOpen(true)}
      />

      {data && (
        <div
          ref={scrollContainerRef}
          className="relative flex-1 overflow-auto text-sm"
          role="grid"
          aria-rowcount={1 + data.rows.length}
          aria-colcount={visibleEntries.length}
          onKeyDown={roving.onKeyDown}
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
            onResizeKeyDown={handleResizeKeyDown}
            onSortColumn={handleSortColumn}
            onClearColumnSort={handleClearColumnSort}
            onClearAllSorts={handleClearAllSorts}
            onHideColumn={hiddenColumns.hide}
            // Sprint 376 (Phase 6 Q21 #5 + #6) — header context menu
            // reset affordances. Same wire as the RDB grid.
            onResetColumnWidths={resetColumnWidths}
            onShowAllColumns={hiddenColumns.clear}
            anyColumnHidden={hiddenColumns.hidden.size > 0}
          />

          <DocumentGridRows
            data={data}
            queryResult={queryResult ?? null}
            page={page}
            visibleEntries={visibleEntries}
            editState={editState}
            expandedNested={expandedNested}
            setExpandedNested={setExpandedNested}
            rowKeyOf={rowKeyOf}
            handleStartEditCell={handleStartEditCell}
            scrollContainerWidth={scrollContainerWidth}
            cellTabIndex={roving.cellTabIndex}
            onFocusCell={roving.syncFocus}
          />
        </div>
      )}

      {showQuickLookMounted && queryResult && (
        <QuickLookPanel
          mode="document"
          rawDocuments={queryResult.rawDocuments}
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
          commitError={editState.commitError}
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
    </div>
  );
}

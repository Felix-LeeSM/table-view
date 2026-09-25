import {
  CellDetailDialog,
  ROW_HEIGHT_ESTIMATE,
  useColumnResize,
  useGridRoving,
  VIRTUALIZE_THRESHOLD,
} from "@components/datagrid";
import { safeStringifyCell } from "@lib/jsonCell";
import { useVirtualizer } from "@tanstack/react-virtual";
import Decimal from "decimal.js";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { getDefaultRem } from "@/lib/columnCategory";
import type { QueryResult } from "@/types/query";

function formatCell(cell: unknown): string {
  if (cell == null) return "NULL";
  // Decimal is object-like, so handle it before generic JSON stringifying.
  if (cell instanceof Decimal) return cell.toString();
  if (typeof cell === "object" && cell !== null) {
    return safeStringifyCell(cell);
  }
  return String(cell);
}

export function QueryResultTable({
  result,
  sql,
}: {
  result: QueryResult;
  /**
   * #1477 review B2 — executed SQL snapshot used as the scroll-reset
   * identity: a same-SQL refetch (new `result` object) preserves the
   * virtualized scroll position; a different SQL resets to the top.
   * Optional: when omitted, every new `result` identity resets (pre-#1477
   * behavior).
   */
  sql?: string;
}) {
  const { t } = useTranslation("query");
  const [cellDetail, setCellDetail] = useState<{
    data: unknown;
    columnName: string;
    dataType: string;
  } | null>(null);
  const widthColumns = useMemo(
    () => result.columns.map((c) => ({ name: c.name, category: c.category })),
    [result.columns],
  );
  const { widths, setWidth } = useColumnWidths(widthColumns);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const visualWidthsPx = useMemo(() => {
    const rootFontSizePx =
      typeof window !== "undefined"
        ? (() => {
            const measured = parseFloat(
              getComputedStyle(document.documentElement).fontSize,
            );
            return Number.isFinite(measured) ? measured : 16;
          })()
        : 16;
    return result.columns.map((col) => {
      const stored = widths[col.name];
      if (stored != null) return stored;
      return getDefaultRem(col.category) * rootFontSizePx;
    });
  }, [result.columns, widths]);
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

  // issue #1130 — read-only results keep role="grid" and wire up cell
  // keyboard nav. AC4 allows demoting to role="table", but grid stays for
  // (1) consistency with EditableQueryResultGrid behind the same router,
  // (2) opening cell-detail with Enter/F2 — demotion would leave it
  // double-click (mouse) only, and (3) avoiding the regression where the e2e
  // grid-text helper expects role="grid" on read-only results.
  const openCellDetail = useCallback(
    (rowIdx: number, cellIdx: number) => {
      const col = result.columns[cellIdx];
      if (!col) return;
      setCellDetail({
        data: result.rows[rowIdx]?.[cellIdx],
        columnName: col.name,
        dataType: col.dataType,
      });
    },
    [result.columns, result.rows],
  );

  // Issue #1442 — guards against DOM blow-up on large SQL results.
  // Virtualizes with the same threshold/row height/overscan as
  // DataGridTable. Below the threshold the existing render-everything path
  // stays, so small results (and the existing test contract) do not change.
  const shouldVirtualize = result.rows.length > VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? result.rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    // Same reason as DataGridTable (#1295) — avoids the blank flash on a
    // fast scrollbar drag.
    overscan: 24,
  });

  // #1477 review B2 — scroll resets only on a "new query". Re-running the
  // same SQL (e.g. the symmetric re-execute after a commit on the editable
  // path) changes only the result identity, so the position is preserved
  // (same reason as the executed_query deps in DataGridTable #1369). `sql`
  // is left out of the deps because the fallback for document results is the
  // live editor text and changes on every keystroke — compare only when the
  // result is replaced. `rowVirtualizer` is a fresh object each render, so
  // listing it in the deps would reset on every render.
  const lastResetSqlRef = useRef(sql);
  useEffect(() => {
    const isNewQuery = sql === undefined || lastResetSqlRef.current !== sql;
    lastResetSqlRef.current = sql;
    if (!shouldVirtualize || !isNewQuery) return;
    rowVirtualizer.scrollToIndex(0, { align: "start" });
    // Deps intentionally track only the result-set identity + the
    // virtualization toggle. `rowVirtualizer` is a fresh object each render, so
    // listing it would re-scroll to the top on every render (cf. DataGridTable,
    // #1369).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, shouldVirtualize]);

  const roving = useGridRoving(
    result.rows.length,
    result.columns.length,
    scrollContainerRef,
    {
      scrollRowIntoView: (row) => {
        if (shouldVirtualize) {
          rowVirtualizer.scrollToIndex(row, { align: "auto" });
        }
      },
    },
  );

  // The virtual and non-virtual branches share the same row JSX. The virtual
  // branch uses absolute-position + fixed-height rows, the DataGridTable
  // pattern.
  const renderRow = (
    row: unknown[],
    rowIdx: number,
    rowStyle?: CSSProperties,
  ) => (
    <div
      key={`row-${rowIdx}`}
      role="row"
      aria-rowindex={rowIdx + 2}
      className="border-b border-border hover:bg-muted"
      style={{
        display: "grid",
        gridTemplateColumns: "var(--cols)",
        minWidth: "max-content",
        ...rowStyle,
      }}
    >
      {row.map((cell, cellIdx) => {
        return (
          <div
            key={cellIdx}
            role="gridcell"
            aria-colindex={cellIdx + 1}
            data-grid-row={rowIdx}
            data-grid-col={cellIdx}
            tabIndex={roving.cellTabIndex(rowIdx, cellIdx)}
            onFocus={() => roving.syncFocus(rowIdx, cellIdx)}
            className="flex min-w-0 cursor-pointer items-center overflow-hidden border-r border-border px-3 py-1 text-xs text-foreground"
            title={`${formatCell(cell)}\n\n(double-click to expand)`}
            onKeyDown={(e) => {
              // issue #1130 — Enter/F2 opens the detail of the focused cell
              // (keyboard equivalent of double-click). Read-only, so no
              // editing.
              if (e.key !== "Enter" && e.key !== "F2") return;
              e.preventDefault();
              e.stopPropagation();
              openCellDetail(rowIdx, cellIdx);
            }}
            onDoubleClick={() => openCellDetail(rowIdx, cellIdx)}
          >
            {cell == null ? (
              <span className="italic text-muted-foreground">NULL</span>
            ) : (
              <span
                dir="auto"
                className="block overflow-hidden text-ellipsis whitespace-nowrap [unicode-bidi:isolate]"
              >
                {formatCell(cell)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={scrollContainerRef}
      className="flex-1 overflow-auto text-sm"
      role="grid"
      aria-rowcount={1 + result.rows.length}
      aria-colcount={result.columns.length}
      style={{ "--cols": colsTemplate } as CSSProperties}
      onKeyDown={roving.onKeyDown}
    >
      <div
        role="rowgroup"
        className="sticky top-0 z-10 bg-secondary"
        style={{ minWidth: "max-content" }}
      >
        <div
          role="row"
          aria-rowindex={1}
          style={{
            display: "grid",
            gridTemplateColumns: "var(--cols)",
            minWidth: "max-content",
          }}
        >
          {result.columns.map((col, visualIdx) => (
            <div
              key={col.name}
              role="columnheader"
              aria-colindex={visualIdx + 1}
              className="relative flex flex-col justify-center overflow-hidden border-b border-r border-border px-3 py-1.5 text-left text-xs font-medium text-secondary-foreground"
            >
              <div className="truncate">{col.name}</div>
              <div className="mt-0.5 truncate text-3xs text-muted-foreground">
                {col.dataType}
              </div>
              <div
                className="absolute right-0 top-0 h-full w-3 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 focus-visible:outline-1 focus-visible:outline-ring"
                onMouseDown={(e) => handleResizeStart(e, col.name, visualIdx)}
                onKeyDown={(e) => handleResizeKeyDown(e, col.name, visualIdx)}
                tabIndex={0}
                role="separator"
                aria-orientation="vertical"
                aria-label={t("resizeColumnAria")}
              />
            </div>
          ))}
        </div>
      </div>
      {shouldVirtualize ? (
        <div
          role="rowgroup"
          style={{
            position: "relative",
            height: rowVirtualizer.getTotalSize(),
            width: "100%",
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) =>
            renderRow(result.rows[virtualRow.index]!, virtualRow.index, {
              position: "absolute",
              top: virtualRow.start,
              left: 0,
              right: 0,
              height: virtualRow.size,
            }),
          )}
        </div>
      ) : (
        <div role="rowgroup">
          {result.rows.map((row, rowIdx) => renderRow(row, rowIdx))}
          {result.rows.length === 0 && (
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
                {t("resultTable.noData")}
              </div>
            </div>
          )}
        </div>
      )}
      {cellDetail && (
        <CellDetailDialog
          open={cellDetail !== null}
          onOpenChange={(open) => {
            if (!open) setCellDetail(null);
          }}
          data={cellDetail.data}
          columnName={cellDetail.columnName}
          dataType={cellDetail.dataType}
        />
      )}
    </div>
  );
}

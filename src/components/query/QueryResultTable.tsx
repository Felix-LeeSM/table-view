import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import Decimal from "decimal.js";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CellDetailDialog,
  ROW_HEIGHT_ESTIMATE,
  useColumnResize,
  useGridRoving,
  VIRTUALIZE_THRESHOLD,
} from "@components/datagrid";
import { getDefaultRem } from "@/lib/columnCategory";
import { useColumnWidths } from "@/hooks/useColumnWidths";
import { safeStringifyCell } from "@lib/jsonCell";
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
   * Optional: when omitted, every new `result` identity resets (legacy).
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

  // issue #1130 — read-only 결과도 role="grid" 를 유지하되 셀 키보드 nav 를
  // 배선한다. AC4 는 role="table" 강등을 허용하나, (1) 같은 router 뒤의
  // EditableQueryResultGrid 와의 일관성, (2) 강등 시 double-click(마우스) 전용이
  // 되는 cell-detail 을 Enter/F2 로 키보드 개방, (3) e2e grid-text 헬퍼가 read-
  // only 결과의 role="grid" 를 기대하는 회귀 회피를 위해 grid 를 유지한다.
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

  // Issue #1442 — 대용량 SQL 결과 DOM 폭증 방어. DataGridTable 과 같은
  // threshold/행높이/overscan 으로 가상화한다. threshold 이하는 기존 전량
  // 렌더 경로를 유지해 소규모 결과의 동작(및 기존 테스트 계약)이 변하지
  // 않는다.
  const shouldVirtualize = result.rows.length > VIRTUALIZE_THRESHOLD;
  const rowVirtualizer = useVirtualizer({
    count: shouldVirtualize ? result.rows.length : 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    // DataGridTable 과 동일 근거(#1295) — 빠른 scrollbar drag 의 blank flash 방지.
    overscan: 24,
  });

  // #1477 review B2 — 스크롤 리셋은 "새 쿼리" 에만. 같은 SQL 재조회(예:
  // editable 경로의 commit 후 재실행과 대칭)는 result identity 만 바뀌므로
  // 위치를 보존한다 (DataGridTable #1369 의 executed_query deps 와 같은
  // 근거). `sql` 을 deps 에 넣지 않는 이유: document 결과의 fallback 은 live
  // editor 텍스트라 타이핑마다 바뀐다 — result 교체 시점에만 비교한다.
  // `rowVirtualizer` 는 매 렌더 새 객체라 deps 에 넣으면 매 렌더 리셋된다.
  const lastResetSqlRef = useRef(sql);
  useEffect(() => {
    const isNewQuery = sql === undefined || lastResetSqlRef.current !== sql;
    lastResetSqlRef.current = sql;
    if (!shouldVirtualize || !isNewQuery) return;
    rowVirtualizer.scrollToIndex(0, { align: "start" });
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

  // 가상/비가상 branch 가 같은 행 JSX 를 공유한다. 가상 branch 는
  // DataGridTable 패턴 그대로 absolute-position + 고정 높이 행.
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
              // issue #1130 — Enter/F2 로 focus 된 cell 의 detail 열기
              // (double-click 의 키보드 등가물). 읽기 전용이라 편집은 없음.
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

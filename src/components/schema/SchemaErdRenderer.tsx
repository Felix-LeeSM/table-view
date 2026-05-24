import { useEffect, useMemo, useRef, useState } from "react";
import {
  Crosshair,
  Maximize2,
  Network,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@components/ui/button";
import type { SchemaGraph } from "@/types/schemaGraph";
import {
  buildErdLayout,
  buildSelectedNeighborhood,
  filterTables,
  MAX_RENDERED_COLUMNS,
  relationshipPath,
  TABLE_HEIGHT,
  TABLE_WIDTH,
} from "./SchemaErdLayout";

interface SchemaErdRendererProps {
  graph: SchemaGraph;
  selectedTableId?: string;
  onSelectedTableIdChange?: (tableId: string) => void;
}

export default function SchemaErdRenderer({
  graph,
  selectedTableId,
  onSelectedTableIdChange,
}: SchemaErdRendererProps) {
  const [internalSelectedTableId, setInternalSelectedTableId] = useState<
    string | null
  >(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [zoom, setZoom] = useState(1);
  const tableRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = selectedTableId ?? internalSelectedTableId;
  const layout = useMemo(() => buildErdLayout(graph), [graph]);
  const selectedNeighborhood = useMemo(
    () => buildSelectedNeighborhood(layout.relationships, selected),
    [layout.relationships, selected],
  );
  const searchMatches = useMemo(
    () => filterTables(layout.tables, searchTerm),
    [layout.tables, searchTerm],
  );
  const selectedTableLabel = selected
    ? layout.tables.find(({ table }) => table.id === selected)?.table.label
    : null;

  useEffect(() => {
    tableRefs.current.clear();
  }, [layout.tables]);

  if (layout.tables.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground"
      >
        <Network size={28} aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          No tables to diagram
        </p>
        <p className="max-w-md text-xs">
          Expand or refresh a relational schema to build an ERD from cached
          table metadata.
        </p>
      </div>
    );
  }

  const width = Math.max(
    720,
    Math.max(...layout.tables.map((table) => table.x + TABLE_WIDTH + 32)),
  );
  const height = Math.max(
    420,
    Math.max(...layout.tables.map((table) => table.y + TABLE_HEIGHT + 32)),
  );
  const zoomPercent = Math.round(zoom * 100);

  const handleSelect = (tableId: string) => {
    setInternalSelectedTableId(tableId);
    onSelectedTableIdChange?.(tableId);
  };

  const focusTable = (tableId: string) => {
    handleSelect(tableId);
    runAfterPaint(() => {
      tableRefs.current.get(tableId)?.focus();
    });
  };

  const fitSelectedTable = () => {
    if (!selected) return;
    setZoom(1);
    runAfterPaint(() => {
      tableRefs.current
        .get(selected)
        ?.scrollIntoView?.({ block: "center", inline: "center" });
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Network size={14} className="text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">
            ERD
          </span>
          <span className="text-3xs text-muted-foreground">
            {layout.tables.length} tables / {layout.relationships.length}{" "}
            relationships
          </span>
        </div>
        <label className="flex min-w-[11rem] max-w-xs flex-1 items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
          <Search size={13} aria-hidden="true" />
          <span className="sr-only">Search ERD tables</span>
          <input
            aria-label="Search ERD tables"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder="Find table"
          />
          {searchTerm.trim() && (
            <span className="whitespace-nowrap text-3xs tabular-nums">
              {searchMatches.length}/{layout.tables.length}
            </span>
          )}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom out ERD"
            title="Zoom out"
            onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}
          >
            <ZoomOut />
          </Button>
          <span className="w-10 text-center text-3xs tabular-nums text-muted-foreground">
            {zoomPercent}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Zoom in ERD"
            title="Zoom in"
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
          >
            <ZoomIn />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Fit selected table"
            title="Fit selected table"
            disabled={!selected}
            onClick={fitSelectedTable}
          >
            <Crosshair />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Fit ERD"
            title="Fit ERD"
            onClick={() => setZoom(0.85)}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>

      {searchTerm.trim() && (
        <div
          role="listbox"
          aria-label="ERD table search results"
          className="flex max-h-20 flex-wrap gap-1 overflow-auto border-b border-border bg-muted/20 px-3 py-2"
        >
          {searchMatches.length > 0 ? (
            searchMatches.map(({ table }) => (
              <button
                key={table.id}
                type="button"
                role="option"
                aria-selected={selected === table.id}
                onClick={() => focusTable(table.id)}
                className="max-w-48 truncate rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:border-primary/60 aria-selected:border-primary aria-selected:bg-primary/10"
              >
                {table.schema}.{table.table}
              </button>
            ))
          ) : (
            <div
              role="option"
              aria-disabled="true"
              aria-selected="false"
              className="text-xs text-muted-foreground"
            >
              No matching tables
            </div>
          )}
        </div>
      )}

      {layout.relationships.length === 0 && (
        <div
          role="status"
          className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          No relationships yet. Showing isolated tables from the current schema
          cache.
        </div>
      )}

      <div
        role="figure"
        aria-label="Database relationship diagram"
        className="relative flex-1 overflow-auto bg-background"
      >
        <div
          className="relative"
          style={{
            width,
            height,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={height}
            aria-hidden={layout.relationships.length === 0}
          >
            <defs>
              <marker
                id="erd-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" className="fill-primary" />
              </marker>
            </defs>
            {layout.relationships.map(({ edge, from, to, label }) => {
              const highlighted =
                !selected ||
                selectedNeighborhood.highlightedEdgeIds.has(edge.id);
              return (
                <path
                  key={edge.id}
                  d={relationshipPath(from, to)}
                  role="img"
                  aria-label={label}
                  data-highlighted={highlighted}
                  className={`fill-none ${
                    highlighted
                      ? "stroke-primary"
                      : "stroke-muted-foreground/30"
                  }`}
                  strokeWidth={highlighted ? 3 : 1.5}
                  markerEnd="url(#erd-arrow)"
                />
              );
            })}
          </svg>

          {layout.tables.map(({ table, columns, x, y }) => {
            const isSelected = selected === table.id;
            const isRelated =
              !selected ||
              isSelected ||
              selectedNeighborhood.relatedTableIds.has(table.id);
            const isSearchMatch = searchMatches.some(
              (match) => match.table.id === table.id,
            );
            const visibleColumns = columns.slice(0, MAX_RENDERED_COLUMNS);
            const hiddenColumnCount = Math.max(
              0,
              columns.length - visibleColumns.length,
            );

            return (
              <button
                key={table.id}
                ref={(node) => {
                  if (node) tableRefs.current.set(table.id, node);
                  else tableRefs.current.delete(table.id);
                }}
                type="button"
                aria-label={`${table.schema}.${table.table} table`}
                aria-pressed={isSelected}
                aria-current={selected === table.id ? "true" : undefined}
                data-related={isRelated}
                data-search-match={searchTerm.trim() ? isSearchMatch : true}
                onClick={() => handleSelect(table.id)}
                className={`absolute flex flex-col overflow-hidden rounded border bg-card text-left shadow-sm transition-colors ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : isRelated
                      ? "border-border hover:border-primary/60"
                      : "border-border opacity-45 hover:border-primary/60"
                } ${
                  searchTerm.trim() && isSearchMatch && !isSelected
                    ? "ring-1 ring-primary/20"
                    : ""
                }`}
                style={{
                  left: x,
                  top: y,
                  width: TABLE_WIDTH,
                  height: TABLE_HEIGHT,
                }}
              >
                <div className="w-full border-b border-border bg-secondary px-3 py-2">
                  <div className="truncate text-3xs uppercase text-muted-foreground">
                    {table.schema}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {table.table}
                    </span>
                    {isSelected && (
                      <span className="rounded bg-primary/10 px-1 text-3xs font-semibold text-primary">
                        focused
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-1 flex-col py-1">
                  {visibleColumns.map((column) => (
                    <div
                      key={column.id}
                      className="grid grid-cols-[2.5rem_1fr] items-center gap-2 px-3 py-1 text-xs"
                    >
                      <span className="flex gap-1">
                        {column.data.is_primary_key && (
                          <span className="rounded bg-primary/10 px-1 text-3xs font-semibold text-primary">
                            PK
                          </span>
                        )}
                        {column.data.is_foreign_key && (
                          <span className="rounded bg-accent px-1 text-3xs font-semibold text-accent-foreground">
                            FK
                          </span>
                        )}
                      </span>
                      <span className="truncate text-foreground">
                        {column.column}
                      </span>
                    </div>
                  ))}
                  {hiddenColumnCount > 0 && (
                    <div className="px-3 py-1 text-xs text-muted-foreground">
                      +{hiddenColumnCount} more columns
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {selectedTableLabel && (
        <div className="border-t border-border bg-muted/20 px-3 py-1 text-3xs text-muted-foreground">
          Focused table: {selectedTableLabel}
        </div>
      )}
    </div>
  );
}

function runAfterPaint(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

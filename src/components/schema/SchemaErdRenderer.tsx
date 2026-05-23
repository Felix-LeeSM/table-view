import { useMemo, useState } from "react";
import { Maximize2, Network, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@components/ui/button";
import type {
  SchemaGraph,
  SchemaGraphColumnNode,
  SchemaGraphEdge,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

interface SchemaErdRendererProps {
  graph: SchemaGraph;
  selectedTableId?: string;
  onSelectedTableIdChange?: (tableId: string) => void;
}

interface ErdTableLayout {
  table: SchemaGraphTableNode;
  columns: readonly SchemaGraphColumnNode[];
  x: number;
  y: number;
}

interface ErdRelationshipLayout {
  edge: SchemaGraphEdge;
  from: ErdTableLayout;
  to: ErdTableLayout;
  label: string;
}

const TABLE_WIDTH = 240;
const TABLE_HEIGHT = 214;
const TABLE_GAP_X = 116;
const TABLE_GAP_Y = 52;
const TABLES_PER_ROW = 3;
const MAX_RENDERED_COLUMNS = 6;

export default function SchemaErdRenderer({
  graph,
  selectedTableId,
  onSelectedTableIdChange,
}: SchemaErdRendererProps) {
  const [internalSelectedTableId, setInternalSelectedTableId] = useState<
    string | null
  >(null);
  const [zoom, setZoom] = useState(1);
  const selected = selectedTableId ?? internalSelectedTableId;
  const layout = useMemo(() => buildErdLayout(graph), [graph]);

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

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-secondary px-3 py-1.5">
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
        <div className="flex items-center gap-1">
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
            aria-label="Fit ERD"
            title="Fit"
            onClick={() => setZoom(0.85)}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>

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
            {layout.relationships.map(({ edge, from, to, label }) => (
              <path
                key={edge.id}
                d={relationshipPath(from, to)}
                role="img"
                aria-label={label}
                className="fill-none stroke-primary/70"
                strokeWidth={2}
                markerEnd="url(#erd-arrow)"
              />
            ))}
          </svg>

          {layout.tables.map(({ table, columns, x, y }) => {
            const isSelected = selected === table.id;
            const visibleColumns = columns.slice(0, MAX_RENDERED_COLUMNS);
            const hiddenColumnCount = Math.max(
              0,
              columns.length - visibleColumns.length,
            );

            return (
              <button
                key={table.id}
                type="button"
                aria-label={`${table.schema}.${table.table} table`}
                aria-pressed={isSelected}
                onClick={() => handleSelect(table.id)}
                className={`absolute flex flex-col overflow-hidden rounded border bg-card text-left shadow-sm transition-colors ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/20"
                    : "border-border hover:border-primary/60"
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
                  <div className="truncate text-sm font-semibold text-foreground">
                    {table.table}
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
    </div>
  );
}

function buildErdLayout(graph: SchemaGraph): {
  tables: readonly ErdTableLayout[];
  relationships: readonly ErdRelationshipLayout[];
} {
  const columnsByTable = new Map<string, SchemaGraphColumnNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "column") continue;
    const tableId = node.id.slice(0, node.id.lastIndexOf(".column:"));
    const columns = columnsByTable.get(tableId) ?? [];
    columns.push(node);
    columnsByTable.set(tableId, columns);
  }

  const tables = graph.nodes
    .filter((node): node is SchemaGraphTableNode => node.kind === "table")
    .map((table, index) => ({
      table,
      columns: (columnsByTable.get(table.id) ?? []).sort(
        (left, right) => left.ordinal - right.ordinal,
      ),
      x: 32 + (index % TABLES_PER_ROW) * (TABLE_WIDTH + TABLE_GAP_X),
      y: 32 + Math.floor(index / TABLES_PER_ROW) * (TABLE_HEIGHT + TABLE_GAP_Y),
    }));
  const tableById = new Map(tables.map((table) => [table.table.id, table]));

  const relationships = graph.edges
    .filter((edge) => edge.kind === "foreign-key-table")
    .flatMap((edge) => {
      const from = tableById.get(edge.from);
      const to = tableById.get(edge.to);
      if (!from || !to) return [];
      return [
        {
          edge,
          from,
          to,
          label: relationshipLabel(edge),
        },
      ];
    });

  return { tables, relationships };
}

function relationshipLabel(edge: SchemaGraphEdge): string {
  const relationship = edge.foreignKey;
  if (!relationship) return `${edge.from} references ${edge.to}`;
  return `${relationship.source.schema}.${relationship.source.table}.${relationship.source.columns.join(
    ", ",
  )} references ${relationship.target.schema}.${relationship.target.table}.${relationship.target.columns.join(
    ", ",
  )}`;
}

function relationshipPath(from: ErdTableLayout, to: ErdTableLayout): string {
  const sourceX = from.x < to.x ? from.x + TABLE_WIDTH : from.x;
  const targetX = from.x < to.x ? to.x : to.x + TABLE_WIDTH;
  const sourceY = from.y + TABLE_HEIGHT / 2;
  const targetY = to.y + TABLE_HEIGHT / 2;
  const curve = Math.max(72, Math.abs(targetX - sourceX) / 2);
  const sourceCurveX = sourceX + (from.x < to.x ? curve : -curve);
  const targetCurveX = targetX + (from.x < to.x ? -curve : curve);

  return `M ${sourceX} ${sourceY} C ${sourceCurveX} ${sourceY}, ${targetCurveX} ${targetY}, ${targetX} ${targetY}`;
}

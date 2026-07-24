import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Crosshair,
  KeyRound,
  Link2,
  Maximize2,
  Network,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@components/ui/button";
import {
  selectSchemaGraphIntelligence,
  type SchemaGraphForeignKeySelection,
  type SchemaGraphIntelligenceSelectors,
  type SchemaGraphTableForeignKeys,
  type SchemaGraphTableMetadataReadiness,
} from "@/lib/schemaGraphSelectors";
import type {
  SchemaGraph,
  SchemaGraphConstraintNode,
  SchemaGraphIndexNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
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
  intelligence?: SchemaGraphIntelligenceSelectors;
  selectedTableId?: string;
  onSelectedTableIdChange?: (tableId: string | null) => void;
}

export default function SchemaErdRenderer({
  graph,
  intelligence,
  selectedTableId,
  onSelectedTableIdChange,
}: SchemaErdRendererProps) {
  const { t } = useTranslation("schema");
  const [internalSelectedTableId, setInternalSelectedTableId] = useState<
    string | null
  >(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [zoom, setZoom] = useState(1);
  const tableRefs = useRef(new Map<string, HTMLButtonElement>());
  const selected = selectedTableId ?? internalSelectedTableId;
  const selectors = useMemo(
    () => intelligence ?? selectSchemaGraphIntelligence(graph),
    [graph, intelligence],
  );
  const layout = useMemo(() => buildErdLayout(selectors.graph), [selectors]);
  const activeSelected = layout.tables.some(
    ({ table }) => table.id === selected,
  )
    ? selected
    : null;
  const selectedNeighborhood = useMemo(
    () => buildSelectedNeighborhood(layout.relationships, activeSelected),
    [layout.relationships, activeSelected],
  );
  const searchMatches = useMemo(
    () => filterTables(layout.tables, searchTerm),
    [layout.tables, searchTerm],
  );
  const selectedTable = activeSelected
    ? selectors.tablesById.get(activeSelected)
    : undefined;

  const setSelection = useCallback(
    (tableId: string | null) => {
      setInternalSelectedTableId(tableId);
      onSelectedTableIdChange?.(tableId);
    },
    [onSelectedTableIdChange],
  );

  // Escape clears the active selection (issue #1736). Attached only while a
  // table is selected so the ERD never swallows Escape from unrelated surfaces.
  useEffect(() => {
    if (!activeSelected) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelection(null);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [activeSelected, setSelection]);

  if (layout.tables.length === 0) {
    return (
      <div
        role="status"
        className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-muted-foreground"
      >
        <Network size={28} aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">
          {t("noTablesToDiagram")}
        </p>
        <p className="max-w-md text-xs">{t("noTablesHint")}</p>
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

  const focusTable = (tableId: string) => {
    setSelection(tableId);
    runAfterPaint(() => {
      tableRefs.current.get(tableId)?.focus();
    });
  };

  const fitSelectedTable = () => {
    if (!activeSelected) return;
    setZoom(1);
    runAfterPaint(() => {
      tableRefs.current
        .get(activeSelected)
        ?.scrollIntoView?.({ block: "center", inline: "center" });
    });
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <Network size={14} className="text-muted-foreground" />
          <span className="truncate text-xs font-medium text-foreground">
            {t("erdLabel")}
          </span>
          <span className="text-3xs text-muted-foreground">
            {t("erdTablesRelationships", {
              tables: layout.tables.length,
              relationships: layout.relationships.length,
            })}
          </span>
        </div>
        <label className="flex min-w-[11rem] max-w-xs flex-1 items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-muted-foreground">
          <Search size={13} aria-hidden="true" />
          <span className="sr-only">{t("searchErdTablesAria")}</span>
          <input
            aria-label={t("searchErdTablesAria")}
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={t("findTablePlaceholder")}
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
            aria-label={t("zoomOutAria")}
            title={t("zoomOutTitle")}
            onClick={() => setZoom((value) => Math.max(0.55, value - 0.1))}
          >
            <ZoomOut />
          </Button>
          <span
            aria-label={t("zoomPercentAria")}
            className="w-10 text-center text-3xs tabular-nums text-muted-foreground"
          >
            {zoomPercent}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("zoomInAria")}
            title={t("zoomInTitle")}
            onClick={() => setZoom((value) => Math.min(1.6, value + 0.1))}
          >
            <ZoomIn />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("fitSelectedTableAria")}
            title={t("fitSelectedTableTitle")}
            disabled={!activeSelected}
            onClick={fitSelectedTable}
          >
            <Crosshair />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("fitErdAria")}
            title={t("fitErdTitle")}
            onClick={() => setZoom(0.85)}
          >
            <Maximize2 />
          </Button>
        </div>
      </div>

      {searchTerm.trim() && (
        <div
          role="listbox"
          aria-label={t("erdSearchResultsAria")}
          className="flex max-h-20 flex-wrap gap-1 overflow-auto border-b border-border bg-muted/20 px-3 py-2"
        >
          {searchMatches.length > 0 ? (
            searchMatches.map(({ table }) => (
              <button
                key={table.id}
                type="button"
                role="option"
                aria-selected={activeSelected === table.id}
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
              {t("noMatchingTables")}
            </div>
          )}
        </div>
      )}

      {layout.relationships.length === 0 && (
        <div
          role="status"
          className="border-b border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          {t("noRelationshipsYet")}
        </div>
      )}

      <div
        role="figure"
        aria-label={t("databaseRelationshipDiagram")}
        className="relative flex-1 overflow-auto bg-background"
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelection(null);
        }}
      >
        <div
          className="relative"
          style={{
            width,
            height,
            transform: `scale(${zoom})`,
            transformOrigin: "top left",
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelection(null);
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
                !activeSelected ||
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
            const isSelected = activeSelected === table.id;
            const isRelated =
              !activeSelected ||
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
                aria-current={activeSelected === table.id ? "true" : undefined}
                data-related={isRelated}
                data-search-match={searchTerm.trim() ? isSearchMatch : true}
                onClick={() => setSelection(isSelected ? null : table.id)}
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
                        {t("focused")}
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
                      {t("moreColumns", { count: hiddenColumnCount })}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
      {selectedTable && (
        <SelectedTableDependencyView
          table={selectedTable}
          foreignKeys={selectors.foreignKeysByTableId.get(selectedTable.id)}
          indexes={selectors.indexesByTableId.get(selectedTable.id) ?? []}
          constraints={
            selectors.constraintsByTableId.get(selectedTable.id) ?? []
          }
          metadata={selectors.metadataReadinessByTableId.get(selectedTable.id)}
          tableLabel={`${selectedTable.schema}.${selectedTable.table}`}
        />
      )}
    </div>
  );
}

interface SelectedTableDependencyViewProps {
  table: SchemaGraphTableNode;
  foreignKeys?: SchemaGraphTableForeignKeys;
  indexes: readonly SchemaGraphIndexNode[];
  constraints: readonly SchemaGraphConstraintNode[];
  metadata?: SchemaGraphTableMetadataReadiness;
  tableLabel: string;
}

function SelectedTableDependencyView({
  table,
  foreignKeys,
  indexes,
  constraints,
  metadata,
  tableLabel,
}: SelectedTableDependencyViewProps) {
  const { t } = useTranslation("schema");
  const incoming = foreignKeys?.incomingForeignKeys ?? [];
  const outgoing = foreignKeys?.outgoingForeignKeys ?? [];
  const hasDependencyRows = incoming.length > 0 || outgoing.length > 0;
  const hasMetadataRows = indexes.length > 0 || constraints.length > 0;
  const metadataNotice = formatMetadataNotice(metadata);

  return (
    <section
      aria-label={`Dependencies for ${table.schema}.${table.table}`}
      className="max-h-56 overflow-auto border-t border-border bg-muted/20 px-3 py-2"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link2 size={13} className="shrink-0 text-muted-foreground" />
          <h2 className="truncate text-xs font-semibold text-foreground">
            {t("dependencies")}
          </h2>
          <span className="truncate text-3xs text-muted-foreground">
            {tableLabel}
          </span>
        </div>
        <span className="text-3xs text-muted-foreground">
          {t("readOnlySchemaGraphView")}
        </span>
      </div>

      {metadataNotice && (
        <div
          role="status"
          className="mb-2 flex items-start gap-2 rounded border border-border bg-background px-2 py-1.5 text-3xs text-muted-foreground"
        >
          <AlertTriangle
            size={12}
            aria-hidden="true"
            className="mt-0.5 shrink-0 text-warning"
          />
          <span>{metadataNotice}</span>
        </div>
      )}

      {!hasDependencyRows && !hasMetadataRows && (
        <div className="rounded border border-dashed border-border bg-background px-2 py-2 text-xs text-muted-foreground">
          {t("noDependenciesForTable")}
        </div>
      )}

      <div className="grid gap-2 lg:grid-cols-2">
        <ForeignKeyGroup title={t("incoming")} foreignKeys={incoming} />
        <ForeignKeyGroup title={t("outgoing")} foreignKeys={outgoing} />
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <IndexGroup indexes={indexes} />
        <ConstraintGroup constraints={constraints} />
      </div>

      {metadata?.diagnostics.length ? (
        <div className="mt-2 rounded border border-border bg-background px-2 py-2">
          <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
            <AlertTriangle size={11} aria-hidden="true" />
            {t("schemaGraphDiagnostics")}
          </div>
          <ul className="space-y-1 text-3xs text-muted-foreground">
            {metadata.diagnostics.map((diagnostic) => (
              <li key={diagnostic.id} className="min-w-0">
                <span className="font-medium text-foreground">
                  {diagnostic.kind}
                </span>
                <span>: {diagnostic.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function ForeignKeyGroup({
  title,
  foreignKeys,
}: {
  title: string;
  foreignKeys: readonly SchemaGraphForeignKeySelection[];
}) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 flex items-center gap-1 text-3xs font-semibold uppercase text-muted-foreground">
        <KeyRound size={11} aria-hidden="true" />
        {title}
      </div>
      {foreignKeys.length > 0 ? (
        <ul className="space-y-1">
          {foreignKeys.map((foreignKey) => (
            <li
              key={foreignKey.edgeId}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs text-muted-foreground"
            >
              <div className="truncate font-medium text-foreground">
                {foreignKey.relationship.rawMetadata.constraintName}
              </div>
              <div
                className="truncate"
                title={formatForeignKeyTitle(foreignKey)}
              >
                {formatTableEndpoint(foreignKey.relationship.source)} {"->"}{" "}
                {formatTableEndpoint(foreignKey.relationship.target)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">
          {t("noFks", { direction: title.toLowerCase() })}
        </p>
      )}
    </div>
  );
}

function IndexGroup({ indexes }: { indexes: readonly SchemaGraphIndexNode[] }) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 text-3xs font-semibold uppercase text-muted-foreground">
        {t("relatedIndexes")}
      </div>
      {indexes.length > 0 ? (
        <ul className="space-y-1">
          {indexes.map((index) => (
            <li
              key={index.id}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs"
            >
              <div className="truncate font-medium text-foreground">
                {index.index}
              </div>
              <div className="truncate text-muted-foreground">
                {formatIndexFlags(index)} on {formatColumns(index.data.columns)}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">
          {t("noRelatedIndexes")}
        </p>
      )}
    </div>
  );
}

function ConstraintGroup({
  constraints,
}: {
  constraints: readonly SchemaGraphConstraintNode[];
}) {
  const { t } = useTranslation("schema");
  return (
    <div className="min-w-0 rounded border border-border bg-background px-2 py-2">
      <div className="mb-1 text-3xs font-semibold uppercase text-muted-foreground">
        {t("constraintsTab")}
      </div>
      {constraints.length > 0 ? (
        <ul className="space-y-1">
          {constraints.map((constraint) => (
            <li
              key={constraint.id}
              className="min-w-0 rounded bg-muted/30 px-2 py-1 text-3xs"
            >
              <div className="flex min-w-0 items-center gap-1">
                <span className="truncate font-medium text-foreground">
                  {constraint.constraint}
                </span>
                <span className="shrink-0 rounded bg-secondary px-1 text-3xs text-muted-foreground">
                  {constraint.data.constraintType}
                </span>
              </div>
              <div className="truncate text-muted-foreground">
                {formatColumns(constraint.data.columns)}
              </div>
              {constraint.data.checkExpression && (
                <div
                  className="truncate font-mono text-3xs text-muted-foreground"
                  title={constraint.data.checkExpression}
                >
                  {constraint.data.checkExpression}
                </div>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-3xs text-muted-foreground">{t("noConstraints")}</p>
      )}
    </div>
  );
}

function formatMetadataNotice(
  metadata: SchemaGraphTableMetadataReadiness | undefined,
): string | null {
  if (!metadata || metadata.status === "ready") return null;
  if (metadata.status === "unknown") {
    return "Metadata readiness unknown for this graph.";
  }
  if (metadata.missing.length === 0) {
    return "Dependency metadata may be incomplete.";
  }
  return `Dependency metadata incomplete: missing ${metadata.missing.join(
    ", ",
  )}.`;
}

function formatIndexFlags(index: SchemaGraphIndexNode): string {
  const flags = [
    index.data.is_primary ? "primary" : null,
    index.data.is_unique ? "unique" : null,
    index.data.index_type || "index",
  ].filter(Boolean);
  return flags.join(" ");
}

function formatColumns(columns: readonly string[]): string {
  return columns.length > 0 ? columns.join(", ") : "no columns";
}

function formatTableEndpoint(
  endpoint: SchemaGraphForeignKeySelection["relationship"]["source"],
): string {
  return `${endpoint.schema}.${endpoint.table} (${formatColumns(
    endpoint.columns,
  )})`;
}

function formatForeignKeyTitle(
  foreignKey: SchemaGraphForeignKeySelection,
): string {
  return `${formatTableEndpoint(
    foreignKey.relationship.source,
  )} -> ${formatTableEndpoint(foreignKey.relationship.target)}`;
}

function runAfterPaint(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

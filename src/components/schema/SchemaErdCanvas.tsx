import { Button } from "@components/ui/button";
import {
  Background,
  BaseEdge,
  type Edge,
  type EdgeProps,
  getBezierPath,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
  useStore,
} from "@xyflow/react";
import {
  Crosshair,
  Maximize2,
  Network,
  Search,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type SchemaGraphIntelligenceSelectors,
  selectSchemaGraphIntelligence,
} from "@/lib/schemaGraphSelectors";
import type { SchemaGraph } from "@/types/schemaGraph";
import "@xyflow/react/dist/style.css";
import {
  ERD_TABLE_NODE_TYPE,
  ErdCanvasContext,
  type ErdCanvasView,
  type ErdTableFlowNode,
} from "./erdCanvasContext";
import {
  buildErdModel,
  buildErdNeighborhood,
  erdModelFingerprint,
  filterErdTables,
  layoutErdModel,
} from "./erdGraphModel";
import SchemaErdDependencyView from "./SchemaErdDependencyView";
import SchemaErdTableNode from "./SchemaErdTableNode";

interface SchemaErdCanvasProps {
  graph: SchemaGraph;
  intelligence?: SchemaGraphIntelligenceSelectors;
  selectedTableId?: string;
  onSelectedTableIdChange?: (tableId: string | null) => void;
}

const ERD_RELATIONSHIP_EDGE_TYPE = "erdRelationship";
const ERD_MIN_ZOOM = 0.15;
const ERD_MAX_ZOOM = 2;
const ERD_TRANSITION_MS = 200;

type ErdRelationshipFlowEdge = Edge<
  { highlighted: boolean },
  "erdRelationship"
>;

const NODE_TYPES = { [ERD_TABLE_NODE_TYPE]: SchemaErdTableNode };
const EDGE_TYPES = { [ERD_RELATIONSHIP_EDGE_TYPE]: SchemaErdRelationshipEdge };

/**
 * ERD canvas on React Flow + elkjs layered auto-layout (ADR 0054). Replaces the
 * hand-rolled SVG renderer and its fixed 3-column grid: elkjs ranks tables by FK
 * direction, React Flow owns zoom/pan/drag, and every schema shares one flat
 * canvas with a `schema.table` name plus a schema badge.
 */
export default function SchemaErdCanvas(props: SchemaErdCanvasProps) {
  return (
    <ReactFlowProvider>
      <ErdCanvasSurface {...props} />
    </ReactFlowProvider>
  );
}

function ErdCanvasSurface({
  graph,
  intelligence,
  selectedTableId,
  onSelectedTableIdChange,
}: SchemaErdCanvasProps) {
  const { t } = useTranslation("schema");
  const [internalSelectedTableId, setInternalSelectedTableId] = useState<
    string | null
  >(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [nodes, setNodes, onNodesChange] = useNodesState<ErdTableFlowNode>([]);
  const tableButtons = useRef(new Map<string, HTMLButtonElement>());
  const { fitView, getNode, setCenter, zoomIn, zoomOut } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const zoom = useStore((state) => state.transform[2]);

  const selected = selectedTableId ?? internalSelectedTableId;
  const selectors = useMemo(
    () => intelligence ?? selectSchemaGraphIntelligence(graph),
    [graph, intelligence],
  );
  const model = useMemo(() => buildErdModel(selectors.graph), [selectors]);
  const fingerprint = useMemo(() => erdModelFingerprint(model), [model]);
  const tablesById = useMemo(
    () => new Map(model.tables.map((entry) => [entry.table.id, entry])),
    [model],
  );
  const activeSelected = selected && tablesById.has(selected) ? selected : null;
  const neighborhood = useMemo(
    () => buildErdNeighborhood(model.relationships, activeSelected),
    [model.relationships, activeSelected],
  );
  const searchMatches = useMemo(
    () => filterErdTables(model.tables, searchTerm),
    [model.tables, searchTerm],
  );
  const searchMatchTableIds = useMemo(
    () =>
      searchTerm.trim()
        ? new Set(searchMatches.map((entry) => entry.table.id))
        : null,
    [searchMatches, searchTerm],
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

  // The model object is rebuilt on every metadata fetch, so the layout effect
  // reads it through a ref and re-runs only on `fingerprint`. This effect is
  // declared first so the ref is already fresh when the layout effect runs in
  // the same commit.
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  useEffect(() => {
    let cancelled = false;
    const target = modelRef.current;
    void layoutErdModel(target).then((positions) => {
      if (cancelled) return;
      setNodes(
        target.tables.map((entry) => ({
          id: entry.table.id,
          type: ERD_TABLE_NODE_TYPE,
          position: positions.get(entry.table.id) ?? { x: 0, y: 0 },
          width: entry.width,
          height: entry.height,
          data: {},
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [fingerprint, setNodes]);

  // Columns can arrive after the layout ran (the panel prefetches them per
  // schema), which changes how tall a card is. Resize in place — moving the node
  // would discard a drag the user already made.
  useEffect(() => {
    setNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        const entry = tablesById.get(node.id);
        if (!entry || node.height === entry.height) return node;
        changed = true;
        return { ...node, height: entry.height };
      });
      return changed ? next : current;
    });
  }, [tablesById, setNodes]);

  const fittedFingerprint = useRef<string | null>(null);
  useEffect(() => {
    if (!nodesInitialized || nodes.length === 0) return;
    if (fittedFingerprint.current === fingerprint) return;
    fittedFingerprint.current = fingerprint;
    void fitView({ padding: 0.15, maxZoom: 1 });
  }, [fingerprint, fitView, nodes.length, nodesInitialized]);

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

  const registerTableButton = useCallback(
    (tableId: string, element: HTMLButtonElement | null) => {
      if (element) tableButtons.current.set(tableId, element);
      else tableButtons.current.delete(tableId);
    },
    [],
  );
  const onToggleSelect = useCallback(
    (tableId: string) => {
      setSelection(selected === tableId ? null : tableId);
    },
    [selected, setSelection],
  );
  const canvasView = useMemo<ErdCanvasView>(
    () => ({
      tablesById,
      selectedTableId: activeSelected,
      relatedTableIds: neighborhood.relatedTableIds,
      searchMatchTableIds,
      onToggleSelect,
      registerTableButton,
    }),
    [
      activeSelected,
      neighborhood.relatedTableIds,
      onToggleSelect,
      registerTableButton,
      searchMatchTableIds,
      tablesById,
    ],
  );

  const edges = useMemo<ErdRelationshipFlowEdge[]>(
    () =>
      model.relationships.map((relationship) => {
        const highlighted =
          !activeSelected ||
          neighborhood.highlightedEdgeIds.has(relationship.edge.id);
        return {
          id: relationship.edge.id,
          type: ERD_RELATIONSHIP_EDGE_TYPE,
          source: relationship.sourceTableId,
          target: relationship.targetTableId,
          selectable: false,
          focusable: false,
          // React Flow labels the edge group; the drawn path stays unlabeled so
          // one relationship is announced once.
          ariaLabel: relationship.label,
          // React's SVGAttributes has no index signature, so a `data-*`
          // attribute needs the cast to pass through the escape hatch.
          domAttributes: {
            "data-highlighted": String(highlighted),
          } as ErdRelationshipFlowEdge["domAttributes"],
          data: { highlighted },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 16,
            height: 16,
            color: highlighted
              ? "var(--tv-primary)"
              : "var(--tv-muted-foreground)",
          },
        };
      }),
    [activeSelected, model.relationships, neighborhood.highlightedEdgeIds],
  );

  const focusTable = (tableId: string) => {
    setSelection(tableId);
    const node = getNode(tableId);
    if (node) {
      setCenter(
        node.position.x + (node.width ?? 0) / 2,
        node.position.y + (node.height ?? 0) / 2,
        { zoom, duration: ERD_TRANSITION_MS },
      );
    }
    runAfterPaint(() => tableButtons.current.get(tableId)?.focus());
  };

  const fitSelectedTable = () => {
    if (!activeSelected) return;
    void fitView({
      nodes: [{ id: activeSelected }],
      padding: 0.4,
      maxZoom: 1.2,
      duration: ERD_TRANSITION_MS,
    });
  };

  if (model.tables.length === 0) {
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
              tables: model.tables.length,
              relationships: model.relationships.length,
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
              {searchMatches.length}/{model.tables.length}
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
            onClick={() => zoomOut({ duration: ERD_TRANSITION_MS })}
          >
            <ZoomOut />
          </Button>
          <span
            aria-label={t("zoomPercentAria")}
            className="w-10 text-center text-3xs tabular-nums text-muted-foreground"
          >
            {Math.round(zoom * 100)}%
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("zoomInAria")}
            title={t("zoomInTitle")}
            onClick={() => zoomIn({ duration: ERD_TRANSITION_MS })}
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
            onClick={() =>
              void fitView({ padding: 0.15, duration: ERD_TRANSITION_MS })
            }
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
            searchMatches.map((entry) => (
              <button
                key={entry.table.id}
                type="button"
                role="option"
                aria-selected={activeSelected === entry.table.id}
                onClick={() => focusTable(entry.table.id)}
                className="max-w-48 truncate rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:border-primary/60 aria-selected:border-primary aria-selected:bg-primary/10"
              >
                {entry.qualifiedName}
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

      {model.relationships.length === 0 && (
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
        className="relative min-h-0 flex-1 bg-background"
      >
        <ErdCanvasContext.Provider value={canvasView}>
          <ReactFlow<ErdTableFlowNode, ErdRelationshipFlowEdge>
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onPaneClick={() => setSelection(null)}
            nodesConnectable={false}
            elementsSelectable={false}
            // The card inside each node is the focusable control (it carries the
            // label and the pressed state), so React Flow's own node wrapper
            // must not add a second tab stop per table.
            nodesFocusable={false}
            edgesFocusable={false}
            minZoom={ERD_MIN_ZOOM}
            maxZoom={ERD_MAX_ZOOM}
          >
            <Background />
          </ReactFlow>
        </ErdCanvasContext.Provider>
      </div>

      {selectedTable && (
        <SchemaErdDependencyView
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

/**
 * FK edge. Stroke and marker colour are inline so they beat React Flow's own
 * `.react-flow__edge-path` rule regardless of stylesheet order.
 */
function SchemaErdRelationshipEdge({
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps<ErdRelationshipFlowEdge>) {
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const highlighted = data?.highlighted ?? true;

  return (
    <BaseEdge
      path={path}
      markerEnd={markerEnd}
      interactionWidth={0}
      style={{
        stroke: highlighted
          ? "var(--tv-primary)"
          : "var(--tv-muted-foreground)",
        strokeWidth: highlighted ? 2.5 : 1.5,
        opacity: highlighted ? 1 : 0.4,
      }}
    />
  );
}

function runAfterPaint(callback: () => void) {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(callback);
    return;
  }
  window.setTimeout(callback, 0);
}

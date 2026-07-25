import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Link2, Maximize2, Network } from "lucide-react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@components/ui/button";
import type { SchemaGraph } from "@/types/schemaGraph";
import { buildErdCanvasModel, type ErdTableNodeData } from "./erdCanvasModel";
import {
  ERD_NODE_WIDTH,
  ERD_TABLE_NODE_TYPE,
  layoutErdCanvasModel,
} from "./erdCanvasLayout";

// #1655 — ERD canvas foundation (ADR 0054). Replaces the hand-rolled SVG
// renderer with a React Flow canvas: read-only table nodes (columns listed),
// FK edges, elkjs `layered` auto-placement, built-in zoom/pan + fit-to-view.
// The foundation reads only `SchemaGraph`; the follow-up ERD slices (#1657+)
// add the selectors they actually consume when they land.

interface SchemaErdRendererProps {
  graph: SchemaGraph;
}

type ErdTableNode = Node<ErdTableNodeData, typeof ERD_TABLE_NODE_TYPE>;

function ErdTableNodeView({ data }: NodeProps<ErdTableNode>) {
  const { table, columns } = data;
  return (
    <div
      role="group"
      aria-label={`${table.schema}.${table.table} table`}
      className="flex flex-col overflow-hidden rounded border border-border bg-card text-left shadow-sm"
      style={{ width: ERD_NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <div className="border-b border-border bg-secondary px-3 py-2">
        <div className="truncate text-3xs uppercase text-muted-foreground">
          {table.schema}
        </div>
        <span className="truncate text-sm font-semibold text-foreground">
          {table.table}
        </span>
      </div>
      <ul className="flex flex-col py-1">
        {columns.map((column) => (
          <li
            key={column.id}
            className="grid grid-cols-[2.5rem_1fr] items-center gap-2 px-3 py-1 text-xs"
          >
            <span className="flex gap-1">
              {column.data.is_primary_key && (
                <span
                  aria-label="primary key"
                  className="flex items-center gap-0.5 rounded bg-primary/10 px-1 text-3xs font-semibold text-primary"
                >
                  <KeyRound size={9} aria-hidden="true" /> PK
                </span>
              )}
              {column.data.is_foreign_key && (
                <span
                  aria-label="foreign key"
                  className="flex items-center gap-0.5 rounded bg-accent px-1 text-3xs font-semibold text-accent-foreground"
                >
                  <Link2 size={9} aria-hidden="true" /> FK
                </span>
              )}
            </span>
            <span className="truncate text-foreground">{column.column}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
}

const NODE_TYPES: NodeTypes = { [ERD_TABLE_NODE_TYPE]: ErdTableNodeView };

export default function SchemaErdRenderer({ graph }: SchemaErdRendererProps) {
  return (
    <ReactFlowProvider>
      <SchemaErdCanvas graph={graph} />
    </ReactFlowProvider>
  );
}

function SchemaErdCanvas({ graph }: { graph: SchemaGraph }) {
  const { t } = useTranslation("schema");
  const { fitView } = useReactFlow();
  const model = useMemo(() => buildErdCanvasModel(graph), [graph]);
  const [nodes, setNodes] = useState<Node<ErdTableNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  useEffect(() => {
    let cancelled = false;
    void layoutErdCanvasModel(model).then((layout) => {
      if (cancelled) return;
      setNodes(layout.nodes);
      setEdges(layout.edges);
    });
    return () => {
      cancelled = true;
    };
  }, [model]);

  if (model.nodes.length === 0) {
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
              tables: model.nodes.length,
              relationships: model.edges.length,
            })}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("fitErdAria")}
          title={t("fitErdTitle")}
          onClick={() => void fitView({ duration: 200 })}
        >
          <Maximize2 />
        </Button>
      </div>
      <div
        role="figure"
        aria-label={t("databaseRelationshipDiagram")}
        className="relative flex-1 bg-background"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          fitView
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          minZoom={0.1}
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} showFitView={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import type { ErdCanvasModel, ErdTableNodeData } from "./erdCanvasModel";

// #1655 — ERD canvas foundation (ADR 0054). elkjs `layered` auto-placement:
// references point DOWN so a referenced (parent) table sits above the tables
// that reference it, with barycenter crossing minimisation. This is the sole
// placement authority — the fixed 3-column grid of the old renderer is gone.
// Worker offload / virtualization is deliberately out of scope (follow-up
// #1658), so we run the main-thread bundled build.

export const ERD_TABLE_NODE_TYPE = "erdTable";

export const ERD_NODE_WIDTH = 240;
const ERD_HEADER_HEIGHT = 52;
const ERD_ROW_HEIGHT = 26;

// A hidden module-level instance; `.layout()` is pure per call.
const elk = new ELK();

const LAYOUT_OPTIONS = {
  "elk.algorithm": "layered",
  "elk.direction": "DOWN",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
  "elk.spacing.nodeNode": "64",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
} as const;

export interface ErdCanvasLayout {
  readonly nodes: Node<ErdTableNodeData>[];
  readonly edges: Edge[];
}

export function erdNodeHeight(columnCount: number): number {
  return ERD_HEADER_HEIGHT + Math.max(1, columnCount) * ERD_ROW_HEIGHT;
}

export async function layoutErdCanvasModel(
  model: ErdCanvasModel,
): Promise<ErdCanvasLayout> {
  const graph: ElkNode = {
    id: "root",
    layoutOptions: { ...LAYOUT_OPTIONS },
    children: model.nodes.map((node) => ({
      id: node.id,
      width: ERD_NODE_WIDTH,
      height: erdNodeHeight(node.data.columns.length),
    })),
    // Feed elk the *referenced* table (FK target) as the layer source so it
    // ranks above the referencing table under `elk.direction: DOWN` — ADR 0054
    // "참조되는 테이블이 위층". The React Flow edge below keeps the real
    // source→target orientation for the arrow.
    edges: model.edges.map((edge) => ({
      id: edge.id,
      sources: [edge.target],
      targets: [edge.source],
    })),
  };

  const laidOut = await elk.layout(graph);
  const positionById = new Map(
    (laidOut.children ?? []).map((child) => [
      child.id,
      { x: child.x ?? 0, y: child.y ?? 0 },
    ]),
  );

  const nodes: Node<ErdTableNodeData>[] = model.nodes.map((node) => ({
    id: node.id,
    type: ERD_TABLE_NODE_TYPE,
    position: positionById.get(node.id) ?? { x: 0, y: 0 },
    data: node.data,
  }));

  const edges: Edge[] = model.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ariaLabel: edge.label,
    focusable: false,
  }));

  return { nodes, edges };
}

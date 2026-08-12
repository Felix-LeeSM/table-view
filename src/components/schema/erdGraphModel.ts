import { logger } from "@lib/logger";
import {
  VIRTUAL_FOREIGN_KEY_EDGE_KIND,
  virtualForeignKeyLabel,
} from "@lib/schemaGraphVirtualFk";
import type { ELK, ElkNode, LayoutOptions } from "elkjs/lib/elk-api";
import type {
  SchemaGraph,
  SchemaGraphColumnNode,
  SchemaGraphEdge,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

/**
 * Pure SchemaGraph -> ERD canvas model. Holds no React state and no rendering:
 * the canvas (`SchemaErdCanvas.tsx`) turns this into React Flow nodes/edges.
 *
 * Node geometry lives here because elkjs needs a concrete `width`/`height` per
 * node before it can lay anything out — the canvas cannot measure first.
 */

export const ERD_TABLE_WIDTH = 240;
export const ERD_TABLE_HEADER_HEIGHT = 52;
export const ERD_TABLE_ROW_HEIGHT = 26;
export const ERD_TABLE_BODY_PADDING = 10;

/** Number of distinct schema badge tones (`--color-erd-schema-*` in index.css). */
export const ERD_SCHEMA_TONE_COUNT = 4;

/** Vertical gap of the single-column fallback used when elkjs rejects. */
const ERD_FALLBACK_STACK_GAP = 48;

/**
 * ADR 0054 (2) semantic zoom, which retires the fixed six-column cap: far away
 * a card is the table box alone, mid-range it keeps the PK/FK columns, and up
 * close it draws every column.
 */
export type ErdDetailLevel = "compact" | "keys" | "full";

/**
 * Zoom at which a card starts drawing key columns, then every column. Column
 * rows are `text-xs` (12px), so under `ERD_DETAIL_ZOOM_KEYS` a column name
 * paints below ~5px and only the table name is worth the space.
 *
 * ponytail: fixed thresholds — the canvas has no per-user detail control to
 * hang them off. Turn them into state when one lands.
 */
export const ERD_DETAIL_ZOOM_KEYS = 0.45;
export const ERD_DETAIL_ZOOM_FULL = 0.75;

export function erdDetailLevel(zoom: number): ErdDetailLevel {
  // A viewport that has not been measured yet must not blank every card out,
  // so an unreadable zoom falls through to the level that hides nothing.
  if (!Number.isFinite(zoom)) return "full";
  if (zoom < ERD_DETAIL_ZOOM_KEYS) return "compact";
  if (zoom < ERD_DETAIL_ZOOM_FULL) return "keys";
  return "full";
}

export interface ErdTableModel {
  readonly table: SchemaGraphTableNode;
  readonly columns: readonly SchemaGraphColumnNode[];
  readonly qualifiedName: string;
  /** Index into the `--color-erd-schema-*` tones, assigned in `buildErdModel`. */
  readonly schemaToneIndex: number;
  readonly width: number;
  /**
   * The slot elkjs reserves for this table: the height of a card drawing every
   * column, which is the tallest any detail level makes it. Semantic zoom only
   * ever shrinks a card inside that slot, so changing zoom cannot change the
   * layout input — and therefore cannot re-run the layout and throw away the
   * positions a user dragged.
   */
  readonly layoutHeight: number;
}

/** What one card draws at a detail level, and how tall that makes it. */
export interface ErdCardShape {
  readonly visibleColumns: readonly SchemaGraphColumnNode[];
  readonly hiddenColumnCount: number;
  readonly height: number;
}

export function erdCardShape(
  table: ErdTableModel,
  level: ErdDetailLevel,
): ErdCardShape {
  const visibleColumns = columnsAtDetailLevel(table.columns, level);
  const hiddenColumnCount = table.columns.length - visibleColumns.length;
  return {
    visibleColumns,
    hiddenColumnCount,
    height: erdTableHeight(visibleColumns.length, hiddenColumnCount),
  };
}

function columnsAtDetailLevel(
  columns: readonly SchemaGraphColumnNode[],
  level: ErdDetailLevel,
): readonly SchemaGraphColumnNode[] {
  switch (level) {
    case "compact":
      return [];
    case "keys":
      return columns.filter(
        (column) => column.data.is_primary_key || column.data.is_foreign_key,
      );
    case "full":
      return columns;
  }
}

export interface ErdRelationshipModel {
  readonly edge: SchemaGraphEdge;
  /** Table holding the foreign key columns. */
  readonly sourceTableId: string;
  /** Table being referenced. elkjs puts this one in the layer above. */
  readonly targetTableId: string;
  readonly label: string;
}

export interface ErdModel {
  readonly tables: readonly ErdTableModel[];
  readonly relationships: readonly ErdRelationshipModel[];
}

export interface ErdPosition {
  readonly x: number;
  readonly y: number;
}

export function erdTableHeight(
  visibleColumnCount: number,
  hiddenColumnCount: number,
): number {
  const rows = visibleColumnCount + (hiddenColumnCount > 0 ? 1 : 0);
  return (
    ERD_TABLE_HEADER_HEIGHT +
    ERD_TABLE_BODY_PADDING +
    rows * ERD_TABLE_ROW_HEIGHT
  );
}

export function buildErdModel(graph: SchemaGraph): ErdModel {
  const columnsByTable = new Map<string, SchemaGraphColumnNode[]>();
  for (const node of graph.nodes) {
    if (node.kind !== "column") continue;
    const tableId = node.id.slice(0, node.id.lastIndexOf(".column:"));
    const columns = columnsByTable.get(tableId) ?? [];
    columns.push(node);
    columnsByTable.set(tableId, columns);
  }

  // Tones go by position in the sorted list of schemas the graph actually
  // holds, so up to ERD_SCHEMA_TONE_COUNT schemas always get distinct badges.
  // Hashing the name instead collided on ordinary names (`public`, `analytics`,
  // `main` and `app` all landed on the same tone).
  const schemaTones = new Map(
    [
      ...new Set(
        graph.nodes
          .filter((node): node is SchemaGraphTableNode => node.kind === "table")
          .map((table) => String(table.schema)),
      ),
    ]
      .sort()
      .map((schema, index) => [schema, index % ERD_SCHEMA_TONE_COUNT] as const),
  );

  const tables = graph.nodes
    .filter((node): node is SchemaGraphTableNode => node.kind === "table")
    .map((table) => {
      const columns = (columnsByTable.get(table.id) ?? [])
        .slice()
        .sort((left, right) => left.ordinal - right.ordinal);
      return {
        table,
        columns,
        qualifiedName: `${table.schema}.${table.table}`,
        schemaToneIndex: schemaTones.get(String(table.schema)) ?? 0,
        width: ERD_TABLE_WIDTH,
        layoutHeight: erdTableHeight(columns.length, 0),
      };
    });

  const tableIds = new Set(tables.map((entry) => entry.table.id));
  const relationships = graph.edges
    .filter((edge) => edge.kind === "foreign-key-table")
    .flatMap((edge) => {
      if (!tableIds.has(edge.from) || !tableIds.has(edge.to)) return [];
      return [
        {
          edge,
          sourceTableId: edge.from,
          targetTableId: edge.to,
          label: erdRelationshipLabel(edge),
        },
      ];
    });

  return { tables, relationships };
}

/**
 * Identity of the layout *input*, serialized straight off the graph handed to
 * elkjs so the trigger set and the input set cannot drift apart. Anything that
 * would make elkjs place a table differently — the table set, each card's size,
 * the hub priorities, and every FK edge with its endpoints and input order —
 * changes this string; nothing else does.
 *
 * Why it matters in both directions:
 *
 * - `SchemaErdPanel` fetches indexes and constraints per table after first
 *   paint, so a fresh `SchemaGraph` object keeps arriving for the same diagram.
 *   Those carry no layout input, so the fingerprint holds and a dragged layout
 *   survives. Edge *ids* are excluded for the same reason: an FK edge id embeds
 *   its constraint id, which flips from the synthetic placeholder to the real
 *   constraint name when `getTableConstraints` resolves.
 * - The panel also prefetches columns per schema after first paint, and columns
 *   decide card height. Leaving height out let a schema with no FKs at all keep
 *   its first-paint layout while every card grew, so the cards overlapped.
 */
export function erdModelFingerprint(model: ErdModel): string {
  const elkGraph = buildErdElkGraph(model);
  const nodes = (elkGraph.children ?? []).map(
    (child) =>
      `${child.id}@${child.width}x${child.height}p${child.layoutOptions?.["elk.priority"]}`,
  );
  const edges = (elkGraph.edges ?? []).map(
    (edge) => `${edge.sources.join(",")}>${edge.targets.join(",")}`,
  );
  return `nodes:[${nodes.join(" ")}] edges:[${edges.join(" ")}]`;
}

/**
 * ADR 0054 (1): `layered` with FK-direction rank, barycenter crossing
 * minimization (the LAYER_SWEEP default), and greedy cycle breaking so a
 * circular or self-referencing FK graph still lays out.
 *
 * `elk.direction: UP` is what puts the referenced table above the referencing
 * one: an FK edge runs source (holds the FK columns) -> target (is referenced),
 * and ELK places an edge's target in a later layer, which for UP is higher.
 */
export const ERD_ELK_LAYOUT_OPTIONS: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "UP",
  "elk.layered.cycleBreaking.strategy": "GREEDY",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.spacing.nodeNode": "56",
  "elk.layered.spacing.nodeNodeBetweenLayers": "96",
  "elk.spacing.edgeNode": "32",
  "elk.spacing.edgeEdge": "24",
  "elk.padding": "[top=40,left=40,bottom=40,right=40]",
};

/** FK in-degree per table — how many tables reference it. */
export function erdReferenceCounts(
  model: ErdModel,
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const table of model.tables) counts.set(table.table.id, 0);
  for (const relationship of model.relationships) {
    counts.set(
      relationship.targetTableId,
      (counts.get(relationship.targetTableId) ?? 0) + 1,
    );
  }
  return counts;
}

/**
 * ADR 0054 (1) hub priority: the most-referenced tables are handed to elkjs
 * first and carry `elk.priority`, so the in-layer sweep settles them before the
 * leaf tables that hang off them.
 */
export function buildErdElkGraph(model: ErdModel): ElkNode {
  const referenceCounts = erdReferenceCounts(model);
  const children = model.tables
    .slice()
    .sort((left, right) => {
      const delta =
        (referenceCounts.get(right.table.id) ?? 0) -
        (referenceCounts.get(left.table.id) ?? 0);
      return delta !== 0 ? delta : left.table.id.localeCompare(right.table.id);
    })
    .map((entry) => ({
      id: entry.table.id,
      width: entry.width,
      height: entry.layoutHeight,
      layoutOptions: {
        "elk.priority": String(referenceCounts.get(entry.table.id) ?? 0),
      },
    }));

  return {
    id: "erd-root",
    layoutOptions: ERD_ELK_LAYOUT_OPTIONS,
    children,
    edges: model.relationships.map((relationship) => ({
      id: relationship.edge.id,
      sources: [relationship.sourceTableId],
      targets: [relationship.targetTableId],
    })),
  };
}

/**
 * `elk.bundled.js` is a ~1.6 MB GWT build, so it is imported dynamically: Vite
 * gives it its own chunk and the app only pays for it when someone opens an
 * ERD. One instance, created on first use and reused after.
 *
 * ponytail: main thread. ADR 0054 (3) moves layout into a web worker together
 * with viewport virtualization; both are out of scope for #1655, and the
 * bundled build is what makes this module testable under jsdom.
 */
let elkPromise: Promise<ELK> | null = null;

function getElk(): Promise<ELK> {
  if (!elkPromise) {
    elkPromise = import("elkjs/lib/elk.bundled.js").then(
      (module) => new module.default(),
    );
  }
  return elkPromise;
}

export async function layoutErdModel(
  model: ErdModel,
): Promise<ReadonlyMap<string, ErdPosition>> {
  const positions = new Map<string, ErdPosition>();
  if (model.tables.length === 0) return positions;

  try {
    const elk = await getElk();
    const laidOut = await elk.layout(buildErdElkGraph(model));
    for (const child of laidOut.children ?? []) {
      positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
    }
    return positions;
  } catch (error) {
    // A rejected layout must not leave the canvas blank with no explanation —
    // the caller only paints nodes once this resolves. Fall back to a readable
    // single column so every table is still reachable.
    logger.error("[erd] elkjs layout failed, falling back to a column:", error);
    return stackErdTables(model);
  }
}

function stackErdTables(model: ErdModel): ReadonlyMap<string, ErdPosition> {
  const positions = new Map<string, ErdPosition>();
  let y = 0;
  for (const entry of model.tables) {
    positions.set(entry.table.id, { x: 0, y });
    y += entry.layoutHeight + ERD_FALLBACK_STACK_GAP;
  }
  return positions;
}

export function buildErdNeighborhood(
  relationships: readonly ErdRelationshipModel[],
  selectedTableId: string | null | undefined,
): {
  highlightedEdgeIds: ReadonlySet<string>;
  relatedTableIds: ReadonlySet<string>;
} {
  const highlightedEdgeIds = new Set<string>();
  const relatedTableIds = new Set<string>();
  if (!selectedTableId) return { highlightedEdgeIds, relatedTableIds };

  for (const relationship of relationships) {
    if (
      relationship.sourceTableId !== selectedTableId &&
      relationship.targetTableId !== selectedTableId
    ) {
      continue;
    }
    highlightedEdgeIds.add(relationship.edge.id);
    relatedTableIds.add(relationship.sourceTableId);
    relatedTableIds.add(relationship.targetTableId);
  }

  return { highlightedEdgeIds, relatedTableIds };
}

export function filterErdTables(
  tables: readonly ErdTableModel[],
  rawTerm: string,
): readonly ErdTableModel[] {
  const term = rawTerm.trim().toLocaleLowerCase();
  if (!term) return tables;
  return tables.filter((entry) =>
    entry.qualifiedName.toLocaleLowerCase().includes(term),
  );
}

export function erdRelationshipLabel(edge: SchemaGraphEdge): string {
  const relationship = edge.foreignKey;
  if (!relationship) return `${edge.from} references ${edge.to}`;
  return `${relationship.source.schema}.${relationship.source.table}.${relationship.source.columns.join(
    ", ",
  )} references ${relationship.target.schema}.${relationship.target.table}.${relationship.target.columns.join(
    ", ",
  )}`;
}

/**
 * Hand-drawn links (#2150) as canvas relationships, one per target so a
 * polymorphic link fans out of its single source table (ADR 0055).
 *
 * Deliberately not part of `ErdModel`: `buildErdElkGraph` and
 * `erdModelFingerprint` read that, so feeding a hand-drawn link into it would
 * re-run the whole layout and discard the positions the user dragged — the
 * implicit re-layout ADR 0056 (2) forbids.
 */
export function erdVirtualRelationships(
  graph: SchemaGraph,
  tablesById: ReadonlyMap<string, ErdTableModel>,
): readonly ErdRelationshipModel[] {
  return graph.edges.flatMap((edge) => {
    if (edge.kind !== VIRTUAL_FOREIGN_KEY_EDGE_KIND) return [];
    if (!tablesById.has(edge.from) || !tablesById.has(edge.to)) return [];
    return [
      {
        edge,
        sourceTableId: edge.from,
        targetTableId: edge.to,
        label: edge.virtualForeignKey
          ? virtualForeignKeyLabel(edge.virtualForeignKey)
          : erdRelationshipLabel(edge),
      },
    ];
  });
}

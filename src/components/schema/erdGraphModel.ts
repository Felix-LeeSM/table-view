import { logger } from "@lib/logger";
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
/**
 * Columns rendered per table node. ADR 0054 (2) retires this cap in favour of
 * 3-step semantic zoom, which issue #1655 lists as out of scope — the cap stays
 * until the semantic-zoom issue lands and replaces it.
 */
export const ERD_MAX_VISIBLE_COLUMNS = 6;

/** Number of distinct schema badge tones (`--color-erd-schema-*` in index.css). */
export const ERD_SCHEMA_TONE_COUNT = 4;

/** Vertical gap of the single-column fallback used when elkjs rejects. */
const ERD_FALLBACK_STACK_GAP = 48;

export interface ErdTableModel {
  readonly table: SchemaGraphTableNode;
  readonly columns: readonly SchemaGraphColumnNode[];
  readonly visibleColumns: readonly SchemaGraphColumnNode[];
  readonly hiddenColumnCount: number;
  /**
   * Column names an FK edge anchors to on this table, sorted. The card renders
   * a handle pair for each so an edge always has an endpoint to land on, even
   * for a column the card is not currently drawing.
   */
  readonly anchorColumns: readonly string[];
  readonly qualifiedName: string;
  /** Index into the `--color-erd-schema-*` tones, assigned in `buildErdModel`. */
  readonly schemaToneIndex: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How many rows each end of a relationship may hold. Both ends pinned to a
 * single row reads 1:1, one end reads 1:N, neither reads N:M. "Pinned" means
 * the FK's columns on that side cover a unique index (`IndexInfo.is_unique`)
 * or the primary key.
 */
export type ErdCardinality = "1:1" | "1:N" | "N:M";

export interface ErdRelationshipModel {
  readonly edge: SchemaGraphEdge;
  /** Table holding the foreign key columns. */
  readonly sourceTableId: string;
  /** Table being referenced. elkjs puts this one in the layer above. */
  readonly targetTableId: string;
  readonly label: string;
  /**
   * Column the edge leaves from / lands on. `null` when the FK names none, and
   * only the first column of a composite FK is used.
   *
   * ponytail: one anchor per end. A composite FK draws a single edge today, so
   * a second anchor would need a second edge before it could show anything.
   */
  readonly sourceColumn: string | null;
  readonly targetColumn: string | null;
  readonly cardinality: ErdCardinality;
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

/** React Flow handle id for the FK anchor on one column row of a table card. */
export function erdColumnHandleId(
  role: "source" | "target",
  column: string,
): string {
  return `erd-${role}:${column}`;
}

/**
 * Card-edge handles, used by a relationship that names no column. Naming them
 * is what keeps that fallback from meaning "whichever handle React Flow found
 * first in the card" — an unnamed handle resolves by DOM order, so inserting
 * anything above these two would silently move the fallback to a column row.
 */
export const ERD_TABLE_SOURCE_HANDLE_ID = "erd-source-table";
export const ERD_TABLE_TARGET_HANDLE_ID = "erd-target-table";

/** First column of each FK end, which is what an edge anchors to. */
function erdEdgeAnchors(edge: SchemaGraphEdge): {
  sourceColumn: string | null;
  targetColumn: string | null;
} {
  return {
    sourceColumn:
      edge.columns?.[0] ?? edge.foreignKey?.source.columns[0] ?? null,
    targetColumn:
      edge.referenceColumns?.[0] ?? edge.foreignKey?.target.columns[0] ?? null,
  };
}

/**
 * Column sets that identify at most one row per table: every `is_unique` index
 * plus the primary key. A unique index on `(a)` also pins `(a, b)`, while one
 * on `(a, b)` does not pin `(a)` — so membership is a subset test, not equality.
 */
function erdUniqueColumnSets(
  graph: SchemaGraph,
  columnsByTable: ReadonlyMap<string, readonly SchemaGraphColumnNode[]>,
): ReadonlyMap<string, readonly (readonly string[])[]> {
  const sets = new Map<string, (readonly string[])[]>();
  const add = (tableId: string, columns: readonly string[]) => {
    if (columns.length === 0) return;
    const existing = sets.get(tableId);
    if (existing) existing.push(columns);
    else sets.set(tableId, [columns]);
  };

  for (const [tableId, columns] of columnsByTable) {
    add(
      tableId,
      columns
        .filter((column) => column.data.is_primary_key)
        .map((column) => column.column),
    );
  }
  for (const node of graph.nodes) {
    if (node.kind !== "index" || !node.data.is_unique) continue;
    add(node.id.slice(0, node.id.lastIndexOf(".index:")), node.data.columns);
  }
  return sets;
}

function erdEndIsUnique(
  uniqueSets: readonly (readonly string[])[] | undefined,
  columns: readonly string[],
): boolean {
  if (!uniqueSets || columns.length === 0) return false;
  const held = new Set(columns);
  return uniqueSets.some((unique) =>
    unique.every((column) => held.has(column)),
  );
}

/**
 * Counts the ends a single row is pinned on. The referenced end is pinned in
 * any well-formed schema (an FK points at a key), so 1:N is the ordinary answer
 * and 1:1 means the referencing columns are unique too. N:M is what is left
 * when neither end is known to be unique — an FK inferred onto a column that
 * carries no key, or a source whose index metadata has not arrived yet.
 */
function erdEdgeCardinality(
  edge: SchemaGraphEdge,
  uniqueColumnSets: ReadonlyMap<string, readonly (readonly string[])[]>,
): ErdCardinality {
  const pinnedEnds =
    (erdEndIsUnique(
      uniqueColumnSets.get(edge.from),
      edge.columns ?? edge.foreignKey?.source.columns ?? [],
    )
      ? 1
      : 0) +
    (erdEndIsUnique(
      uniqueColumnSets.get(edge.to),
      edge.referenceColumns ?? edge.foreignKey?.target.columns ?? [],
    )
      ? 1
      : 0);
  if (pinnedEnds === 2) return "1:1";
  return pinnedEnds === 1 ? "1:N" : "N:M";
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

  // Anchors come off the raw edges rather than off `relationships` below,
  // because a card must carry the handle before its edge is filtered for a
  // missing endpoint table — an anchor nobody uses costs one hidden span.
  const anchorsByTable = new Map<string, Set<string>>();
  const addAnchor = (tableId: string, column: string | null) => {
    if (!column) return;
    const existing = anchorsByTable.get(tableId);
    if (existing) existing.add(column);
    else anchorsByTable.set(tableId, new Set([column]));
  };
  for (const edge of graph.edges) {
    if (edge.kind !== "foreign-key-table") continue;
    const anchors = erdEdgeAnchors(edge);
    addAnchor(edge.from, anchors.sourceColumn);
    addAnchor(edge.to, anchors.targetColumn);
  }
  const uniqueColumnSets = erdUniqueColumnSets(graph, columnsByTable);

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
      const visibleColumns = columns.slice(0, ERD_MAX_VISIBLE_COLUMNS);
      const hiddenColumnCount = columns.length - visibleColumns.length;
      return {
        table,
        columns,
        visibleColumns,
        hiddenColumnCount,
        anchorColumns: [...(anchorsByTable.get(table.id) ?? [])].sort(),
        qualifiedName: `${table.schema}.${table.table}`,
        schemaToneIndex: schemaTones.get(String(table.schema)) ?? 0,
        width: ERD_TABLE_WIDTH,
        height: erdTableHeight(visibleColumns.length, hiddenColumnCount),
      };
    });

  const tableIds = new Set(tables.map((entry) => entry.table.id));
  const relationships = graph.edges
    .filter((edge) => edge.kind === "foreign-key-table")
    .flatMap((edge) => {
      if (!tableIds.has(edge.from) || !tableIds.has(edge.to)) return [];
      const { sourceColumn, targetColumn } = erdEdgeAnchors(edge);
      return [
        {
          edge,
          sourceTableId: edge.from,
          targetTableId: edge.to,
          label: erdRelationshipLabel(edge),
          sourceColumn,
          targetColumn,
          cardinality: erdEdgeCardinality(edge, uniqueColumnSets),
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
      height: entry.height,
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
    y += entry.height + ERD_FALLBACK_STACK_GAP;
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

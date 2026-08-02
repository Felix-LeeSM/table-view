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

export interface ErdTableModel {
  readonly table: SchemaGraphTableNode;
  readonly columns: readonly SchemaGraphColumnNode[];
  readonly visibleColumns: readonly SchemaGraphColumnNode[];
  readonly hiddenColumnCount: number;
  readonly qualifiedName: string;
  readonly width: number;
  readonly height: number;
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
        qualifiedName: `${table.schema}.${table.table}`,
        width: ERD_TABLE_WIDTH,
        height: erdTableHeight(visibleColumns.length, hiddenColumnCount),
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
 * Identity of the layout *input*. `SchemaErdPanel` keeps fetching indexes and
 * constraints after first paint, so a fresh `SchemaGraph` object arrives many
 * times for the same diagram; re-running elkjs on each one would throw away
 * every node the user dragged.
 *
 * Only what elkjs actually consumes counts: the table set and the set of
 * directed table pairs. Edge *ids* deliberately do not — an FK edge id embeds
 * its constraint id, and that flips from the synthetic placeholder to the real
 * constraint name the moment `getTableConstraints` resolves, while the diagram
 * itself is unchanged.
 */
export function erdModelFingerprint(model: ErdModel): string {
  const tables = model.tables
    .map((entry) => entry.table.id)
    .sort()
    .join(" ");
  const edges = [
    ...new Set(
      model.relationships.map(
        (relationship) =>
          `${relationship.sourceTableId}>${relationship.targetTableId}`,
      ),
    ),
  ]
    .sort()
    .join(" ");
  return `tables:${tables} edges:${edges}`;
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

  const elk = await getElk();
  const laidOut = await elk.layout(buildErdElkGraph(model));
  for (const child of laidOut.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
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

/**
 * Deterministic badge tone for a schema on the flat multi-schema canvas
 * (ADR 0054 (4)). The badge always prints the schema name too — colour is never
 * the only encoding.
 */
export function erdSchemaToneIndex(schema: string): number {
  let hash = 0;
  for (let index = 0; index < schema.length; index += 1) {
    hash = (hash * 31 + schema.charCodeAt(index)) % 0xffffffff;
  }
  return hash % ERD_SCHEMA_TONE_COUNT;
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

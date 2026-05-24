import type {
  SchemaGraph,
  SchemaGraphColumnNode,
  SchemaGraphEdge,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";

export interface ErdTableLayout {
  table: SchemaGraphTableNode;
  columns: readonly SchemaGraphColumnNode[];
  x: number;
  y: number;
}

export interface ErdRelationshipLayout {
  edge: SchemaGraphEdge;
  from: ErdTableLayout;
  to: ErdTableLayout;
  label: string;
}

export const TABLE_WIDTH = 240;
export const TABLE_HEIGHT = 214;
export const TABLE_GAP_X = 116;
export const TABLE_GAP_Y = 52;
export const TABLES_PER_ROW = 3;
export const MAX_RENDERED_COLUMNS = 6;

export function buildErdLayout(graph: SchemaGraph): {
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

export function relationshipPath(
  from: ErdTableLayout,
  to: ErdTableLayout,
): string {
  const sourceX = from.x < to.x ? from.x + TABLE_WIDTH : from.x;
  const targetX = from.x < to.x ? to.x : to.x + TABLE_WIDTH;
  const sourceY = from.y + TABLE_HEIGHT / 2;
  const targetY = to.y + TABLE_HEIGHT / 2;
  const curve = Math.max(72, Math.abs(targetX - sourceX) / 2);
  const sourceCurveX = sourceX + (from.x < to.x ? curve : -curve);
  const targetCurveX = targetX + (from.x < to.x ? -curve : curve);

  return `M ${sourceX} ${sourceY} C ${sourceCurveX} ${sourceY}, ${targetCurveX} ${targetY}, ${targetX} ${targetY}`;
}

export function buildSelectedNeighborhood(
  relationships: readonly ErdRelationshipLayout[],
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
      relationship.from.table.id !== selectedTableId &&
      relationship.to.table.id !== selectedTableId
    ) {
      continue;
    }
    highlightedEdgeIds.add(relationship.edge.id);
    relatedTableIds.add(relationship.from.table.id);
    relatedTableIds.add(relationship.to.table.id);
  }

  return { highlightedEdgeIds, relatedTableIds };
}

export function filterTables(
  tables: readonly ErdTableLayout[],
  rawTerm: string,
): readonly ErdTableLayout[] {
  const term = rawTerm.trim().toLocaleLowerCase();
  if (!term) return tables;
  return tables.filter(({ table }) =>
    `${table.schema}.${table.table}`.toLocaleLowerCase().includes(term),
  );
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

import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphDiagnostic,
  SchemaGraphEdge,
  SchemaGraphForeignKeyRelationship,
  SchemaGraphIndexNode,
  SchemaGraphSchemaNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { extractSchemaGraph } from "./schemaGraph";
import {
  compareText,
  schemaGraphColumnId,
  schemaGraphTableId,
} from "./schemaGraphSupport";
export {
  selectSchemaGraphMigrationImpact,
  type SchemaGraphMigrationImpactSummary,
  type SchemaGraphMigrationRemovalTarget,
} from "./schemaGraphMigrationImpact";
// #1370 — selector types live in the leaf module so migrationImpact can import
// them without a cross-import back into this value-bearing facade. Re-exported
// here for back-compat (many consumers import these off schemaGraphSelectors).
import type {
  SchemaGraphForeignKeySelection,
  SchemaGraphForeignKeySelectors,
  SchemaGraphIntelligenceSelectors,
  SchemaGraphMetadataField,
  SchemaGraphMetadataFieldState,
  SchemaGraphMetadataStatus,
  SchemaGraphNodeMaps,
  SchemaGraphTableMetadataReadiness,
} from "./schemaGraphSelectorTypes";
export type {
  SchemaGraphForeignKeySelection,
  SchemaGraphForeignKeySelectors,
  SchemaGraphIntelligenceSelectors,
  SchemaGraphMetadataField,
  SchemaGraphMetadataFieldState,
  SchemaGraphMetadataStatus,
  SchemaGraphNodeMaps,
  SchemaGraphTableForeignKeys,
  SchemaGraphTableMetadataReadiness,
} from "./schemaGraphSelectorTypes";

type SchemaGraphSelectorInput = SchemaGraph | SchemaGraphCatalogSnapshot;

export function selectSchemaGraphIntelligence(
  input: SchemaGraphSelectorInput,
): SchemaGraphIntelligenceSelectors {
  const graph = toSchemaGraph(input);
  const nodeMaps = selectSchemaGraphNodeMaps(graph);
  const diagnosticsBySubjectId = collectDiagnosticsBySubjectId(graph);
  const foreignKeySelectors = selectSchemaGraphForeignKeys(graph, nodeMaps);
  const metadataReadinessByTableId = isCatalogSnapshot(input)
    ? selectSnapshotMetadataReadiness(
        input,
        nodeMaps.tablesById,
        diagnosticsBySubjectId,
      )
    : selectGraphMetadataReadiness(nodeMaps.tablesById, diagnosticsBySubjectId);

  return {
    graph,
    ...nodeMaps,
    diagnostics: graph.diagnostics,
    diagnosticsBySubjectId,
    ...foreignKeySelectors,
    metadataReadinessByTableId,
  };
}

export function selectSchemaGraphNodeMaps(
  input: SchemaGraphSelectorInput,
): SchemaGraphNodeMaps {
  const graph = toSchemaGraph(input);
  const schemasById = new Map<string, SchemaGraphSchemaNode>();
  const tablesById = new Map<string, SchemaGraphTableNode>();
  const columnsById = new Map<string, SchemaGraphColumnNode>();
  const indexesById = new Map<string, SchemaGraphIndexNode>();
  const constraintsById = new Map<string, SchemaGraphConstraintNode>();
  const columnsByTableId = new Map<string, SchemaGraphColumnNode[]>();
  const indexesByTableId = new Map<string, SchemaGraphIndexNode[]>();
  const constraintsByTableId = new Map<string, SchemaGraphConstraintNode[]>();

  for (const node of graph.nodes) {
    switch (node.kind) {
      case "schema":
        schemasById.set(node.id, node);
        break;
      case "table":
        tablesById.set(node.id, node);
        break;
      case "column":
        columnsById.set(node.id, node);
        pushTableNode(columnsByTableId, node, node);
        break;
      case "index":
        indexesById.set(node.id, node);
        pushTableNode(indexesByTableId, node, node);
        break;
      case "constraint":
        constraintsById.set(node.id, node);
        pushTableNode(constraintsByTableId, node, node);
        break;
    }
  }

  return {
    schemasById,
    tablesById,
    columnsById,
    indexesById,
    constraintsById,
    columnsByTableId: sortTableNodeMap(columnsByTableId),
    indexesByTableId: sortTableNodeMap(indexesByTableId),
    constraintsByTableId: sortTableNodeMap(constraintsByTableId),
  };
}

export function selectSchemaGraphForeignKeys(
  input: SchemaGraphSelectorInput,
  nodeMaps?: SchemaGraphNodeMaps,
): SchemaGraphForeignKeySelectors {
  const graph = toSchemaGraph(input);
  const resolvedNodeMaps = nodeMaps ?? selectSchemaGraphNodeMaps(graph);
  const byTable = new Map<string, MutableTableForeignKeys>();
  for (const tableId of resolvedNodeMaps.tablesById.keys()) {
    byTable.set(tableId, {
      tableId,
      incomingForeignKeys: [],
      outgoingForeignKeys: [],
    });
  }

  const foreignKeys = graph.edges
    .filter(isForeignKeyTableEdge)
    .map(edgeToForeignKeySelection)
    .sort((left, right) => compareText(left.edgeId, right.edgeId));
  const byConstraint = new Map<string, SchemaGraphForeignKeySelection>();

  for (const foreignKey of foreignKeys) {
    byConstraint.set(foreignKey.constraintId, foreignKey);
    byTable.get(foreignKey.sourceTableId)?.outgoingForeignKeys.push(foreignKey);
    byTable.get(foreignKey.targetTableId)?.incomingForeignKeys.push(foreignKey);
  }

  return {
    foreignKeys,
    foreignKeysByConstraintId: byConstraint,
    foreignKeysByTableId: new Map(
      [...byTable.entries()].map(([tableId, relationships]) => [
        tableId,
        {
          tableId,
          incomingForeignKeys: sortForeignKeys(
            relationships.incomingForeignKeys,
          ),
          outgoingForeignKeys: sortForeignKeys(
            relationships.outgoingForeignKeys,
          ),
        },
      ]),
    ),
  };
}

function toSchemaGraph(input: SchemaGraphSelectorInput): SchemaGraph {
  return isCatalogSnapshot(input) ? extractSchemaGraph(input) : input;
}

function pushTableNode<
  Node extends
    | SchemaGraphColumnNode
    | SchemaGraphIndexNode
    | SchemaGraphConstraintNode,
>(
  nodesByTableId: Map<string, Node[]>,
  tableRef: Pick<Node, "schema" | "table">,
  node: Node,
) {
  const tableId = schemaGraphTableId(tableRef.schema, tableRef.table);
  const nodes = nodesByTableId.get(tableId) ?? [];
  nodes.push(node);
  nodesByTableId.set(tableId, nodes);
}

function sortTableNodeMap<
  Node extends
    | SchemaGraphColumnNode
    | SchemaGraphIndexNode
    | SchemaGraphConstraintNode,
>(nodesByTableId: Map<string, Node[]>): ReadonlyMap<string, readonly Node[]> {
  return new Map(
    [...nodesByTableId.entries()].map(([tableId, nodes]) => [
      tableId,
      [...nodes].sort((left, right) => compareText(left.id, right.id)),
    ]),
  );
}

function isCatalogSnapshot(
  input: SchemaGraphSelectorInput,
): input is SchemaGraphCatalogSnapshot {
  return "tablesBySchema" in input;
}

function collectDiagnosticsBySubjectId(
  graph: SchemaGraph,
): ReadonlyMap<string, readonly SchemaGraphDiagnostic[]> {
  const diagnosticsBySubjectId = new Map<string, SchemaGraphDiagnostic[]>();
  for (const diagnostic of graph.diagnostics) {
    const diagnostics = diagnosticsBySubjectId.get(diagnostic.subjectId) ?? [];
    diagnostics.push(diagnostic);
    diagnosticsBySubjectId.set(diagnostic.subjectId, diagnostics);
  }
  return new Map(
    [...diagnosticsBySubjectId.entries()].map(([subjectId, diagnostics]) => [
      subjectId,
      sortDiagnostics(diagnostics),
    ]),
  );
}

interface MutableTableForeignKeys {
  readonly tableId: string;
  readonly incomingForeignKeys: SchemaGraphForeignKeySelection[];
  readonly outgoingForeignKeys: SchemaGraphForeignKeySelection[];
}

function isForeignKeyTableEdge(
  edge: SchemaGraphEdge,
): edge is SchemaGraphEdge & {
  readonly constraintId: string;
  readonly foreignKey: SchemaGraphForeignKeyRelationship;
} {
  return (
    edge.kind === "foreign-key-table" &&
    Boolean(edge.constraintId) &&
    Boolean(edge.foreignKey)
  );
}

function edgeToForeignKeySelection(
  edge: SchemaGraphEdge & {
    readonly constraintId: string;
    readonly foreignKey: SchemaGraphForeignKeyRelationship;
  },
): SchemaGraphForeignKeySelection {
  const { foreignKey } = edge;
  return {
    edgeId: edge.id,
    constraintId: edge.constraintId,
    relationship: foreignKey,
    sourceTableId: edge.from,
    targetTableId: edge.to,
    sourceColumnIds: foreignKey.source.columns.map((column) =>
      schemaGraphColumnId(
        foreignKey.source.schema,
        foreignKey.source.table,
        column,
      ),
    ),
    targetColumnIds: foreignKey.target.columns.map((column) =>
      schemaGraphColumnId(
        foreignKey.target.schema,
        foreignKey.target.table,
        column,
      ),
    ),
  };
}

function sortForeignKeys(
  foreignKeys: readonly SchemaGraphForeignKeySelection[],
): readonly SchemaGraphForeignKeySelection[] {
  return [...foreignKeys].sort((left, right) =>
    compareText(left.edgeId, right.edgeId),
  );
}

function selectSnapshotMetadataReadiness(
  snapshot: SchemaGraphCatalogSnapshot,
  tablesById: ReadonlyMap<string, SchemaGraphTableNode>,
  diagnosticsBySubjectId: ReadonlyMap<string, readonly SchemaGraphDiagnostic[]>,
): ReadonlyMap<string, SchemaGraphTableMetadataReadiness> {
  return new Map(
    [...tablesById.values()].map((tableNode) => {
      const columns = metadataFieldState(
        hasTableMetadata(snapshot.columnsByTable, tableNode),
      );
      const indexes = metadataFieldState(
        hasTableMetadata(snapshot.indexesByTable, tableNode),
      );
      const constraints = metadataFieldState(
        hasTableMetadata(snapshot.constraintsByTable, tableNode),
      );
      const missing = missingMetadataFields({ columns, indexes, constraints });

      return [
        tableNode.id,
        {
          tableId: tableNode.id,
          schema: tableNode.schema,
          table: tableNode.table,
          source: "catalog-snapshot" as const,
          status: metadataStatus(missing, columns),
          ready: missing.length === 0,
          columns,
          indexes,
          constraints,
          missing,
          diagnostics: diagnosticsForTable(
            tableNode.id,
            diagnosticsBySubjectId,
          ),
        },
      ];
    }),
  );
}

function selectGraphMetadataReadiness(
  tablesById: ReadonlyMap<string, SchemaGraphTableNode>,
  diagnosticsBySubjectId: ReadonlyMap<string, readonly SchemaGraphDiagnostic[]>,
): ReadonlyMap<string, SchemaGraphTableMetadataReadiness> {
  return new Map(
    [...tablesById.values()].map((tableNode) => [
      tableNode.id,
      {
        tableId: tableNode.id,
        schema: tableNode.schema,
        table: tableNode.table,
        source: "schema-graph" as const,
        status: "unknown" as const,
        ready: false,
        columns: "unknown" as const,
        indexes: "unknown" as const,
        constraints: "unknown" as const,
        missing: [],
        diagnostics: diagnosticsForTable(tableNode.id, diagnosticsBySubjectId),
      },
    ]),
  );
}

function hasTableMetadata<T>(
  bySchema:
    | Readonly<Record<string, Readonly<Record<string, readonly T[]>>>>
    | undefined,
  tableNode: SchemaGraphTableNode,
): boolean {
  const tables = bySchema?.[tableNode.schema];
  return Boolean(
    tables && Object.prototype.hasOwnProperty.call(tables, tableNode.table),
  );
}

function metadataFieldState(
  available: boolean,
): Extract<SchemaGraphMetadataFieldState, "available" | "missing"> {
  return available ? "available" : "missing";
}

function missingMetadataFields({
  columns,
  indexes,
  constraints,
}: Pick<
  SchemaGraphTableMetadataReadiness,
  "columns" | "indexes" | "constraints"
>): readonly SchemaGraphMetadataField[] {
  return [
    ["columns", columns],
    ["indexes", indexes],
    ["constraints", constraints],
  ]
    .filter(([, state]) => state === "missing")
    .map(([field]) => field as SchemaGraphMetadataField);
}

function metadataStatus(
  missing: readonly SchemaGraphMetadataField[],
  columns: SchemaGraphMetadataFieldState,
): Exclude<SchemaGraphMetadataStatus, "unknown"> {
  if (missing.length === 0) return "ready";
  return columns === "missing" ? "missing" : "partial";
}

function diagnosticsForTable(
  tableId: string,
  diagnosticsBySubjectId: ReadonlyMap<string, readonly SchemaGraphDiagnostic[]>,
): readonly SchemaGraphDiagnostic[] {
  return sortDiagnostics(
    [...diagnosticsBySubjectId.entries()]
      .filter(
        ([subjectId]) =>
          subjectId === tableId || subjectId.startsWith(`${tableId}.`),
      )
      .flatMap(([, diagnostics]) => diagnostics),
  );
}

function sortDiagnostics(
  diagnostics: readonly SchemaGraphDiagnostic[],
): readonly SchemaGraphDiagnostic[] {
  return [...diagnostics].sort((left, right) => compareText(left.id, right.id));
}

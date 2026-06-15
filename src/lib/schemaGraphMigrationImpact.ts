import type {
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphDiagnostic,
  SchemaGraphIndexNode,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { compareText, schemaGraphTableId } from "./schemaGraphSupport";
import type {
  SchemaGraphForeignKeySelection,
  SchemaGraphIntelligenceSelectors,
  SchemaGraphTableMetadataReadiness,
} from "./schemaGraphSelectors";

export type SchemaGraphMigrationRemovalTarget =
  | { readonly kind: "table"; readonly tableId: string }
  | { readonly kind: "column"; readonly columnId: string }
  | { readonly kind: "constraint"; readonly constraintId: string }
  | { readonly kind: "index"; readonly indexId: string };

export interface SchemaGraphMigrationImpactSummary {
  readonly targetFound: boolean;
  readonly target: {
    readonly kind: SchemaGraphMigrationRemovalTarget["kind"];
    readonly id: string;
    readonly label: string;
  };
  readonly targetLabel: string;
  readonly affectedTables: readonly SchemaGraphTableNode[];
  readonly affectedColumns: readonly SchemaGraphColumnNode[];
  readonly affectedIndexes: readonly SchemaGraphIndexNode[];
  readonly affectedConstraints: readonly SchemaGraphConstraintNode[];
  readonly foreignKeys: readonly SchemaGraphForeignKeySelection[];
  readonly metadataReadiness: readonly SchemaGraphTableMetadataReadiness[];
  readonly diagnostics: readonly SchemaGraphDiagnostic[];
}

type SchemaGraphMigrationTargetNode =
  | SchemaGraphTableNode
  | SchemaGraphColumnNode
  | SchemaGraphConstraintNode
  | SchemaGraphIndexNode;

export function selectSchemaGraphMigrationImpact(
  selectors: SchemaGraphIntelligenceSelectors,
  target: SchemaGraphMigrationRemovalTarget,
): SchemaGraphMigrationImpactSummary {
  const id = migrationRemovalTargetId(target);
  const node = migrationRemovalTargetNode(selectors, target) ?? null;
  const targetSummary = {
    kind: target.kind,
    id,
    label: node ? migrationTargetLabel(node) : id,
  };
  const impact = {
    tableIds: new Set<string>(),
    columnIds: new Set<string>(),
    indexIds: new Set<string>(),
    constraintIds: new Set<string>(),
    foreignKeyConstraintIds: new Set<string>(),
  };
  const linkedColumns = (
    kind: "constraint-column" | "index-column",
    fromId: string,
  ) =>
    selectors.graph.edges
      .filter((edge) => edge.kind === kind && edge.from === fromId)
      .map((edge) => edge.to)
      .sort(compareText);
  const addTable = (tableId: string) => {
    if (selectors.tablesById.has(tableId)) impact.tableIds.add(tableId);
  };
  const addColumn = (columnId: string) => {
    const column = selectors.columnsById.get(columnId);
    if (!column) return;
    impact.columnIds.add(column.id);
    addTable(schemaGraphTableId(column.schema, column.table));
  };
  const addForeignKey = (foreignKey: SchemaGraphForeignKeySelection) => {
    impact.foreignKeyConstraintIds.add(foreignKey.constraintId);
    impact.constraintIds.add(foreignKey.constraintId);
    addTable(foreignKey.sourceTableId);
    addTable(foreignKey.targetTableId);
    [...foreignKey.sourceColumnIds, ...foreignKey.targetColumnIds].forEach(
      addColumn,
    );
  };
  const addForeignKeyByConstraintId = (constraintId: string) => {
    const foreignKey = selectors.foreignKeysByConstraintId.get(constraintId);
    if (foreignKey) addForeignKey(foreignKey);
  };
  const addInboundForeignKeysForColumnSet = (
    tableId: string,
    columnIds: readonly string[],
  ) => {
    if (columnIds.length === 0) return;
    const sortedColumnIds = [...columnIds].sort(compareText);
    for (const foreignKey of selectors.foreignKeysByTableId.get(tableId)
      ?.incomingForeignKeys ?? []) {
      if (
        sameIdList(
          sortedColumnIds,
          [...foreignKey.targetColumnIds].sort(compareText),
        )
      ) {
        addForeignKey(foreignKey);
      }
    }
  };
  const addConstraint = (constraintId: string) => {
    const constraint = selectors.constraintsById.get(constraintId);
    if (!constraint) return;
    impact.constraintIds.add(constraint.id);
    const tableId = schemaGraphTableId(constraint.schema, constraint.table);
    const constraintColumns = linkedColumns("constraint-column", constraint.id);
    addTable(tableId);
    constraintColumns.forEach(addColumn);
    addForeignKeyByConstraintId(constraint.id);
    addInboundForeignKeysForColumnSet(tableId, constraintColumns);
  };
  const addIndex = (indexId: string) => {
    const index = selectors.indexesById.get(indexId);
    if (!index) return;
    impact.indexIds.add(index.id);
    addTable(schemaGraphTableId(index.schema, index.table));
    linkedColumns("index-column", index.id).forEach(addColumn);
  };

  if (node) {
    switch (node.kind) {
      case "table":
        addTable(node.id);
        selectors.columnsByTableId
          .get(node.id)
          ?.forEach(({ id }) => addColumn(id));
        selectors.indexesByTableId
          .get(node.id)
          ?.forEach(({ id }) => addIndex(id));
        selectors.constraintsByTableId
          .get(node.id)
          ?.forEach(({ id }) => addConstraint(id));
        selectors.foreignKeysByTableId
          .get(node.id)
          ?.incomingForeignKeys.forEach(addForeignKey);
        selectors.foreignKeysByTableId
          .get(node.id)
          ?.outgoingForeignKeys.forEach(addForeignKey);
        break;
      case "column":
        addColumn(node.id);
        for (const edge of selectors.graph.edges) {
          if (edge.kind === "index-column" && edge.to === node.id) {
            addIndex(edge.from);
          }
          if (edge.kind === "constraint-column" && edge.to === node.id) {
            addConstraint(edge.from);
          }
          if (
            edge.kind === "foreign-key-column" &&
            (edge.from === node.id || edge.to === node.id) &&
            edge.constraintId
          ) {
            addForeignKeyByConstraintId(edge.constraintId);
          }
        }
        selectors.foreignKeys
          .filter(
            (foreignKey) =>
              foreignKey.sourceColumnIds.includes(node.id) ||
              foreignKey.targetColumnIds.includes(node.id),
          )
          .forEach(addForeignKey);
        break;
      case "constraint":
        addConstraint(node.id);
        break;
      case "index": {
        addIndex(node.id);
        const indexColumns = linkedColumns("index-column", node.id);
        if (node.data.is_primary || node.data.is_unique) {
          addInboundForeignKeysForColumnSet(
            schemaGraphTableId(node.schema, node.table),
            indexColumns,
          );
        }
        for (const constraint of selectors.constraintsByTableId.get(
          schemaGraphTableId(node.schema, node.table),
        ) ?? []) {
          if (
            sameIdList(
              indexColumns,
              linkedColumns("constraint-column", constraint.id),
            )
          ) {
            addConstraint(constraint.id);
          }
        }
        break;
      }
    }
  }

  const affectedTables = nodesForIds(impact.tableIds, selectors.tablesById);
  const subjectIds = new Set([
    ...impact.tableIds,
    ...impact.columnIds,
    ...impact.indexIds,
    ...impact.constraintIds,
  ]);

  return {
    targetFound: Boolean(node),
    target: targetSummary,
    targetLabel: targetSummary.label,
    affectedTables,
    affectedColumns: nodesForIds(impact.columnIds, selectors.columnsById),
    affectedIndexes: nodesForIds(impact.indexIds, selectors.indexesById),
    affectedConstraints: nodesForIds(
      impact.constraintIds,
      selectors.constraintsById,
    ),
    foreignKeys: sortForeignKeys(
      selectors.foreignKeys.filter((foreignKey) =>
        impact.foreignKeyConstraintIds.has(foreignKey.constraintId),
      ),
    ),
    metadataReadiness: affectedTables
      .map((table) => selectors.metadataReadinessByTableId.get(table.id))
      .filter(isPresent)
      .sort((left, right) => compareText(left.tableId, right.tableId)),
    diagnostics: sortDiagnostics(
      selectors.diagnostics.filter((diagnostic) => {
        if (subjectIds.has(diagnostic.subjectId)) return true;
        return affectedTables.some((table) =>
          diagnostic.subjectId.startsWith(`${table.id}.`),
        );
      }),
    ),
  };
}

function migrationRemovalTargetId(
  target: SchemaGraphMigrationRemovalTarget,
): string {
  switch (target.kind) {
    case "table":
      return target.tableId;
    case "column":
      return target.columnId;
    case "constraint":
      return target.constraintId;
    case "index":
      return target.indexId;
  }
}

function migrationRemovalTargetNode(
  selectors: SchemaGraphIntelligenceSelectors,
  target: SchemaGraphMigrationRemovalTarget,
): SchemaGraphMigrationTargetNode | undefined {
  switch (target.kind) {
    case "table":
      return selectors.tablesById.get(target.tableId);
    case "column":
      return selectors.columnsById.get(target.columnId);
    case "constraint":
      return selectors.constraintsById.get(target.constraintId);
    case "index":
      return selectors.indexesById.get(target.indexId);
  }
}

function migrationTargetLabel(node: SchemaGraphMigrationTargetNode): string {
  switch (node.kind) {
    case "table":
      return `${node.schema}.${node.table}`;
    case "column":
      return `${node.schema}.${node.table}.${node.column}`;
    case "constraint":
      return `${node.schema}.${node.table}.${node.constraint}`;
    case "index":
      return `${node.schema}.${node.table}.${node.index}`;
  }
}

function sameIdList(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function nodesForIds<Node extends { readonly id: string }>(
  ids: ReadonlySet<string>,
  nodesById: ReadonlyMap<string, Node>,
): readonly Node[] {
  return [...ids]
    .map((id) => nodesById.get(id))
    .filter(isPresent)
    .sort((left, right) => compareText(left.id, right.id));
}

function isPresent<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sortForeignKeys(
  foreignKeys: readonly SchemaGraphForeignKeySelection[],
): readonly SchemaGraphForeignKeySelection[] {
  return [...foreignKeys].sort((left, right) =>
    compareText(left.edgeId, right.edgeId),
  );
}

function sortDiagnostics(
  diagnostics: readonly SchemaGraphDiagnostic[],
): readonly SchemaGraphDiagnostic[] {
  return [...diagnostics].sort((left, right) => compareText(left.id, right.id));
}

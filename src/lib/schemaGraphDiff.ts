import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphColumnNode,
  SchemaGraphConstraintNode,
  SchemaGraphForeignKeyEndpoint,
  SchemaGraphIndexNode,
  SchemaGraphSource,
  SchemaGraphTableNode,
} from "@/types/schemaGraph";
import { compareText, schemaGraphTableId } from "./schemaGraphSupport";
import {
  selectSchemaGraphIntelligence,
  type SchemaGraphForeignKeySelection,
  type SchemaGraphIntelligenceSelectors,
} from "./schemaGraphSelectors";

export type SchemaGraphDiffEntityKind =
  | "table"
  | "column"
  | "index"
  | "constraint"
  | "foreign-key";
export type SchemaGraphDiffChangeKind = "added" | "removed" | "changed";

export interface SchemaGraphDiffFieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface SchemaGraphDiffEntry {
  readonly id: string;
  readonly entityKind: SchemaGraphDiffEntityKind;
  readonly kind: SchemaGraphDiffChangeKind;
  readonly label: string;
  readonly changes: readonly SchemaGraphDiffFieldChange[];
  readonly tableIds?: readonly string[];
}

export interface SchemaGraphDiffGroup {
  readonly added: readonly SchemaGraphDiffEntry[];
  readonly removed: readonly SchemaGraphDiffEntry[];
  readonly changed: readonly SchemaGraphDiffEntry[];
}

export interface SchemaGraphDiffTotals {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
  readonly total: number;
}

export interface SchemaGraphDiffSummary {
  readonly source: {
    readonly before: SchemaGraphSource;
    readonly after: SchemaGraphSource;
  };
  readonly sameSource: boolean;
  readonly groups: {
    readonly tables: SchemaGraphDiffGroup;
    readonly columns: SchemaGraphDiffGroup;
    readonly indexes: SchemaGraphDiffGroup;
    readonly constraints: SchemaGraphDiffGroup;
    readonly foreignKeys: SchemaGraphDiffGroup;
  };
  readonly tables: SchemaGraphDiffGroup;
  readonly columns: SchemaGraphDiffGroup;
  readonly indexes: SchemaGraphDiffGroup;
  readonly constraints: SchemaGraphDiffGroup;
  readonly foreignKeys: SchemaGraphDiffGroup;
  readonly totals: SchemaGraphDiffTotals;
}

type SchemaGraphDiffInput = SchemaGraph | SchemaGraphCatalogSnapshot;
type NodeWithTable =
  | SchemaGraphColumnNode
  | SchemaGraphIndexNode
  | SchemaGraphConstraintNode;

export function selectSchemaGraphDiff(
  beforeInput: SchemaGraphDiffInput,
  afterInput: SchemaGraphDiffInput,
): SchemaGraphDiffSummary {
  const before = selectSchemaGraphIntelligence(beforeInput);
  const after = selectSchemaGraphIntelligence(afterInput);
  const columns = diffNodeMap({
    entityKind: "column",
    before: before.columnsById,
    after: after.columnsById,
    label: formatColumn,
    tableIds: (node) => [tableIdForNode(node)],
    changes: columnChanges,
  });
  const indexes = diffNodeMap({
    entityKind: "index",
    before: before.indexesById,
    after: after.indexesById,
    label: formatIndex,
    tableIds: (node) => [tableIdForNode(node)],
    changes: indexChanges,
  });
  const constraints = diffNodeMap({
    entityKind: "constraint",
    before: before.constraintsById,
    after: after.constraintsById,
    label: formatConstraint,
    tableIds: (node) => [tableIdForNode(node)],
    changes: constraintChanges,
  });
  const foreignKeys = diffForeignKeys(before, after);
  const tables = diffTables(before, after, [
    columns,
    indexes,
    constraints,
    foreignKeys,
  ]);
  const groups = { tables, columns, indexes, constraints, foreignKeys };
  const totals = diffTotals(Object.values(groups));

  return {
    source: {
      before: before.graph.source,
      after: after.graph.source,
    },
    sameSource: sameSource(before.graph.source, after.graph.source),
    groups,
    tables,
    columns,
    indexes,
    constraints,
    foreignKeys,
    totals,
  };
}

function diffNodeMap<Node>({
  entityKind,
  before,
  after,
  label,
  tableIds,
  changes,
}: {
  readonly entityKind: SchemaGraphDiffEntityKind;
  readonly before: ReadonlyMap<string, Node>;
  readonly after: ReadonlyMap<string, Node>;
  readonly label: (node: Node) => string;
  readonly tableIds: (node: Node) => readonly string[];
  readonly changes: (
    beforeNode: Node,
    afterNode: Node,
  ) => readonly SchemaGraphDiffFieldChange[];
}): SchemaGraphDiffGroup {
  return {
    added: [...after.entries()]
      .filter(([id]) => !before.has(id))
      .map(([id, node]) =>
        diffEntry(id, entityKind, "added", label(node), [], tableIds(node)),
      )
      .sort(compareDiffEntries),
    removed: [...before.entries()]
      .filter(([id]) => !after.has(id))
      .map(([id, node]) =>
        diffEntry(id, entityKind, "removed", label(node), [], tableIds(node)),
      )
      .sort(compareDiffEntries),
    changed: [...before.entries()]
      .flatMap(([id, beforeNode]) => {
        const afterNode = after.get(id);
        if (!afterNode) return [];
        const fieldChanges = changes(beforeNode, afterNode);
        return fieldChanges.length === 0
          ? []
          : [
              diffEntry(
                id,
                entityKind,
                "changed",
                label(afterNode),
                fieldChanges,
                tableIds(afterNode),
              ),
            ];
      })
      .sort(compareDiffEntries),
  };
}

function diffForeignKeys(
  before: SchemaGraphIntelligenceSelectors,
  after: SchemaGraphIntelligenceSelectors,
): SchemaGraphDiffGroup {
  return diffNodeMap({
    entityKind: "foreign-key",
    before: before.foreignKeysByConstraintId,
    after: after.foreignKeysByConstraintId,
    label: formatForeignKey,
    tableIds: (foreignKey) => [
      foreignKey.sourceTableId,
      foreignKey.targetTableId,
    ],
    changes: foreignKeyChanges,
  });
}

function diffTables(
  before: SchemaGraphIntelligenceSelectors,
  after: SchemaGraphIntelligenceSelectors,
  childGroups: readonly SchemaGraphDiffGroup[],
): SchemaGraphDiffGroup {
  const added = [...after.tablesById.entries()]
    .filter(([id]) => !before.tablesById.has(id))
    .map(([id, table]) =>
      diffEntry(id, "table", "added", formatTable(table), [], [id]),
    )
    .sort(compareDiffEntries);
  const removed = [...before.tablesById.entries()]
    .filter(([id]) => !after.tablesById.has(id))
    .map(([id, table]) =>
      diffEntry(id, "table", "removed", formatTable(table), [], [id]),
    )
    .sort(compareDiffEntries);
  const changedReasons = collectChangedTableReasons(before, after, childGroups);
  const changed = [...changedReasons.entries()]
    .map(([tableId, reasons]) => {
      const table =
        after.tablesById.get(tableId) ?? before.tablesById.get(tableId);
      if (!table) return null;
      return diffEntry(
        tableId,
        "table",
        "changed",
        formatTable(table),
        [...reasons].sort(compareText).map((reason) => ({
          field: reason,
          before: "cached",
          after: "changed",
        })),
        [tableId],
      );
    })
    .filter((entry): entry is SchemaGraphDiffEntry => entry !== null)
    .sort(compareDiffEntries);

  return { added, removed, changed };
}

function collectChangedTableReasons(
  before: SchemaGraphIntelligenceSelectors,
  after: SchemaGraphIntelligenceSelectors,
  childGroups: readonly SchemaGraphDiffGroup[],
): Map<string, Set<string>> {
  const reasons = new Map<string, Set<string>>();
  for (const group of childGroups) {
    for (const entry of [...group.added, ...group.removed, ...group.changed]) {
      for (const tableId of entry.tableIds ?? []) {
        if (!before.tablesById.has(tableId) || !after.tablesById.has(tableId)) {
          continue;
        }
        const tableReasons = reasons.get(tableId) ?? new Set<string>();
        tableReasons.add(reasonLabel(entry.entityKind));
        reasons.set(tableId, tableReasons);
      }
    }
  }
  return reasons;
}

function columnChanges(
  before: SchemaGraphColumnNode,
  after: SchemaGraphColumnNode,
): readonly SchemaGraphDiffFieldChange[] {
  return fieldChanges([
    ["data type", before.data.data_type, after.data.data_type],
    ["nullable", before.data.nullable, after.data.nullable],
    ["default", before.data.default_value, after.data.default_value],
    ["primary key", before.data.is_primary_key, after.data.is_primary_key],
    ["foreign key", before.data.is_foreign_key, after.data.is_foreign_key],
    ["FK reference", before.data.fk_reference, after.data.fk_reference],
    ["comment", before.data.comment, after.data.comment],
    [
      "CHECK clauses",
      before.data.check_clauses ?? [],
      after.data.check_clauses ?? [],
    ],
  ]);
}

function indexChanges(
  before: SchemaGraphIndexNode,
  after: SchemaGraphIndexNode,
): readonly SchemaGraphDiffFieldChange[] {
  return fieldChanges([
    ["columns", before.data.columns, after.data.columns],
    ["type", before.data.index_type, after.data.index_type],
    ["unique", before.data.is_unique, after.data.is_unique],
    ["primary", before.data.is_primary, after.data.is_primary],
  ]);
}

function constraintChanges(
  before: SchemaGraphConstraintNode,
  after: SchemaGraphConstraintNode,
): readonly SchemaGraphDiffFieldChange[] {
  return fieldChanges([
    ["type", before.data.constraintType, after.data.constraintType],
    ["columns", before.data.columns, after.data.columns],
    ["reference table", before.data.referenceTable, after.data.referenceTable],
    [
      "reference columns",
      before.data.referenceColumns ?? [],
      after.data.referenceColumns ?? [],
    ],
    [
      "CHECK expression",
      before.data.checkExpression,
      after.data.checkExpression,
    ],
    ["synthetic", before.data.synthetic, after.data.synthetic],
  ]);
}

function foreignKeyChanges(
  before: SchemaGraphForeignKeySelection,
  after: SchemaGraphForeignKeySelection,
): readonly SchemaGraphDiffFieldChange[] {
  return [
    sameValue(before.relationship.source, after.relationship.source)
      ? null
      : {
          field: "source",
          before: endpointLabel(before.relationship.source),
          after: endpointLabel(after.relationship.source),
        },
    sameValue(before.relationship.target, after.relationship.target)
      ? null
      : {
          field: "target",
          before: endpointLabel(before.relationship.target),
          after: endpointLabel(after.relationship.target),
        },
  ].filter((change): change is SchemaGraphDiffFieldChange => change !== null);
}

function fieldChanges(
  fields: readonly (readonly [string, unknown, unknown])[],
): readonly SchemaGraphDiffFieldChange[] {
  return fields.flatMap(([field, before, after]) =>
    sameValue(before, after)
      ? []
      : [
          {
            field,
            before: formatValue(before),
            after: formatValue(after),
          },
        ],
  );
}

function diffEntry(
  id: string,
  entityKind: SchemaGraphDiffEntityKind,
  kind: SchemaGraphDiffChangeKind,
  label: string,
  changes: readonly SchemaGraphDiffFieldChange[],
  tableIds: readonly string[],
): SchemaGraphDiffEntry {
  return { id, entityKind, kind, label, changes, tableIds };
}

function diffTotals(
  groups: readonly SchemaGraphDiffGroup[],
): SchemaGraphDiffTotals {
  const added = groups.reduce((sum, group) => sum + group.added.length, 0);
  const removed = groups.reduce((sum, group) => sum + group.removed.length, 0);
  const changed = groups.reduce((sum, group) => sum + group.changed.length, 0);
  return { added, removed, changed, total: added + removed + changed };
}

function sameSource(before: SchemaGraphSource, after: SchemaGraphSource) {
  if (before.connectionId || after.connectionId) {
    return (
      before.connectionId === after.connectionId &&
      before.dbType === after.dbType &&
      before.database === after.database
    );
  }
  return before.dbType === after.dbType && before.database === after.database;
}

function tableIdForNode(node: NodeWithTable): string {
  return schemaGraphTableId(node.schema, node.table);
}

function compareDiffEntries(
  left: SchemaGraphDiffEntry,
  right: SchemaGraphDiffEntry,
): number {
  return compareText(left.label, right.label) || compareText(left.id, right.id);
}

function reasonLabel(entityKind: SchemaGraphDiffEntityKind): string {
  switch (entityKind) {
    case "table":
      return "tables";
    case "column":
      return "columns";
    case "index":
      return "indexes";
    case "constraint":
      return "constraints";
    case "foreign-key":
      return "foreign keys";
  }
}

function formatTable(table: SchemaGraphTableNode): string {
  return `${table.schema}.${table.table}`;
}

function formatColumn(column: SchemaGraphColumnNode): string {
  return `${column.schema}.${column.table}.${column.column}`;
}

function formatIndex(index: SchemaGraphIndexNode): string {
  return `${index.schema}.${index.table}.${index.index}`;
}

function formatConstraint(constraint: SchemaGraphConstraintNode): string {
  return `${constraint.schema}.${constraint.table}.${constraint.constraint}`;
}

function formatForeignKey(foreignKey: SchemaGraphForeignKeySelection): string {
  return `${foreignKey.relationship.source.schema}.${foreignKey.relationship.source.table}.${foreignKey.relationship.rawMetadata.constraintName}`;
}

function endpointLabel(endpoint: SchemaGraphForeignKeyEndpoint): string {
  const columns =
    endpoint.columns.length > 0
      ? endpoint.columns.map(formatArrayValue).join(", ")
      : "none";
  return `${endpoint.schema}.${endpoint.table} (${columns})`;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(formatArrayValue).join(", ") : "none";
  }
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function formatArrayValue(value: unknown): string {
  const formatted = formatValue(value);
  return formatted.includes(",") ? JSON.stringify(formatted) : formatted;
}

function sameValue(before: unknown, after: unknown): boolean {
  return stableValue(before) === stableValue(after);
}

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return JSON.stringify(["array", value.map((entry) => stableValue(entry))]);
  }
  if (value !== null && typeof value === "object") {
    return JSON.stringify([
      "object",
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    ]);
  }
  return JSON.stringify(["primitive", value]);
}

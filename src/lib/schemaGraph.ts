import { RUNTIME_RDBMS_DATABASE_TYPES } from "@/types/rdbmsDataSources";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TableInfo,
} from "@/types/schema";
import type {
  SchemaGraph,
  SchemaGraphCatalogSnapshot,
  SchemaGraphConstraintPayload,
  SchemaGraphDiagnostic,
  SchemaGraphEdge,
  SchemaGraphNode,
} from "@/types/schemaGraph";
import {
  collectSchemaNames,
  collectTables,
  constraintPayload,
  sortedTableRefs,
  tableColumns,
  tableConstraints,
  tableIndexes,
  type TableRef,
} from "./schemaGraphCatalog";
import {
  addSchemaGraphDiagnostic as addDiagnostic,
  addSchemaGraphEdge as addEdge,
  formatReferenceTable,
  isCheckConstraint as isCheck,
  isForeignKeyConstraint as isForeignKey,
  isPrimaryKeyConstraint as isPrimaryKey,
  parseFkReference,
  schemaGraphColumnId,
  schemaGraphConstraintId,
  schemaGraphIndexId,
  schemaGraphSchemaId,
  schemaGraphTableId,
  sortById,
  sortByName,
} from "./schemaGraphSupport";
import { normalizeForeignKeyRelationship } from "./schemaGraphRelationships";

interface Context {
  readonly snapshot: SchemaGraphCatalogSnapshot;
  readonly nodes: Map<string, SchemaGraphNode>;
  readonly edges: Map<string, SchemaGraphEdge>;
  readonly diagnostics: Map<string, SchemaGraphDiagnostic>;
  readonly tables: Map<string, TableInfo>;
  readonly columns: Map<string, ColumnInfo>;
}

export function extractSchemaGraph(
  snapshot: SchemaGraphCatalogSnapshot,
): SchemaGraph {
  if (!RUNTIME_RDBMS_DATABASE_TYPES.includes(snapshot.source.dbType)) {
    throw new Error(
      `Unsupported SchemaGraph dbType: ${snapshot.source.dbType}`,
    );
  }

  const context: Context = {
    snapshot,
    nodes: new Map(),
    edges: new Map(),
    diagnostics: new Map(),
    tables: collectTables(snapshot),
    columns: new Map(),
  };

  for (const schema of collectSchemaNames(snapshot, context.tables)) {
    const id = schemaGraphSchemaId(schema);
    context.nodes.set(id, {
      id,
      kind: "schema",
      label: schema,
      schema,
      data: { name: schema },
    });
  }

  const tableRefs = sortedTableRefs(context.tables);
  for (const table of tableRefs) {
    addTable(table, context);
  }
  for (const table of tableRefs) {
    addTableRelations(table, context);
  }

  return {
    source: snapshot.source,
    nodes: sortById([...context.nodes.values()]),
    edges: sortById([...context.edges.values()]),
    diagnostics: sortById([...context.diagnostics.values()]),
  };
}

function addTable(table: TableRef, context: Context) {
  const tableId = schemaGraphTableId(table.schema, table.table);
  const tableInfo = context.tables.get(tableId);
  if (!tableInfo) return;

  context.nodes.set(tableId, {
    id: tableId,
    kind: "table",
    label: table.table,
    schema: table.schema,
    table: table.table,
    data: tableInfo,
  });
  addEdge(
    context.edges,
    "schema-table",
    schemaGraphSchemaId(table.schema),
    tableId,
  );

  sortByName(tableColumns(context.snapshot, table)).forEach((column, ordinal) =>
    addColumn(table, column, ordinal, context),
  );
}

function addTableRelations(table: TableRef, context: Context) {
  const columns = sortByName(tableColumns(context.snapshot, table));
  for (const index of sortByName(tableIndexes(context.snapshot, table))) {
    addIndex(table, index, context);
  }
  const constraints = tableConstraints(context.snapshot, table);
  for (const constraint of sortByName(constraints)) {
    addConstraint(table, constraintPayload(constraint), context);
  }
  addSyntheticConstraints(table, columns, constraints, context);
}

function addColumn(
  table: TableRef,
  column: ColumnInfo,
  ordinal: number,
  context: Context,
) {
  const tableId = schemaGraphTableId(table.schema, table.table);
  const id = schemaGraphColumnId(table.schema, table.table, column.name);
  context.columns.set(id, column);
  context.nodes.set(id, {
    id,
    kind: "column",
    label: column.name,
    schema: table.schema,
    table: table.table,
    column: column.name,
    ordinal,
    data: column,
  });
  addEdge(context.edges, "table-column", tableId, id);
}

function addIndex(table: TableRef, index: IndexInfo, context: Context) {
  const tableId = schemaGraphTableId(table.schema, table.table);
  const indexId = schemaGraphIndexId(table.schema, table.table, index.name);
  context.nodes.set(indexId, {
    id: indexId,
    kind: "index",
    label: index.name,
    schema: table.schema,
    table: table.table,
    index: index.name,
    data: index,
  });
  addEdge(context.edges, "table-index", tableId, indexId);

  for (const column of index.columns) {
    const columnId = schemaGraphColumnId(table.schema, table.table, column);
    if (context.columns.has(columnId)) {
      addEdge(context.edges, "index-column", indexId, columnId);
    } else {
      addDiagnostic(context.diagnostics, "missing-index-column", indexId, {
        schema: table.schema,
        table: table.table,
        column,
      });
    }
  }
}

function addSyntheticConstraints(
  table: TableRef,
  columns: readonly ColumnInfo[],
  constraints: readonly ConstraintInfo[],
  context: Context,
) {
  const hasPrimaryKey = constraints.some((constraint) =>
    isPrimaryKey(constraint.constraint_type),
  );
  const hasCheckConstraint = constraints.some((constraint) =>
    isCheck(constraint.constraint_type),
  );
  const explicitFkColumns = new Set(
    constraints
      .filter((constraint) => isForeignKey(constraint.constraint_type))
      .flatMap((constraint) => constraint.columns),
  );
  const pkColumns = columns
    .filter((column) => column.is_primary_key)
    .map((column) => column.name);
  if (!hasPrimaryKey && pkColumns.length > 0) {
    addConstraint(
      table,
      {
        name: "__synthetic_primary_key",
        constraintType: "PRIMARY KEY",
        columns: pkColumns,
        referenceTable: null,
        referenceColumns: null,
        synthetic: true,
      },
      context,
    );
  }

  for (const column of columns) {
    if (!column.is_foreign_key || !column.fk_reference) continue;
    if (explicitFkColumns.has(column.name)) continue;
    const parsed = parseFkReference(column.fk_reference);
    addConstraint(
      table,
      {
        name: `__synthetic_foreign_key_${column.name}`,
        constraintType: "FOREIGN KEY",
        columns: [column.name],
        referenceTable: parsed
          ? formatReferenceTable(parsed)
          : column.fk_reference,
        referenceColumns: parsed ? parsed.columns : null,
        synthetic: true,
      },
      context,
    );
  }

  if (!hasCheckConstraint) {
    [...collectCheckClauses(columns).entries()].forEach(
      ([checkExpression, checkColumns], index) => {
        addConstraint(
          table,
          {
            name: `__synthetic_check_${index + 1}`,
            constraintType: "CHECK",
            columns: checkColumns,
            referenceTable: null,
            referenceColumns: null,
            checkExpression,
            synthetic: true,
          },
          context,
        );
      },
    );
  }
}

function collectCheckClauses(
  columns: readonly ColumnInfo[],
): Map<string, readonly string[]> {
  const clauses = new Map<string, Set<string>>();
  for (const column of columns) {
    for (const clause of column.check_clauses ?? []) {
      const existing = clauses.get(clause) ?? new Set<string>();
      existing.add(column.name);
      clauses.set(clause, existing);
    }
  }
  return new Map(
    [...clauses.entries()]
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([clause, clauseColumns]) => [
        clause,
        [...clauseColumns].sort((left, right) =>
          left.localeCompare(right, "en"),
        ),
      ]),
  );
}

function addConstraint(
  table: TableRef,
  payload: SchemaGraphConstraintPayload,
  context: Context,
) {
  const tableId = schemaGraphTableId(table.schema, table.table);
  const constraintId = schemaGraphConstraintId(
    table.schema,
    table.table,
    payload.name,
  );
  const normalizedForeignKey = isForeignKey(payload.constraintType)
    ? normalizeForeignKeyRelationship({
        table,
        payload,
        getSourceColumn: (column) =>
          context.columns.get(
            schemaGraphColumnId(table.schema, table.table, column),
          ),
      })
    : null;
  normalizedForeignKey?.diagnostics.forEach((diagnostic) => {
    addDiagnostic(
      context.diagnostics,
      diagnostic.kind,
      constraintId,
      diagnostic.details,
    );
  });
  const nodePayload = normalizedForeignKey?.relationship
    ? { ...payload, foreignKey: normalizedForeignKey.relationship }
    : payload;

  context.nodes.set(constraintId, {
    id: constraintId,
    kind: "constraint",
    label: payload.name,
    schema: table.schema,
    table: table.table,
    constraint: payload.name,
    data: nodePayload,
  });
  addEdge(context.edges, "table-constraint", tableId, constraintId);

  for (const column of payload.columns) {
    const columnId = schemaGraphColumnId(table.schema, table.table, column);
    if (!context.columns.has(columnId)) {
      addDiagnostic(
        context.diagnostics,
        "missing-constraint-column",
        constraintId,
        {
          schema: table.schema,
          table: table.table,
          column,
        },
      );
      continue;
    }
    addEdge(context.edges, "constraint-column", constraintId, columnId);
    if (isPrimaryKey(payload.constraintType)) {
      addEdge(context.edges, "primary-key-column", tableId, columnId, {
        constraintId,
      });
    }
  }

  if (normalizedForeignKey?.relationship) {
    addForeignKeyEdges(
      normalizedForeignKey.relationship,
      constraintId,
      context,
    );
  }
}

function addForeignKeyEdges(
  relationship: NonNullable<SchemaGraphConstraintPayload["foreignKey"]>,
  constraintId: string,
  context: Context,
) {
  const referenceTableId = schemaGraphTableId(
    relationship.target.schema,
    relationship.target.table,
  );
  if (!context.tables.has(referenceTableId)) {
    addDiagnostic(
      context.diagnostics,
      "missing-reference-table",
      constraintId,
      {
        schema: relationship.source.schema,
        table: relationship.source.table,
        referenceSchema: relationship.target.schema,
        referenceTable: relationship.target.table,
      },
    );
    return;
  }

  const tableId = schemaGraphTableId(
    relationship.source.schema,
    relationship.source.table,
  );
  addEdge(context.edges, "foreign-key-table", tableId, referenceTableId, {
    constraintId,
    columns: relationship.source.columns,
    referenceColumns: relationship.target.columns,
    foreignKey: relationship,
  });
  relationship.source.columns.forEach((sourceColumn, index) => {
    const referenceColumn = relationship.target.columns[index];
    addForeignKeyColumnEdge(
      { schema: relationship.source.schema, table: relationship.source.table },
      sourceColumn,
      relationship.target.schema,
      relationship.target.table,
      referenceColumn,
      constraintId,
      relationship,
      context,
    );
  });
}

function addForeignKeyColumnEdge(
  table: TableRef,
  sourceColumn: string,
  referenceSchema: string,
  referenceTable: string,
  referenceColumn: string | undefined,
  constraintId: string,
  relationship: NonNullable<SchemaGraphConstraintPayload["foreignKey"]>,
  context: Context,
) {
  const sourceColumnId = schemaGraphColumnId(
    table.schema,
    table.table,
    sourceColumn,
  );
  if (!context.columns.has(sourceColumnId)) {
    addDiagnostic(context.diagnostics, "missing-source-column", constraintId, {
      schema: table.schema,
      table: table.table,
      sourceColumn,
    });
    return;
  }
  if (!referenceColumn) {
    addDiagnostic(
      context.diagnostics,
      "missing-reference-column",
      constraintId,
      {
        schema: table.schema,
        table: table.table,
        sourceColumn,
      },
    );
    return;
  }

  const referenceColumnId = schemaGraphColumnId(
    referenceSchema,
    referenceTable,
    referenceColumn,
  );
  if (!context.columns.has(referenceColumnId)) {
    addDiagnostic(
      context.diagnostics,
      "missing-reference-column",
      constraintId,
      {
        schema: table.schema,
        table: table.table,
        referenceSchema,
        referenceTable,
        referenceColumn,
      },
    );
    return;
  }
  addEdge(
    context.edges,
    "foreign-key-column",
    sourceColumnId,
    referenceColumnId,
    {
      constraintId,
      columns: [sourceColumn],
      referenceColumns: [referenceColumn],
      foreignKey: relationship,
    },
  );
}

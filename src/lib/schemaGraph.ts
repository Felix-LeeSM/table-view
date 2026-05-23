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
  isForeignKeyConstraint as isForeignKey,
  isPrimaryKeyConstraint as isPrimaryKey,
  parseFkReference,
  parseReferenceTable,
  type ParsedFkReference,
  schemaGraphColumnId,
  schemaGraphConstraintId,
  schemaGraphIndexId,
  schemaGraphSchemaId,
  schemaGraphTableId,
  sortById,
  sortByName,
} from "./schemaGraphSupport";

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
  context.nodes.set(constraintId, {
    id: constraintId,
    kind: "constraint",
    label: payload.name,
    schema: table.schema,
    table: table.table,
    constraint: payload.name,
    data: payload,
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

  if (isForeignKey(payload.constraintType)) {
    addForeignKeyEdges(table, payload, constraintId, context);
  }
}

function addForeignKeyEdges(
  table: TableRef,
  payload: SchemaGraphConstraintPayload,
  constraintId: string,
  context: Context,
) {
  const reference = resolveForeignKeyReference(table, payload, context);
  if (!reference) {
    addDiagnostic(context.diagnostics, "invalid-fk-reference", constraintId, {
      schema: table.schema,
      table: table.table,
    });
    return;
  }

  const referenceSchema = reference.schema ?? table.schema;
  const referenceTableId = schemaGraphTableId(referenceSchema, reference.table);
  if (!reference.schema) {
    addDiagnostic(
      context.diagnostics,
      "inferred-reference-schema",
      constraintId,
      {
        schema: table.schema,
        table: table.table,
        referenceTable: reference.table,
      },
    );
  }
  if (!context.tables.has(referenceTableId)) {
    addDiagnostic(
      context.diagnostics,
      "missing-reference-table",
      constraintId,
      {
        schema: table.schema,
        table: table.table,
        referenceSchema,
        referenceTable: reference.table,
      },
    );
    return;
  }

  const tableId = schemaGraphTableId(table.schema, table.table);
  addEdge(context.edges, "foreign-key-table", tableId, referenceTableId, {
    constraintId,
    columns: payload.columns,
    referenceColumns: reference.columns,
  });
  payload.columns.forEach((sourceColumn, index) => {
    const referenceColumn = reference.columns[index];
    addForeignKeyColumnEdge(
      table,
      sourceColumn,
      referenceSchema,
      reference.table,
      referenceColumn,
      constraintId,
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
    },
  );
}

function resolveForeignKeyReference(
  table: TableRef,
  payload: SchemaGraphConstraintPayload,
  context: Context,
): ParsedFkReference | null {
  const firstColumn = payload.columns[0];
  const columnInfo = firstColumn
    ? context.columns.get(
        schemaGraphColumnId(table.schema, table.table, firstColumn),
      )
    : undefined;
  const columnReference = columnInfo?.fk_reference
    ? parseFkReference(columnInfo.fk_reference)
    : null;
  const tableReference = payload.referenceTable
    ? parseReferenceTable(payload.referenceTable)
    : null;
  const referenceTable = tableReference ?? columnReference;
  const referenceColumns = payload.referenceColumns ?? columnReference?.columns;

  if (!referenceTable || !referenceColumns || referenceColumns.length === 0) {
    return null;
  }
  return {
    schema: referenceTable.schema ?? columnReference?.schema,
    table: referenceTable.table,
    columns: referenceColumns,
  };
}

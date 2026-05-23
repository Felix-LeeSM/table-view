import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  TableInfo,
} from "@/types/schema";
import type {
  SchemaGraphCatalogSnapshot,
  SchemaGraphConstraintPayload,
} from "@/types/schemaGraph";
import { compareText, schemaGraphTableId } from "./schemaGraphSupport";

export interface TableRef {
  readonly schema: string;
  readonly table: string;
}

export function collectTables(
  snapshot: SchemaGraphCatalogSnapshot,
): Map<string, TableInfo> {
  const tables = new Map<string, TableInfo>();
  for (const [schemaName, schemaTables] of Object.entries(
    snapshot.tablesBySchema,
  )) {
    for (const table of schemaTables) {
      const normalized = { ...table, schema: table.schema || schemaName };
      tables.set(
        schemaGraphTableId(normalized.schema, normalized.name),
        normalized,
      );
    }
  }
  return tables;
}

export function collectSchemaNames(
  snapshot: SchemaGraphCatalogSnapshot,
  tables: Map<string, TableInfo>,
): readonly string[] {
  const names = new Set(snapshot.schemas.map((schema) => schema.name));
  Object.keys(snapshot.tablesBySchema).forEach((schema) => names.add(schema));
  Object.keys(snapshot.columnsByTable).forEach((schema) => names.add(schema));
  [...tables.values()].forEach((table) => names.add(table.schema));
  return [...names].sort(compareText);
}

export function sortedTableRefs(
  tables: Map<string, TableInfo>,
): readonly TableRef[] {
  return [...tables.values()]
    .map((table) => ({ schema: table.schema, table: table.name }))
    .sort(
      (left, right) =>
        compareText(left.schema, right.schema) ||
        compareText(left.table, right.table),
    );
}

export function tableColumns(
  snapshot: SchemaGraphCatalogSnapshot,
  table: TableRef,
): readonly ColumnInfo[] {
  return snapshot.columnsByTable[table.schema]?.[table.table] ?? [];
}

export function tableIndexes(
  snapshot: SchemaGraphCatalogSnapshot,
  table: TableRef,
): readonly IndexInfo[] {
  return snapshot.indexesByTable?.[table.schema]?.[table.table] ?? [];
}

export function tableConstraints(
  snapshot: SchemaGraphCatalogSnapshot,
  table: TableRef,
): readonly ConstraintInfo[] {
  return snapshot.constraintsByTable?.[table.schema]?.[table.table] ?? [];
}

export function constraintPayload(
  constraint: ConstraintInfo,
): SchemaGraphConstraintPayload {
  return {
    name: constraint.name,
    constraintType: constraint.constraint_type,
    columns: constraint.columns,
    referenceTable: constraint.reference_table,
    referenceColumns: constraint.reference_columns,
    synthetic: false,
    data: constraint,
  };
}

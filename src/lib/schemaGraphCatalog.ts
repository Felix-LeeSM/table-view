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
  const columns = normalizeNameList(constraint.columns);
  const referenceColumns = normalizeNullableNameList(
    constraint.reference_columns,
  );
  const referenceTable = normalizeNullableText(constraint.reference_table);
  return {
    name: normalizeConstraintName(
      constraint.name,
      constraint.constraint_type,
      columns,
      referenceTable,
    ),
    constraintType: constraint.constraint_type.trim(),
    columns,
    referenceTable,
    referenceColumns,
    synthetic: false,
    data: constraint,
  };
}

function normalizeConstraintName(
  name: string,
  constraintType: string,
  columns: readonly string[],
  referenceTable: string | null,
): string {
  const trimmed = name.trim();
  if (trimmed) return trimmed;
  const typePart = stableNamePart(constraintType) || "constraint";
  const columnPart = columns.map(stableNamePart).filter(Boolean).join("_");
  const referencePart = referenceTable
    ? `_${stableNamePart(referenceTable)}`
    : "";
  return `__unnamed_${typePart}_${columnPart || "table"}${referencePart}`;
}

function normalizeNameList(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function normalizeNullableNameList(
  values: readonly string[] | null,
): readonly string[] | null {
  if (!values) return null;
  const normalized = normalizeNameList(values);
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function stableNamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

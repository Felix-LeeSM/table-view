import type { RuntimeRdbmsDatabaseType } from "@/types/rdbmsDataSources";
import type {
  ColumnInfo,
  ConstraintInfo,
  IndexInfo,
  SchemaInfo,
  TableInfo,
} from "@/types/schema";
import type { SchemaGraphCatalogSnapshot } from "@/types/schemaGraph";

interface BuildSchemaGraphCatalogSnapshotArgs {
  dbType: RuntimeRdbmsDatabaseType;
  database: string;
  schemas: readonly SchemaInfo[];
  tablesBySchema: Readonly<Record<string, readonly TableInfo[]>>;
  columnsByTable: Readonly<
    Record<string, Readonly<Record<string, readonly ColumnInfo[]>>>
  >;
  indexesByTable?: Readonly<
    Record<string, Readonly<Record<string, readonly IndexInfo[]>>>
  >;
  constraintsByTable?: Readonly<
    Record<string, Readonly<Record<string, readonly ConstraintInfo[]>>>
  >;
}

export function buildSchemaGraphCatalogSnapshot({
  dbType,
  database,
  schemas,
  tablesBySchema,
  columnsByTable,
  indexesByTable = {},
  constraintsByTable = {},
}: BuildSchemaGraphCatalogSnapshotArgs): SchemaGraphCatalogSnapshot {
  return {
    source: { dbType, database },
    schemas,
    tablesBySchema,
    columnsByTable,
    indexesByTable,
    constraintsByTable,
  };
}

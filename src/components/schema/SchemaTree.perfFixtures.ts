import type { TableInfo } from "@/types/schema";

export const SCHEMA_TREE_PERF_FIXTURE_COUNTS = {
  oneThousand: 1_000,
  tenThousand: 10_000,
} as const;

export type SchemaTreePerfTableCount =
  (typeof SCHEMA_TREE_PERF_FIXTURE_COUNTS)[keyof typeof SCHEMA_TREE_PERF_FIXTURE_COUNTS];

export interface SchemaTreePerfFixture {
  schemaName: string;
  schemas: Array<{ name: string }>;
  tables: TableInfo[];
}

export function makeSchemaTreePerfTables(
  count: SchemaTreePerfTableCount | number,
  schemaName = "public",
): TableInfo[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `table_${i.toString().padStart(4, "0")}`,
    schema: schemaName,
    row_count: null,
  }));
}

export function makeSchemaTreePerfFixture(
  count: SchemaTreePerfTableCount,
  schemaName = "public",
): SchemaTreePerfFixture {
  return {
    schemaName,
    schemas: [{ name: schemaName }],
    tables: makeSchemaTreePerfTables(count, schemaName),
  };
}

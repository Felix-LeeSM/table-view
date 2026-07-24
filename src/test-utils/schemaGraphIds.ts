/**
 * String-accepting shims for the branded schema-graph id builders (issue #1495,
 * Phase 3). Production brands the `schema` / `table` axes at the Rust-catalog →
 * graph trust boundary (`collectTables` / `sortedTableRefs`); graph tests
 * legitimately compute expected id strings from plain string literals, so these
 * brand the axes in ONE place instead of wrapping every call site. Runtime
 * output is identical to the production builders — brands are erased.
 */
import * as ids from "@/lib/schemaGraphSupport";
import type { SchemaName, TableName } from "@/types/branded";

export const schemaGraphSchemaId = (schema: string): string =>
  ids.schemaGraphSchemaId(schema as SchemaName);

export const schemaGraphTableId = (schema: string, table: string): string =>
  ids.schemaGraphTableId(schema as SchemaName, table as TableName);

export const schemaGraphColumnId = (
  schema: string,
  table: string,
  column: string,
): string =>
  ids.schemaGraphColumnId(schema as SchemaName, table as TableName, column);

export const schemaGraphIndexId = (
  schema: string,
  table: string,
  index: string,
): string =>
  ids.schemaGraphIndexId(schema as SchemaName, table as TableName, index);

export const schemaGraphConstraintId = (
  schema: string,
  table: string,
  constraint: string,
): string =>
  ids.schemaGraphConstraintId(
    schema as SchemaName,
    table as TableName,
    constraint,
  );

import type { ColumnInfo } from "@/types/schema";
import type {
  SchemaGraphConstraintPayload,
  SchemaGraphDiagnosticKind,
  SchemaGraphForeignKeyRelationship,
} from "@/types/schemaGraph";
import type { TableRef } from "./schemaGraphCatalog";
import {
  formatReferenceTable,
  parseFkReference,
  parseReferenceTable,
  type ParsedFkReference,
} from "./schemaGraphSupport";

interface RelationshipDiagnostic {
  readonly kind: SchemaGraphDiagnosticKind;
  readonly details: Readonly<Record<string, string>>;
}

interface NormalizeForeignKeyRelationshipArgs {
  readonly table: TableRef;
  readonly payload: SchemaGraphConstraintPayload;
  readonly getSourceColumn: (column: string) => ColumnInfo | undefined;
}

interface NormalizedForeignKeyRelationship {
  readonly relationship: SchemaGraphForeignKeyRelationship | null;
  readonly diagnostics: readonly RelationshipDiagnostic[];
}

interface ReferenceChoice {
  readonly reference: ParsedFkReference | null;
  readonly columnReferences: readonly ParsedFkReference[];
  readonly rawColumnReferences: readonly string[];
  readonly conflict: RelationshipDiagnostic | null;
}

export function normalizeForeignKeyRelationship({
  table,
  payload,
  getSourceColumn,
}: NormalizeForeignKeyRelationshipArgs): NormalizedForeignKeyRelationship {
  const diagnostics: RelationshipDiagnostic[] = [];
  const sourceColumns = normalizeNameList(payload.columns);
  const referenceChoice = chooseReference(
    table,
    payload,
    sourceColumns,
    getSourceColumn,
  );
  if (referenceChoice.conflict) {
    return {
      relationship: null,
      diagnostics: [referenceChoice.conflict],
    };
  }

  const referenceColumns = chooseReferenceColumns(
    payload,
    sourceColumns,
    referenceChoice.reference,
    referenceChoice.columnReferences,
  );
  if (!referenceChoice.reference || referenceColumns.length === 0) {
    return {
      relationship: null,
      diagnostics: [
        ...diagnostics,
        {
          kind: "invalid-fk-reference",
          details: { schema: table.schema, table: table.table },
        },
      ],
    };
  }
  if (sourceColumns.length !== referenceColumns.length) {
    return {
      relationship: null,
      diagnostics: [
        ...diagnostics,
        {
          kind: "mismatched-fk-column-count",
          details: {
            schema: table.schema,
            table: table.table,
            sourceCount: String(sourceColumns.length),
            referenceCount: String(referenceColumns.length),
          },
        },
      ],
    };
  }

  const targetSchema = referenceChoice.reference.schema ?? table.schema;
  if (!referenceChoice.reference.schema) {
    diagnostics.push({
      kind: "inferred-reference-schema",
      details: {
        schema: table.schema,
        table: table.table,
        referenceTable: referenceChoice.reference.table,
      },
    });
  }

  return {
    relationship: {
      kind: "foreign-key",
      direction: "source-to-target",
      source: {
        schema: table.schema,
        table: table.table,
        columns: sourceColumns,
      },
      target: {
        schema: targetSchema,
        table: referenceChoice.reference.table,
        columns: referenceColumns,
      },
      rawMetadata: {
        constraintName: payload.data?.name ?? payload.name,
        constraintType: payload.data?.constraint_type ?? payload.constraintType,
        sourceColumns: payload.data?.columns ?? payload.columns,
        referenceTable: payload.data?.reference_table ?? payload.referenceTable,
        referenceColumns:
          payload.data?.reference_columns ?? payload.referenceColumns,
        columnReferences: referenceChoice.rawColumnReferences,
        synthetic: payload.synthetic,
      },
    },
    diagnostics,
  };
}

function chooseReference(
  table: TableRef,
  payload: SchemaGraphConstraintPayload,
  sourceColumns: readonly string[],
  getSourceColumn: (column: string) => ColumnInfo | undefined,
): ReferenceChoice {
  const tableReference = payload.referenceTable
    ? parseReferenceTableOrFk(payload.referenceTable)
    : null;
  const rawColumnReferences = sourceColumns
    .map((column) => getSourceColumn(column)?.fk_reference?.trim() ?? "")
    .filter(Boolean);
  const columnReferences = rawColumnReferences
    .map(parseFkReference)
    .filter((reference): reference is ParsedFkReference => reference !== null);
  const columnReference = firstConsistentReference(columnReferences);
  const reference = mergeReference(tableReference, columnReference);
  const conflict =
    tableReference &&
    columnReference &&
    !sameTarget(tableReference, columnReference)
      ? {
          kind: "conflicting-fk-reference" as const,
          details: {
            schema: table.schema,
            table: table.table,
            constraintReference: formatReferenceTable(tableReference),
            columnReference: formatReferenceTable(columnReference),
          },
        }
      : null;

  return { reference, columnReferences, rawColumnReferences, conflict };
}

function chooseReferenceColumns(
  payload: SchemaGraphConstraintPayload,
  sourceColumns: readonly string[],
  reference: ParsedFkReference | null,
  columnReferences: readonly ParsedFkReference[],
): readonly string[] {
  const payloadColumns = normalizeNameList(payload.referenceColumns ?? []);
  if (payloadColumns.length > 0) return payloadColumns;
  if (reference && reference.columns.length > 0) return reference.columns;

  const first = columnReferences[0];
  if (first && first.columns.length === sourceColumns.length) {
    return first.columns;
  }

  const perColumnReferences = columnReferences
    .map((columnReference) => columnReference.columns[0]?.trim() ?? "")
    .filter(Boolean);
  return perColumnReferences.length === sourceColumns.length
    ? perColumnReferences
    : [];
}

function parseReferenceTableOrFk(reference: string): ParsedFkReference {
  return parseFkReference(reference) ?? parseReferenceTable(reference);
}

function mergeReference(
  tableReference: ParsedFkReference | null,
  columnReference: ParsedFkReference | null,
): ParsedFkReference | null {
  if (!tableReference) return columnReference;
  return {
    schema: tableReference.schema ?? columnReference?.schema,
    table: tableReference.table,
    columns: tableReference.columns,
  };
}

function firstConsistentReference(
  references: readonly ParsedFkReference[],
): ParsedFkReference | null {
  const first = references[0];
  if (!first) return null;
  return references.every((reference) => sameTarget(reference, first))
    ? first
    : null;
}

function sameTarget(
  left: ParsedFkReference,
  right: ParsedFkReference,
): boolean {
  if (left.table !== right.table) return false;
  return !left.schema || !right.schema || left.schema === right.schema;
}

function normalizeNameList(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

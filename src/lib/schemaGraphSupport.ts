import type {
  SchemaGraphDiagnostic,
  SchemaGraphDiagnosticKind,
  SchemaGraphEdge,
  SchemaGraphEdgeKind,
} from "@/types/schemaGraph";

export function schemaGraphSchemaId(schema: string): string {
  return `schema:${encodePart(schema)}`;
}

export function schemaGraphTableId(schema: string, table: string): string {
  return `table:${encodePart(schema)}.${encodePart(table)}`;
}

export function schemaGraphColumnId(
  schema: string,
  table: string,
  column: string,
): string {
  return `${schemaGraphTableId(schema, table)}.column:${encodePart(column)}`;
}

export function schemaGraphIndexId(
  schema: string,
  table: string,
  index: string,
): string {
  return `${schemaGraphTableId(schema, table)}.index:${encodePart(index)}`;
}

export function schemaGraphConstraintId(
  schema: string,
  table: string,
  constraint: string,
): string {
  return `${schemaGraphTableId(schema, table)}.constraint:${encodePart(
    constraint,
  )}`;
}

export function addSchemaGraphEdge(
  edges: Map<string, SchemaGraphEdge>,
  kind: SchemaGraphEdgeKind,
  from: string,
  to: string,
  extra: Omit<SchemaGraphEdge, "id" | "kind" | "from" | "to"> = {},
) {
  const qualifier = extra.constraintId ? `${extra.constraintId}:` : "";
  const id = `edge:${kind}:${qualifier}${from}->${to}`;
  edges.set(id, { id, kind, from, to, ...extra });
}

export function addSchemaGraphDiagnostic(
  diagnostics: Map<string, SchemaGraphDiagnostic>,
  kind: SchemaGraphDiagnosticKind,
  subjectId: string,
  details: Readonly<Record<string, string>>,
) {
  const message = diagnosticMessage(kind, details);
  const id = `diag:${kind}:${encodePart(subjectId)}:${encodePart(message)}`;
  diagnostics.set(id, {
    id,
    kind,
    severity: "warning",
    subjectId,
    message,
    details,
  });
}

export function sortByName<T extends { readonly name: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) => compareText(left.name, right.name));
}

export function sortById<T extends { readonly id: string }>(
  values: readonly T[],
): T[] {
  return [...values].sort((left, right) => compareText(left.id, right.id));
}

export function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en");
}

export function isPrimaryKeyConstraint(constraintType: string): boolean {
  return normalizeConstraintType(constraintType) === "primary key";
}

export function isForeignKeyConstraint(constraintType: string): boolean {
  return normalizeConstraintType(constraintType) === "foreign key";
}

export interface ParsedFkReference {
  readonly schema?: string;
  readonly table: string;
  readonly columns: readonly string[];
}

export function parseReferenceTable(referenceTable: string): ParsedFkReference {
  const dot = referenceTable.lastIndexOf(".");
  if (dot < 0) return { table: referenceTable, columns: [] };
  return {
    schema: referenceTable.slice(0, dot),
    table: referenceTable.slice(dot + 1),
    columns: [],
  };
}

export function parseFkReference(reference: string): ParsedFkReference | null {
  const open = reference.indexOf("(");
  const close = reference.lastIndexOf(")");
  if (open <= 0 || close <= open) return null;
  const parsedTable = parseReferenceTable(reference.slice(0, open));
  const columns = reference
    .slice(open + 1, close)
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
  return columns.length > 0 ? { ...parsedTable, columns } : null;
}

export function formatReferenceTable(reference: ParsedFkReference): string {
  return reference.schema
    ? `${reference.schema}.${reference.table}`
    : reference.table;
}

function diagnosticMessage(
  kind: SchemaGraphDiagnosticKind,
  details: Readonly<Record<string, string>>,
): string {
  switch (kind) {
    case "inferred-reference-schema":
      return `Foreign key reference table '${details.referenceTable}' has no schema; '${details.schema}' was assumed.`;
    case "invalid-fk-reference":
      return "Foreign key is missing a usable reference table or columns.";
    case "missing-reference-table":
      return `Foreign key references missing table '${details.referenceTable}'.`;
    case "missing-reference-column":
      return `Foreign key references missing column '${details.referenceColumn ?? details.sourceColumn}'.`;
    case "missing-source-column":
      return `Foreign key references missing source column '${details.sourceColumn}'.`;
    case "missing-index-column":
      return `Index references missing column '${details.column}'.`;
    case "missing-constraint-column":
      return `Constraint references missing column '${details.column}'.`;
  }
}

function encodePart(part: string): string {
  return encodeURIComponent(part).replaceAll(".", "%2E");
}

function normalizeConstraintType(constraintType: string): string {
  return constraintType.toLowerCase().replaceAll("_", " ").trim();
}

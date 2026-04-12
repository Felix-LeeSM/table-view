export interface SchemaInfo {
  name: string;
}

export interface TableInfo {
  name: string;
  schema: string;
  row_count: number | null;
}

export interface ColumnInfo {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_foreign_key: boolean;
  fk_reference: string | null;
  comment: string | null;
}

export interface IndexInfo {
  name: string;
  columns: string[];
  index_type: string;
  is_unique: boolean;
  is_primary: boolean;
}

export interface ConstraintInfo {
  name: string;
  constraint_type: string;
  columns: string[];
  reference_table: string | null;
  reference_columns: string[] | null;
}

export interface TableData {
  columns: ColumnInfo[];
  rows: unknown[][];
  total_count: number;
  page: number;
  page_size: number;
  executed_query: string;
}

export type FilterOperator =
  | "Eq"
  | "Neq"
  | "Gt"
  | "Lt"
  | "Gte"
  | "Lte"
  | "Like"
  | "IsNull"
  | "IsNotNull";

export type FilterMode = "structured" | "raw";

export interface FilterCondition {
  column: string;
  operator: FilterOperator;
  value: string | null;
  id: string;
}

/**
 * Validate a raw SQL WHERE clause for dangerous patterns.
 * Returns an error message string if validation fails, or null if the input is safe.
 */
export interface SortInfo {
  column: string;
  direction: "ASC" | "DESC";
}

export function validateRawSql(sql: string): string | null {
  const trimmed = sql.trim();
  if (!trimmed) return null;
  if (trimmed.includes(";")) {
    return "Raw WHERE clause must not contain semicolons";
  }
  const upper = trimmed.toUpperCase();
  const dangerous = [
    "DROP",
    "DELETE",
    "INSERT",
    "UPDATE",
    "ALTER",
    "CREATE",
    "TRUNCATE",
    "GRANT",
    "REVOKE",
  ];
  for (const kw of dangerous) {
    if (upper.startsWith(kw)) {
      return `Raw WHERE clause must not start with ${kw}`;
    }
  }
  return null;
}

// ── Schema change types ────────────────────────────────────────────────

export type ColumnChange =
  | {
      type: "add";
      name: string;
      data_type: string;
      nullable: boolean;
      default_value: string | null;
    }
  | {
      type: "modify";
      name: string;
      new_data_type: string | null;
      new_nullable: boolean | null;
      new_default_value: string | null;
    }
  | {
      type: "drop";
      name: string;
    };

export interface AlterTableRequest {
  connection_id: string;
  schema: string;
  table: string;
  changes: ColumnChange[];
  preview_only?: boolean;
}

export interface CreateIndexRequest {
  connection_id: string;
  schema: string;
  table: string;
  index_name: string;
  columns: string[];
  index_type: string;
  is_unique?: boolean;
  preview_only?: boolean;
}

export interface DropIndexRequest {
  connection_id: string;
  schema: string;
  index_name: string;
  if_exists?: boolean;
  preview_only?: boolean;
}

export type ConstraintDefinition =
  | {
      type: "primary_key";
      columns: string[];
    }
  | {
      type: "foreign_key";
      columns: string[];
      reference_table: string;
      reference_columns: string[];
    }
  | {
      type: "unique";
      columns: string[];
    }
  | {
      type: "check";
      expression: string;
    };

export interface AddConstraintRequest {
  connection_id: string;
  schema: string;
  table: string;
  constraint_name: string;
  definition: ConstraintDefinition;
  preview_only?: boolean;
}

export interface DropConstraintRequest {
  connection_id: string;
  schema: string;
  table: string;
  constraint_name: string;
  preview_only?: boolean;
}

export interface SchemaChangeResult {
  sql: string;
}

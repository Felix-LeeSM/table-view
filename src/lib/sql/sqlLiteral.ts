/**
 * Data type family for SQL literal emission. Mirrors, but is distinct from,
 * `classifyDataType` in `useDataGridEdit.ts` because seeding and literal
 * emission have slightly different concerns: seeding cares about "what
 * printable first character makes sense?", literal emission cares about "how
 * do I serialize this string to SQL?". The two share the
 * timestamp-before-time ordering rule (`timestamp` contains `time` as a
 * substring).
 */
export type SqlTypeFamily =
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "timestamp"
  | "time"
  | "uuid"
  | "textual"
  | "unknown";

export type SqlDialect = "postgresql" | "mysql" | "sqlite" | "mssql" | "oracle";

/** Map a connection `dbType` to a SQL identifier/literal dialect. Redis /
 *  unsupported types fall through to `undefined` (callers default). */
export function dialectFromDbType(
  dbType: string | undefined,
): SqlDialect | undefined {
  if (dbType === "postgresql") return "postgresql";
  if (dbType === "mysql" || dbType === "mariadb") return "mysql";
  if (dbType === "sqlite") return "sqlite";
  if (dbType === "mssql") return "mssql";
  if (dbType === "oracle") return "oracle";
  return undefined;
}

/**
 * Textual data types that preserve `''` as an empty string literal (ADR 0009).
 * Anything outside this set coerces empty string to `NULL` on commit. Oracle is
 * the exception: the server treats `''` as NULL, so emit `NULL` explicitly.
 */
function isTextualFamily(family: SqlTypeFamily): boolean {
  return family === "textual";
}

/**
 * Classify a column's data type into a SQL-literal family. Matching rules:
 * - Case-insensitive.
 * - `timestamp`/`timestamptz`/`datetime` MUST be checked before `time` because
 *   `timestamp` contains `time` as a substring.
 * - Integer family checked before numeric so `bigint` etc. don't fall through
 *   to a future contains-check on "int" inside numeric.
 * - Textual family explicitly listed (ADR 0009) so unknown types fall to
 *   `"unknown"` and keep the legacy escape path (safer default).
 */
export function classifySqlType(
  dataType: string,
  dialect?: SqlDialect,
): SqlTypeFamily {
  const lower = dataType.toLowerCase();
  if (lower.includes("timestamp") || lower.includes("datetime")) {
    return "timestamp";
  }
  if (lower === "date") return "date";
  if (lower.includes("time")) return "time";
  if (dialect === "mssql" && lower === "bit") return "boolean";
  if (lower === "bool" || lower.includes("boolean")) return "boolean";
  if (lower.includes("uuid")) return "uuid";
  if (
    dialect === "oracle" &&
    (lower === "number" ||
      /^number\(\s*\d+\s*,\s*0\s*\)$/.test(lower) ||
      lower === "binary_integer" ||
      lower === "pls_integer")
  ) {
    return "integer";
  }
  if (
    lower.includes("int") ||
    lower === "serial" ||
    lower === "bigserial" ||
    lower === "smallserial"
  ) {
    return "integer";
  }
  if (
    lower.includes("numeric") ||
    lower.includes("decimal") ||
    lower.includes("float") ||
    lower.includes("double") ||
    lower.includes("real") ||
    (dialect === "oracle" && lower.startsWith("number("))
  ) {
    return "numeric";
  }
  // Textual set per ADR 0009. These preserve `''` on commit. `bpchar` is
  // PostgreSQL's internal name for `char(n)`; `character varying` is the
  // long-form `varchar`.
  if (
    lower === "text" ||
    lower.includes("varchar") ||
    lower === "char" ||
    lower === "bpchar" ||
    lower.includes("character") ||
    lower === "citext" ||
    lower === "string" ||
    lower === "json" ||
    lower === "jsonb" ||
    (dialect === "oracle" &&
      (lower === "varchar2" ||
        lower === "nvarchar2" ||
        lower === "nchar" ||
        lower === "clob" ||
        lower === "nclob" ||
        lower === "long" ||
        lower === "rowid" ||
        lower === "urowid"))
  ) {
    return "textual";
  }
  return "unknown";
}

/**
 * Result of `coerceToSqlLiteral`. On success `sql` is the ready-to-splice SQL
 * fragment (e.g. `42`, `'2026-04-24'`, `NULL`, `TRUE`). On failure `message` is
 * a user-readable validation error that the UI surfaces as an inline hint.
 */
export type CoerceResult =
  | { kind: "sql"; sql: string }
  | { kind: "error"; message: string };

export function escapeSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteDoubleSqlIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function quoteMysqlIdentifier(value: string): string {
  return `\`${value.replace(/`/g, "``")}\``;
}

function quoteMssqlIdentifier(value: string): string {
  return `[${value.replace(/]/g, "]]")}]`;
}

export interface SqlIdentifierOptions {
  /**
   * ANSI-quote PostgreSQL identifiers (`"Name"`) instead of leaving them bare.
   * Default `false`: the structured grid path tolerates Postgres case-folding.
   * DDL / raw-edit / DuckDB / completion set `true` so mixed-case + special
   * chars survive the round-trip. No effect on other dialects (already quoted).
   */
  quotePostgres?: boolean;
}

/**
 * Canonical SQL identifier quoter (#1357). Single source of truth for the
 * per-dialect quote character and escape rule — a security boundary, so it
 * lives in exactly one place. Postgres is bare by default; pass
 * `{ quotePostgres: true }` for callers that must preserve the exact name.
 */
export function sqlIdentifier(
  value: string,
  dialect: SqlDialect,
  opts?: SqlIdentifierOptions,
): string {
  if (dialect === "mysql") return quoteMysqlIdentifier(value);
  if (dialect === "sqlite") return quoteDoubleSqlIdentifier(value);
  if (dialect === "mssql") return quoteMssqlIdentifier(value);
  if (dialect === "oracle") return quoteDoubleSqlIdentifier(value);
  return opts?.quotePostgres ? quoteDoubleSqlIdentifier(value) : value;
}

export function qualifiedTableName(
  schema: string,
  table: string,
  dialect: SqlDialect,
): string {
  if (dialect === "postgresql") {
    return schema ? `${schema}.${table}` : table;
  }
  return schema
    ? `${sqlIdentifier(schema, dialect)}.${sqlIdentifier(table, dialect)}`
    : sqlIdentifier(table, dialect);
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ORACLE_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}$/;
// Accepts `YYYY-MM-DDTHH:MM[:SS[.fff]][Z|+-HH:MM]`; the `T` may also be a
// space to match SQL-style inputs the user might copy in from psql. Oracle's
// runtime returns timestamp-with-time-zone values as `... +HH:MM`, so allow one
// space before the offset.
const ISO_DATETIME_RE =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s?(?:Z|[+-]\d{2}:?\d{2}))?$/;
const TIME_RE = /^\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Integers: optional leading `-`, then one or more digits. No `+`, no leading
// zeros restriction (PostgreSQL accepts `042` as 42), no decimals.
const INTEGER_RE = /^-?\d+$/;
// Numeric: optional leading `-`, then digits with optional decimal portion.
// Accepts `.5`, `-.5`, `3.`, `3.14`, `-3`, `0`. Disallows empty and bare `-`.
// Scientific notation (`1e3`) is intentionally rejected; it's rarely what a
// TablePlus-style cell editor user types, and PostgreSQL accepts it only in
// some contexts; keep the accept surface tight for the first pass.
export const NUMERIC_RE = /^-?(?:\d+\.?\d*|\.\d+)$/;

function oracleDateTimeLiteral(value: string): string {
  return value.replace("T", " ");
}

function isOracleTimestampWithTimeZone(dataType: string): boolean {
  const normalized = dataType.toLowerCase().replace(/\s+/g, " ");
  return (
    normalized.includes("timestamp") &&
    normalized.includes("with time zone") &&
    !normalized.includes("local time zone")
  );
}

function normalizeOracleTimestampTz(value: string): string {
  return oracleDateTimeLiteral(value)
    .replace(/\s*Z$/i, " +00:00")
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2")
    .replace(/\s*([+-]\d{2}:\d{2})$/, " $1");
}

function oracleTimestampTzFormat(value: string): string {
  return /\.\d+(?:\s?(?:Z|[+-]\d{2}:?\d{2}))$/i.test(value)
    ? "YYYY-MM-DD HH24:MI:SS.FF TZH:TZM"
    : "YYYY-MM-DD HH24:MI:SS TZH:TZM";
}

/**
 * Coerce a user-entered edit value to a SQL literal, given the column's
 * declared data type. Pure function: no I/O, no state, so it can be tested
 * in isolation and reused across UPDATE and (future) INSERT paths.
 *
 * Tri-state rule (ADR 0009):
 * - `null` -> `NULL` regardless of type.
 * - `""` + textual family -> `''` (preserved), except Oracle -> `NULL`.
 * - `""` + non-textual family -> `NULL` (empty picker = explicit clear).
 *
 * Valid input examples per family:
 * - integer: `"42"` -> `42`.
 * - numeric: `"3.14"`, `"-1"`, `".5"` -> unquoted.
 * - boolean: `"true"/"t"/"1"` -> `TRUE`; `"false"/"f"/"0"` -> `FALSE` (CI).
 * - date: `"2026-04-24"` -> `'2026-04-24'`.
 * - timestamp: `"2026-04-24T10:00:00Z"` (or space-separated) -> quoted.
 * - time: `"10:00"` / `"10:00:00"` -> quoted.
 * - uuid: 36-char canonical form -> quoted.
 * - textual: O'Brien -> `'O''Brien'`.
 * - unknown family: legacy escape path (quoted + single-quote escape) for
 *   types the classifier doesn't know yet (`money`, `bytea`, ...).
 */
export function coerceToSqlLiteral(
  value: string | null,
  dataType: string,
  dialect?: SqlDialect,
): CoerceResult {
  if (value === null) return { kind: "sql", sql: "NULL" };
  const family = classifySqlType(dataType, dialect);

  // Empty-string branch: preserved for textual families, collapsed to NULL for
  // the rest. Oracle collapses every empty string to NULL at execution time, so
  // generated SQL makes that clear instead of emitting a misleading `''`.
  if (value === "") {
    if (dialect === "oracle") return { kind: "sql", sql: "NULL" };
    if (isTextualFamily(family) || family === "unknown") {
      return { kind: "sql", sql: "''" };
    }
    return { kind: "sql", sql: "NULL" };
  }

  switch (family) {
    case "integer": {
      if (INTEGER_RE.test(value)) return { kind: "sql", sql: value };
      return { kind: "error", message: `Expected integer, got "${value}"` };
    }
    case "numeric": {
      if (NUMERIC_RE.test(value)) return { kind: "sql", sql: value };
      return { kind: "error", message: `Expected numeric, got "${value}"` };
    }
    case "boolean": {
      const lower = value.toLowerCase();
      if (lower === "true" || lower === "t" || lower === "1") {
        if (dialect === "mssql") return { kind: "sql", sql: "1" };
        return { kind: "sql", sql: "TRUE" };
      }
      if (lower === "false" || lower === "f" || lower === "0") {
        if (dialect === "mssql") return { kind: "sql", sql: "0" };
        return { kind: "sql", sql: "FALSE" };
      }
      return { kind: "error", message: `Expected boolean, got "${value}"` };
    }
    case "date": {
      if (ISO_DATE_RE.test(value)) {
        if (dialect === "oracle") {
          return { kind: "sql", sql: `DATE ${escapeSqlString(value)}` };
        }
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      if (dialect === "oracle" && ORACLE_DATE_TIME_RE.test(value)) {
        return {
          kind: "sql",
          sql: `TO_DATE(${escapeSqlString(oracleDateTimeLiteral(value))}, 'YYYY-MM-DD HH24:MI:SS')`,
        };
      }
      return {
        kind: "error",
        message: `Expected date (YYYY-MM-DD), got "${value}"`,
      };
    }
    case "timestamp": {
      if (ISO_DATETIME_RE.test(value)) {
        if (dialect === "oracle") {
          if (isOracleTimestampWithTimeZone(dataType)) {
            const normalized = normalizeOracleTimestampTz(value);
            return {
              kind: "sql",
              sql: `TO_TIMESTAMP_TZ(${escapeSqlString(normalized)}, '${oracleTimestampTzFormat(value)}')`,
            };
          }
          const normalized = value
            .replace("T", " ")
            .replace(/\s?(?:Z|[+-]\d{2}:?\d{2})$/, "");
          return {
            kind: "sql",
            sql: `TIMESTAMP ${escapeSqlString(normalized)}`,
          };
        }
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return {
        kind: "error",
        message: `Expected timestamp (YYYY-MM-DD HH:MM[:SS]), got "${value}"`,
      };
    }
    case "time": {
      if (TIME_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return {
        kind: "error",
        message: `Expected time (HH:MM[:SS]), got "${value}"`,
      };
    }
    case "uuid": {
      if (UUID_RE.test(value)) {
        return { kind: "sql", sql: escapeSqlString(value) };
      }
      return { kind: "error", message: `Expected UUID, got "${value}"` };
    }
    case "textual":
    case "unknown":
    default:
      // Legacy path: single-quote escape. ADR 0009 preserves empty-string
      // textual cells via the `value === ""` branch above.
      return { kind: "sql", sql: escapeSqlString(value) };
  }
}

/**
 * Postgres ARRAY element type extracted from a column `data_type`. Accepts
 * both the public `text[]` form and the internal `_text` form Postgres returns
 * from `information_schema`.
 */
export function arrayElementType(dataType: string): string | null {
  const lower = dataType.toLowerCase().trim();
  if (lower.endsWith("[]")) return lower.slice(0, -2);
  if (lower.startsWith("_")) return lower.slice(1);
  return null;
}

/**
 * Stringify a JS value (the raw cell array's element) into a SQL literal
 * compatible with `coerceToSqlLiteral`'s output. Mirrors the WHERE-clause
 * literal helper but uses family-aware quoting so untouched elements round-trip
 * cleanly.
 */
export function arrayElementToLiteral(
  value: unknown,
  family: SqlTypeFamily,
): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" || typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return escapeSqlString(value.toISOString());
  }
  const stringy = typeof value === "string" ? value : String(value);
  if (family === "integer" || family === "numeric" || family === "boolean") {
    // Numeric families assume the value already prints as a number.
    return stringy;
  }
  return escapeSqlString(stringy);
}

import { useMemo } from "react";
import { SQLNamespace, type SQLDialect } from "@codemirror/lang-sql";
import type { Completion } from "@codemirror/autocomplete";
import { useSchemaStore } from "@stores/schemaStore";
import type { DatabaseType } from "@/types/connection";
import { keywords as PG_KEYWORDS } from "@/lib/completion/pg";
import { keywords as MYSQL_KEYWORDS } from "@/lib/completion/mysql";
import { keywords as SQLITE_KEYWORDS } from "@/lib/completion/sqlite";

/**
 * Resolve the dialect-specific keyword list. Returns `[]` for non-RDB
 * types — the SQL editor never mounts for them.
 */
function keywordsForDbType(dbType: DatabaseType): readonly string[] {
  switch (dbType) {
    case "postgresql":
      return PG_KEYWORDS;
    case "mysql":
      return MYSQL_KEYWORDS;
    case "sqlite":
      return SQLITE_KEYWORDS;
    case "mongodb":
    case "redis":
      return [];
    default: {
      const _exhaust: never = dbType;
      return _exhaust;
    }
  }
}

/** Common SQL functions exposed as autocomplete candidates. */
const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "NULLIF",
  "CAST",
  "CONCAT",
  "LENGTH",
  "UPPER",
  "LOWER",
  "TRIM",
  "SUBSTRING",
  "EXTRACT",
  "DATE_TRUNC",
  "NOW",
  "CURRENT_TIMESTAMP",
];

/** Explicit test-only overrides: `table → column names`. */
export type TableColumnOverrides = Record<string, string[]>;

export interface UseSqlAutocompleteOptions {
  /** Explicit test-only override: `table → column names`. */
  tableColumns?: TableColumnOverrides;
  /**
   * SQL dialect of the active connection. Drives quoting for mixed-case
   * identifiers (backticks for MySQL, double-quotes for Postgres /
   * SQLite). Optional — without it, only the bare label is emitted.
   */
  dialect?: SQLDialect;
  /**
   * Connection `db_type`. When supplied, surfaces dialect-specific SQL
   * keywords (e.g. `RETURNING` for PG, `AUTO_INCREMENT` for MySQL,
   * `PRAGMA` for SQLite). Without it the keyword list is skipped.
   */
  dbType?: DatabaseType;
}

/**
 * Backwards-compatible second-argument shape. Legacy callers passed a
 * plain `Record<string, string[]>` override; the structured options
 * object is the modern shape. Disambiguation runs via `Array.isArray`
 * on the values so both call sites stay supported.
 */
type AutocompleteArg = TableColumnOverrides | UseSqlAutocompleteOptions;

function normalizeOptions(
  arg: AutocompleteArg | undefined,
): UseSqlAutocompleteOptions {
  if (!arg) return {};
  // A `TableColumnOverrides` record has only string[] values. A structured
  // options object has non-array values (`dialect`, `tableColumns`). If any
  // own value is an array, treat the whole thing as the legacy record shape.
  const values = Object.values(arg);
  const looksLikeLegacyRecord =
    values.length > 0 && values.every((v) => Array.isArray(v));
  if (looksLikeLegacyRecord) {
    return { tableColumns: arg as TableColumnOverrides };
  }
  // An empty record (`{}`) lands here as "no overrides".
  return arg as UseSqlAutocompleteOptions;
}

/** Character CodeMirror uses to quote identifiers for a given dialect.
 * Dialect metadata lives on `dialect.spec.identifierQuotes` (e.g. `` "`" ``
 * for MySQL, `\"` for Postgres / SQLite). Falls back to the ANSI double-quote
 * when the dialect is unknown or doesn't define one. */
function quoteCharForDialect(dialect: SQLDialect | undefined): string {
  const quotes = dialect?.spec?.identifierQuotes;
  return quotes && quotes.length > 0 ? quotes[0]! : '"';
}

/** True when `name` contains characters that require quoting (upper-case
 * letters, spaces, or anything outside the typical identifier character set).
 * Lowercase alphanumerics + underscore are considered safe. */
function identifierNeedsQuoting(name: string): boolean {
  return !/^[a-z_][a-z0-9_]*$/.test(name);
}

/**
 * Builds a CodeMirror SQLNamespace from the schema store data for a given connection.
 *
 * Top-level entries:
 * - SQL function names (uppercase) → empty namespace
 * - Unqualified table/view names (e.g. `users`) → column namespace
 * - Schema-qualified names (e.g. `public.users`) → column namespace
 *
 * Column candidates are sourced from `schemaStore.tableColumnsCache`, which is
 * populated whenever a Structure tab or DataGrid loads its columns. An optional
 * `tableColumns` override is still accepted for tests or callers that wish to
 * inject explicit values.
 *
 * When a SQL dialect is supplied, mixed-case identifiers (e.g. `"Users"`)
 * also get a quoted completion candidate so the inserted identifier
 * round-trips through case-sensitive catalogs intact.
 *
 * @param connectionId The active connection identifier.
 * @param arg Either a legacy `Record<string, string[]>` override or
 *            the structured `UseSqlAutocompleteOptions` shape.
 */
export function useSqlAutocomplete(
  connectionId: string,
  arg?: AutocompleteArg,
): SQLNamespace {
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const columnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const opts = normalizeOptions(arg);
  const { tableColumns, dialect, dbType } = opts;

  return useMemo(() => {
    const ns: Record<string, SQLNamespace> = {};

    // SQL functions and keywords. Both are wrapped in `{ self, children }`
    // so CodeMirror's `nameCompletion` does NOT auto-quote them: its
    // default rule wraps any label that contains uppercase letters in the
    // dialect's identifier quote (`"SELECT"` for PG / SQLite). Keywords
    // and functions are reserved tokens, not identifiers — quoting them
    // turns `SELECT` into a string literal at parse time.
    const reservedToken = (
      label: string,
      type: string,
    ): { self: Completion; children: SQLNamespace } => ({
      self: { label, type, apply: label },
      children: {},
    });

    for (const fn of SQL_FUNCTIONS) {
      ns[fn] = reservedToken(fn, "function");
    }

    // Surface dialect-specific SQL keywords alongside tables / views /
    // functions. Skipped when no dbType is supplied.
    if (dbType !== undefined) {
      for (const kw of keywordsForDbType(dbType)) {
        // Avoid clobbering an existing entry (e.g. `SELECT` would never
        // collide with a table name, but stay defensive).
        if (!(kw in ns)) ns[kw] = reservedToken(kw, "keyword");
      }
    }

    // Build a lookup of cached columns for *this* connection, indexed by
    // both unqualified table name and schema-qualified name.
    const cachedColumnsByName: Record<
      string,
      Record<string, SQLNamespace>
    > = {};
    const prefix = `${connectionId}:`;
    for (const [key, columns] of Object.entries(columnsCache)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length); // "schema:table"
      const sepIdx = rest.indexOf(":");
      if (sepIdx === -1) continue;
      const schemaName = rest.slice(0, sepIdx);
      const tableName = rest.slice(sepIdx + 1);
      const colNs: Record<string, SQLNamespace> = {};
      for (const c of columns) colNs[c.name] = {};
      cachedColumnsByName[tableName] = colNs;
      cachedColumnsByName[`${schemaName}.${tableName}`] = colNs;
    }

    // Helper: pick columns for a given object name. Explicit `tableColumns`
    // override beats the cache so tests can stub deterministically.
    const pickColumns = (
      objectName: string,
      qualifiedName: string,
    ): Record<string, SQLNamespace> => {
      if (tableColumns && tableColumns[objectName]) {
        const colNs: Record<string, SQLNamespace> = {};
        for (const c of tableColumns[objectName]!) colNs[c] = {};
        return colNs;
      }
      return (
        cachedColumnsByName[qualifiedName] ??
        cachedColumnsByName[objectName] ??
        {}
      );
    };

    // For mixed-case names, emit a dialect-quoted alias alongside the
    // bare label — the bare form breaks against case-sensitive catalogs.
    const quoteChar = quoteCharForDialect(dialect);
    const addQuotedAlias = (
      bareName: string,
      colNs: Record<string, SQLNamespace>,
    ) => {
      if (!dialect) return;
      if (!identifierNeedsQuoting(bareName)) return;
      const quoted = `${quoteChar}${bareName}${quoteChar}`;
      if (!ns[quoted]) {
        ns[quoted] = {
          self: {
            label: quoted,
            apply: quoted,
            type: "type",
          },
          children: colNs,
        };
      }
    };

    // Tables
    for (const [key, tableList] of Object.entries(tables)) {
      if (!key.startsWith(`${connectionId}:`)) continue;
      const schemaName = key.slice(connectionId.length + 1);
      for (const table of tableList) {
        const qualified = `${schemaName}.${table.name}`;
        const colNs = pickColumns(table.name, qualified);
        ns[table.name] = colNs;
        ns[qualified] = colNs;
        addQuotedAlias(table.name, colNs);
      }
    }

    // Views — exposed identically so `SELECT * FROM active_users` autocompletes
    for (const [key, viewList] of Object.entries(views)) {
      if (!key.startsWith(`${connectionId}:`)) continue;
      const schemaName = key.slice(connectionId.length + 1);
      for (const v of viewList) {
        const qualified = `${schemaName}.${v.name}`;
        const colNs = pickColumns(v.name, qualified);
        // Don't overwrite a table of the same name (rare but possible)
        if (!ns[v.name]) ns[v.name] = colNs;
        if (!ns[qualified]) ns[qualified] = colNs;
        addQuotedAlias(v.name, colNs);
      }
    }

    return ns as SQLNamespace;
  }, [
    tables,
    views,
    columnsCache,
    connectionId,
    tableColumns,
    dialect,
    dbType,
  ]);
}

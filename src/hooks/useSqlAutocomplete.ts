import { useMemo } from "react";
import { SQLNamespace, type SQLDialect } from "@codemirror/lang-sql";
import { useSchemaStore } from "@stores/schemaStore";
import type { DatabaseType } from "@/types/connection";
import { keywords as PG_KEYWORDS } from "@/lib/completion/pg";
import { keywords as MYSQL_KEYWORDS } from "@/lib/completion/mysql";
import { keywords as SQLITE_KEYWORDS } from "@/lib/completion/sqlite";

/**
 * Sprint 145 — resolve the dialect-specific keyword list via the new
 * per-DBMS completion modules. Behaves identically to the previous
 * `getKeywordsForDialect` helper for RDB types and returns an empty list
 * for non-RDB types (the SQL editor never mounts for them).
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
   * Sprint 82 — the SQL dialect of the active connection. The hook uses it to
   * decide how to apply mixed-case identifiers (backticks for MySQL,
   * double-quotes for Postgres / SQLite). When omitted the hook behaves
   * identically to pre-Sprint-82 callers.
   */
  dialect?: SQLDialect;
  /**
   * Sprint 139 — the connection's `db_type`. When supplied the hook surfaces
   * dialect-specific SQL keywords (e.g. `RETURNING` / `ILIKE` for PG,
   * `AUTO_INCREMENT` / `REPLACE INTO` for MySQL, `PRAGMA` / `WITHOUT ROWID`
   * for SQLite). When omitted the namespace skips the keyword list entirely
   * so pre-Sprint-139 callers see no behavioural change.
   */
  dbType?: DatabaseType;
}

/**
 * Backwards-compatible second-argument shape. Pre-Sprint-82 callers passed a
 * plain `Record<string, string[]>` override; Sprint 82 widens this to either
 * the same record (detected via `Array.isArray` of any value) or a structured
 * `UseSqlAutocompleteOptions` object. This keeps existing tests and call
 * sites working without touching them.
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
  // Empty record is treated as "no overrides" under the options shape. An
  // empty record from tests (`{}`) reaches this branch and returns `{}`,
  // which is exactly the pre-Sprint-82 behaviour.
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
 * Sprint 82 extends the hook to accept a SQL dialect hint. When a mixed-case
 * identifier is present (e.g. `"Users"`), the hook emits an extra completion
 * candidate whose `apply` string is quoted with the dialect's quote character
 * (`` `Users` `` for MySQL, `"Users"` for Postgres / SQLite) so the inserted
 * identifier round-trips through the server intact.
 *
 * @param connectionId The active connection identifier.
 * @param arg Either a legacy `Record<string, string[]>` override (kept for
 *            backwards-compatibility with pre-Sprint-82 callers) or the
 *            structured `UseSqlAutocompleteOptions` shape.
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ns: Record<string, any> = {};

    // SQL functions and keywords. Both are wrapped in `{ self, children }`
    // so CodeMirror's `nameCompletion` does NOT auto-quote them: its
    // default rule wraps any label that contains uppercase letters in the
    // dialect's identifier quote (`"SELECT"` for PG / SQLite). Keywords
    // and functions are reserved tokens, not identifiers — quoting them
    // turns `SELECT` into a string literal at parse time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reservedToken = (label: string, type: string): any => ({
      self: { label, type, apply: label },
      children: {},
    });

    for (const fn of SQL_FUNCTIONS) {
      ns[fn] = reservedToken(fn, "function");
    }

    // Sprint 139 — surface dialect-specific SQL keywords as top-level
    // namespace entries so the autocomplete popup offers them alongside
    // tables / views / functions. Pre-Sprint-139 callers (no dbType)
    // skip this branch and see no behavioural change.
    if (dbType !== undefined) {
      for (const kw of keywordsForDbType(dbType)) {
        // Avoid clobbering an existing entry (e.g. `SELECT` would never
        // collide with a table name, but stay defensive).
        if (!(kw in ns)) ns[kw] = reservedToken(kw, "keyword");
      }
    }

    // Build a lookup of cached columns for *this* connection, indexed by
    // both unqualified table name and schema-qualified name.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cachedColumnsByName: Record<string, Record<string, any>> = {};
    const prefix = `${connectionId}:`;
    for (const [key, columns] of Object.entries(columnsCache)) {
      if (!key.startsWith(prefix)) continue;
      const rest = key.slice(prefix.length); // "schema:table"
      const sepIdx = rest.indexOf(":");
      if (sepIdx === -1) continue;
      const schemaName = rest.slice(0, sepIdx);
      const tableName = rest.slice(sepIdx + 1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const colNs: Record<string, any> = {};
      for (const c of columns) colNs[c.name] = {};
      cachedColumnsByName[tableName] = colNs;
      cachedColumnsByName[`${schemaName}.${tableName}`] = colNs;
    }

    // Helper: pick columns for a given object name. Explicit `tableColumns`
    // override beats the cache so tests can stub deterministically.
    const pickColumns = (
      objectName: string,
      qualifiedName: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ): Record<string, any> => {
      if (tableColumns && tableColumns[objectName]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const colNs: Record<string, any> = {};
        for (const c of tableColumns[objectName]!) colNs[c] = {};
        return colNs;
      }
      return (
        cachedColumnsByName[qualifiedName] ??
        cachedColumnsByName[objectName] ??
        {}
      );
    };

    // Sprint 82 — when a dialect is supplied, emit an additional quoted-
    // identifier candidate for every mixed-case table/view name so the
    // autocomplete popup surfaces both the bare label (which breaks at the
    // server for case-sensitive catalogs) and the dialect-quoted label.
    const quoteChar = quoteCharForDialect(dialect);
    const addQuotedAlias = (
      bareName: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      colNs: Record<string, any>,
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

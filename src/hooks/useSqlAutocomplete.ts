import { useMemo } from "react";
import { SQLNamespace, type SQLDialect } from "@codemirror/lang-sql";
import type { Completion } from "@codemirror/autocomplete";
import { useSchemaStore } from "@stores/schemaStore";
import type { DatabaseType } from "@/types/connection";

// Sprint 302 (2026-05-14) — keyword 책임은 lang-sql 의
// `keywordCompletionSource` 가 dialect.dialect.words 기반으로 단독 수행.
// 본래 ns 에 reservedToken 으로 keyword 를 직접 inject 했으나, 그 결과
// `schemaCompletionSource` 도 ns 의 self 를 emit + `keywordCompletionSource`
// 도 dialect 의 keyword 를 emit 해 같은 라벨이 popup 에 두 번 노출됐다
// (사용자 보고: "SELECT 가 2번 뜬다"). lang-sql 의 dialect 정의가 우리가
// 이전에 inject 했던 keyword set 의 superset 이고 auto-quote 도 발생하지
// 않으므로 (defaultKeyword = (label, type) => ({ label, type, boost: -1 })),
// ns 의 inject 책임은 제거됐다.

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
   * Connection `db_type`. Sprint 302 이후로는 keyword surface 책임이
   * lang-sql 의 `keywordCompletionSource` 로 이관되었으므로 이 옵션은
   * keyword 라우팅에는 영향이 없다. ts 시그니처는 backwards-compat 을
   * 위해 유지하며, 향후 다른 dialect-specific 분기에 활용될 자리로 둔다.
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
 * @param db The active database name. Sprint 263 — schemaStore caches are
 *           now keyed by `(connId, db)`, so the namespace is scoped to a
 *           single workspace's catalog.
 * @param arg Either a legacy `Record<string, string[]>` override or
 *            the structured `UseSqlAutocompleteOptions` shape.
 */
export function useSqlAutocomplete(
  connectionId: string,
  db: string,
  arg?: AutocompleteArg,
): SQLNamespace {
  const tables = useSchemaStore((s) => s.tables);
  const views = useSchemaStore((s) => s.views);
  const columnsCache = useSchemaStore((s) => s.tableColumnsCache);
  const opts = normalizeOptions(arg);
  const { tableColumns, dialect } = opts;

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

    // Sprint 302 — keyword inject 제거. lang-sql 의 dialect 자체
    // `keywordCompletionSource` 가 dialect.dialect.words 기반으로 SELECT /
    // FROM / RETURNING / ILIKE 등을 모두 emit 한다. ns 에 inject 하면
    // schemaCompletionSource 가 같은 라벨을 추가 emit 해 popup 에 두 번
    // 노출되는 회귀가 발생했다.

    // Sprint 268 (2026-05-13) — schema-preserving cache shape.
    // Previously `cachedColumnsByName[bareName]` was overwritten on each
    // schema iteration ("last-writer-wins"). When two schemas in the same
    // `(connId, db)` held a table of the same name (e.g. `public.users` +
    // `auth.users`), the bare `ns["users"]` silently took whichever
    // schema iterated last. The new shape keeps both axes distinct:
    //   - `byQualified["schema.table"]` — exact, schema-correct columns.
    //   - `byBareName["table"]` — list of candidate column sets, one per
    //     schema that holds a table of that name. Resolved via Policy A
    //     (see `pickBareColumns` below).
    // Shape choice rationale: `Record<"schema.table", colNs>` plus a
    // sibling `Record<bare, colNs[]>` is the minimum change that keeps
    // the lookup keyed by *string* (matches `pickColumns(objectName,
    // qualifiedName)` callsite) while still allowing a per-schema list
    // for the bare path.
    const byQualified: Record<string, Record<string, SQLNamespace>> = {};
    const byBareName: Record<string, Record<string, SQLNamespace>[]> = {};
    const columnsByDb = columnsCache[connectionId]?.[db] ?? {};
    for (const [schemaName, tablesInSchema] of Object.entries(columnsByDb)) {
      for (const [tableName, columns] of Object.entries(tablesInSchema)) {
        const colNs: Record<string, SQLNamespace> = {};
        for (const c of columns) colNs[c.name] = {};
        byQualified[`${schemaName}.${tableName}`] = colNs;
        (byBareName[tableName] ??= []).push(colNs);
      }
    }

    // Sprint 268 (2026-05-13) — bare-key ambiguity policy = Policy A
    // (union of all candidate columns across schemas, deduped by column
    // name). Rationale: silently dropping a column candidate is a worse
    // failure mode than offering a superset; the user can always
    // schema-qualify to narrow. Policy B (empty namespace when
    // ambiguous) was considered but rejected — it would regress the
    // single-schema parity case if the user typed the bare name (a
    // common path before opening the SchemaTree).
    const pickBareColumns = (
      bareName: string,
    ): Record<string, SQLNamespace> | undefined => {
      const candidates = byBareName[bareName];
      if (!candidates || candidates.length === 0) return undefined;
      if (candidates.length === 1) return candidates[0];
      // Multi-schema collision: union, deduped by column name. First
      // occurrence wins for equal-keyed columns (their namespace values
      // are `{}` anyway, so order is observationally irrelevant).
      const merged: Record<string, SQLNamespace> = {};
      for (const colNs of candidates) {
        for (const colName of Object.keys(colNs)) {
          if (!(colName in merged)) merged[colName] = colNs[colName]!;
        }
      }
      return merged;
    };

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
      return byQualified[qualifiedName] ?? pickBareColumns(objectName) ?? {};
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

    // Sprint 233 (2026-05-07): also emit the *fully-quoted*
    // schema-qualified form (`"schema"."table"` for PG/SQLite).
    // CodeMirror's `addNamespaceObject` (lang-sql:507-523) splits keys on
    // `.`, so registering this form yields a top-level child `"schema"`
    // whose child is `"table"` — distinct from the unquoted
    // `schema.table` path. Users (per 2026-05-07 bug report) often paste
    // the bottom-strip query verbatim, e.g.
    // `SELECT * FROM "public"."brief_news_tasks" …`, and expect column
    // autocomplete to keep working through that quoted path.
    //
    // The value mirrors `addQuotedAlias` shape — `{ self, children }` —
    // so `nameCompletion`'s "auto-quote uppercase labels" rule does not
    // re-quote the already-quoted label and turn it into a string.
    const addFullyQuotedAlias = (
      schemaName: string,
      bareName: string,
      colNs: Record<string, SQLNamespace>,
    ) => {
      if (!dialect) return;
      const quoted = `${quoteChar}${schemaName}${quoteChar}.${quoteChar}${bareName}${quoteChar}`;
      if (!ns[quoted]) {
        ns[quoted] = {
          self: { label: quoted, apply: quoted, type: "type" },
          children: colNs,
        };
      }
    };

    // Sprint 268 (2026-05-13) — track candidate column-sets per bare name
    // across schemas so the bare-key registration can apply Policy A
    // (union deduped by column name) after the per-schema loop. Built
    // separately for tables vs views so a view never silently unions
    // into a table of the same name (preserves the pre-Sprint-268
    // "don't overwrite a table of the same name" rule below).
    const bareTableCandidates: Record<string, Record<string, SQLNamespace>[]> =
      {};
    const bareViewCandidates: Record<string, Record<string, SQLNamespace>[]> =
      {};

    // Tables — qualified + dialect-quoted entries are schema-correct
    // per iteration. The bare-name entry `ns[table.name]` is deferred
    // until after the loop so Policy A can union all candidate schemas.
    const tablesByDb = tables[connectionId]?.[db] ?? {};
    for (const [schemaName, tableList] of Object.entries(tablesByDb)) {
      for (const table of tableList) {
        const qualified = `${schemaName}.${table.name}`;
        const colNs = pickColumns(table.name, qualified);
        ns[qualified] = colNs;
        addQuotedAlias(table.name, colNs);
        addFullyQuotedAlias(schemaName, table.name, colNs);
        (bareTableCandidates[table.name] ??= []).push(colNs);
      }
    }

    // Views — exposed identically so `SELECT * FROM active_users`
    // autocompletes. Same deferred-bare-key treatment as tables.
    const viewsByDb = views[connectionId]?.[db] ?? {};
    for (const [schemaName, viewList] of Object.entries(viewsByDb)) {
      for (const v of viewList) {
        const qualified = `${schemaName}.${v.name}`;
        const colNs = pickColumns(v.name, qualified);
        if (!ns[qualified]) ns[qualified] = colNs;
        addQuotedAlias(v.name, colNs);
        addFullyQuotedAlias(schemaName, v.name, colNs);
        (bareViewCandidates[v.name] ??= []).push(colNs);
      }
    }

    // Sprint 268 (2026-05-13) — register bare-name entries under Policy A.
    // Single candidate: trivial passthrough (preserves AC-268-03
    // single-schema parity). Multi-candidate: union deduped by column
    // name. Tables register first so a view never overwrites a table
    // of the same name (mirrors the pre-Sprint-268 `if (!ns[v.name])`
    // guard).
    const unionColumns = (
      candidates: Record<string, SQLNamespace>[],
    ): Record<string, SQLNamespace> => {
      if (candidates.length === 1) return candidates[0]!;
      const merged: Record<string, SQLNamespace> = {};
      for (const colNs of candidates) {
        for (const colName of Object.keys(colNs)) {
          if (!(colName in merged)) merged[colName] = colNs[colName]!;
        }
      }
      return merged;
    };
    for (const [bareName, candidates] of Object.entries(bareTableCandidates)) {
      ns[bareName] = unionColumns(candidates);
    }
    for (const [bareName, candidates] of Object.entries(bareViewCandidates)) {
      if (!ns[bareName]) ns[bareName] = unionColumns(candidates);
    }

    return ns as SQLNamespace;
  }, [tables, views, columnsCache, connectionId, db, tableColumns, dialect]);
}

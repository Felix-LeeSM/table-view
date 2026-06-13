import {
  completionCursorOffsets,
  type CompletionCursorOffsets,
  type CompletionLanguage,
} from "@/lib/completion/coreContract";
import {
  parseDataSourceVersion,
  type ParsedDataSourceVersion,
} from "@/types/dataSourceVersionCapabilities";
import {
  getSqlDialectProfile,
  SQL_SHELL_PROFILES,
  type SqlDialectCapabilities,
  type SqlDialectFamily,
  type SqlDialectId,
  type SqlDialectVocabulary,
  type SqlShellId,
  type SqlShellProfile,
} from "@lib/sql/sqlDialectProfile";
import type {
  SqlCompletionCacheState,
  SqlCompletionCatalogSnapshot,
  SqlCompletionContext,
} from "./sqlCompletionContext";

const SQLITE_JSON1_FUNCTIONS = [
  "JSON",
  "JSON_ARRAY",
  "JSON_EXTRACT",
  "JSON_GROUP_ARRAY",
  "JSON_GROUP_OBJECT",
  "JSON_OBJECT",
  "JSON_PATCH",
  "JSON_REMOVE",
  "JSON_REPLACE",
  "JSON_SET",
  "JSON_TYPE",
  "JSON_VALID",
] as const;

const SQLITE_FTS5_KEYWORDS = ["MATCH"] as const;
const SQLITE_FTS5_FUNCTIONS = ["BM25", "HIGHLIGHT", "SNIPPET"] as const;
const SQLITE_RTREE_KEYWORDS = ["RTREE"] as const;

export interface SqlCompletionRequest {
  language: Extract<CompletionLanguage, "sql">;
  text: string;
  cursor: CompletionCursorOffsets;
  dialect: SqlDialectId;
  family: SqlDialectFamily;
  shell: SqlShellId;
  shellProfile: SqlShellProfile;
  serverVersion: string | null;
  defaultSchema: string | null;
  searchPath: readonly string[];
  capabilities: SqlDialectCapabilities;
  vocabulary: SqlDialectVocabulary;
  catalog: SqlCompletionCatalogSnapshot;
  cacheState: SqlCompletionCacheState;
}

export function buildSqlCompletionRequest(
  text: string,
  cursorUtf16: number,
  context: SqlCompletionContext,
): SqlCompletionRequest {
  const profile = getSqlDialectProfile(context.dialect);
  return {
    language: "sql",
    text,
    cursor: completionCursorOffsets(text, cursorUtf16),
    dialect: context.dialect,
    family: context.family,
    shell: context.shell,
    shellProfile: SQL_SHELL_PROFILES[context.shell],
    serverVersion: context.serverVersion,
    defaultSchema: context.defaultSchema,
    searchPath: context.searchPath,
    capabilities: profile.capabilities,
    vocabulary: completionVocabularyForContext(profile.vocabulary, context),
    catalog: context.catalog,
    cacheState: context.cacheState,
  };
}

function completionVocabularyForContext(
  vocabulary: SqlDialectVocabulary,
  context: SqlCompletionContext,
): SqlDialectVocabulary {
  let next = vocabulary;
  if (
    context.dialect === "mariadb" &&
    !mariadbServerVersionSupportsReturning(context.serverVersion)
  ) {
    next = {
      ...next,
      keywords: next.keywords.filter(
        (keyword) => keyword.toUpperCase() !== "RETURNING",
      ),
    };
  }

  if (context.dialect !== "sqlite" || context.sqliteCapabilities === null) {
    return next;
  }

  const keywords = [...next.keywords];
  const functions = [...next.functions];
  if (context.sqliteCapabilities.json1) {
    appendUnique(functions, SQLITE_JSON1_FUNCTIONS);
  }
  if (context.sqliteCapabilities.fts5) {
    appendUnique(keywords, SQLITE_FTS5_KEYWORDS);
    appendUnique(functions, SQLITE_FTS5_FUNCTIONS);
  }
  if (context.sqliteCapabilities.rtree) {
    appendUnique(keywords, SQLITE_RTREE_KEYWORDS);
  }

  return {
    ...next,
    keywords,
    functions,
  };
}

function appendUnique(target: string[], values: readonly string[]): void {
  const seen = new Set(target.map((value) => value.toUpperCase()));
  for (const value of values) {
    const key = value.toUpperCase();
    if (seen.has(key)) continue;
    target.push(value);
    seen.add(key);
  }
}

function mariadbServerVersionSupportsReturning(
  serverVersion: string | null,
): boolean {
  const version = parseDataSourceVersion(serverVersion);
  if (!version.known) return true;
  return isParsedVersionAtLeast(version, 10, 0, 5);
}

function isParsedVersionAtLeast(
  version: Extract<ParsedDataSourceVersion, { known: true }>,
  major: number,
  minor: number,
  patch: number,
): boolean {
  return (
    version.major > major ||
    (version.major === major &&
      (version.minor > minor ||
        (version.minor === minor && version.patch >= patch)))
  );
}

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
} from "./sqlDialectProfile";
import type {
  SqlCompletionCacheState,
  SqlCompletionCatalogSnapshot,
  SqlCompletionContext,
} from "./sqlCompletionContext";

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
  if (context.dialect !== "mariadb") return vocabulary;
  if (mariadbServerVersionSupportsReturning(context.serverVersion)) {
    return vocabulary;
  }

  return {
    ...vocabulary,
    keywords: vocabulary.keywords.filter(
      (keyword) => keyword.toUpperCase() !== "RETURNING",
    ),
  };
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

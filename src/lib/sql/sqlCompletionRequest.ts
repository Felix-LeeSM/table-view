import {
  completionCursorOffsets,
  type CompletionCursorOffsets,
  type CompletionLanguage,
} from "@/lib/completion/coreContract";
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
    vocabulary: profile.vocabulary,
    catalog: context.catalog,
    cacheState: context.cacheState,
  };
}

export const COMPLETION_FEATURE_PUBLIC_API_PATH =
  "src/features/completion/index.ts";

export const COMPLETION_FEATURE_PUBLIC_API_EXPORTS = [
  "buildSqlCompletionContext",
  "buildSqlCompletionRequest",
  "buildSqlCompletionRequestFromCodeMirror",
  "createSqlHybridCompletionSource",
  "SQL_COMPLETION_LEGACY_COMPATIBILITY_OWNER_ISSUE",
  "SqlCompletionCatalogStoreSnapshot",
  "BuildSqlCompletionContextInput",
  "SqlCompletionCatalogSchema",
  "SqlCompletionCatalogDatabase",
  "SqlCompletionCatalogObject",
  "SqlCompletionCatalogColumn",
  "SqlCompletionCatalogFunction",
  "SqlCompletionCatalogExtension",
  "SqlCompletionCatalogSnapshot",
  "SqlCompletionCacheState",
  "SqlCompletionContext",
  "SqlCompletionRequest",
  "SqlHybridCompletionSourceOptions",
  "useMongoAutocomplete",
  "createDbMethodCompletionSource",
  "createMongoAdminCommandSource",
  "createMongoCompletionSource",
  "createMongoOperatorHighlight",
  "createMongoshDbSource",
  "classifyMongoCompletionPosition",
  "dbMethodCandidates",
  "getMongoAdminCommandCompletions",
  "getMongoCompletionVocabulary",
  "getMongoshCollectionMethodCompletions",
  "getMongoshDbLevelMethodCompletions",
  "MONGO_ACCUMULATORS",
  "MONGO_ADMIN_COMMANDS",
  "MONGO_AGGREGATE_STAGES",
  "MONGO_ALL_OPERATORS",
  "MONGO_EXPRESSION_OPERATORS",
  "MONGO_PROJECTION_OPERATORS",
  "MONGO_QUERY_OPERATORS",
  "MONGO_TYPE_TAGS",
  "MONGO_UPDATE_OPERATORS",
  "MONGOSH_DB_LEVEL_METHODS",
  "MONGOSH_DB_METHODS",
  "UseMongoAutocompleteOptions",
  "MongoCompletionCursor",
  "MongoCompletionOptions",
  "MongoCompletionPositionKind",
  "MongoCompletionResult",
  "MongoDbMethodSource",
  "MongoMethodCandidate",
  "MongoQueryMode",
  "MongoshDbSourceOptions",
  "createRedisCommandCompletionSource",
  "REDIS_COMMAND_COMPLETIONS",
  "REDIS_UNSUPPORTED_COMMAND_FAMILIES",
  "VALKEY_COMMAND_COMPLETIONS",
  "RedisCommandCompletionEffect",
  "RedisCommandCompletionName",
  "RedisCommandCompletionSourceOptions",
  "RedisCommandCompletionSpec",
  "RedisCommandCompletionTarget",
  "RedisKeySuggestion",
  "RedisUnsupportedCommandFamily",
] as const;

const COMPLETION_FEATURE_MIGRATED_CONSUMERS: ReadonlySet<string> = new Set([
  "src/components/document/AddDocumentModal.tsx",
  "src/components/document/DocumentFilterBar.tsx",
  "src/components/query/QueryTab.tsx",
  "src/components/query/SqlQueryEditor.tsx",
  "src/components/query/RedisCommandEditor.tsx",
]);

const COMPLETION_FEATURE_LEGACY_SPECIFIER_PREFIXES = [
  "@/hooks/useMongoAutocomplete",
  "@hooks/useMongoAutocomplete",
  "@/lib/completion/mongo",
  "@lib/completion/mongo",
  "@/lib/mongo/mongoAutocomplete",
  "@lib/mongo/mongoAutocomplete",
  "@/lib/redis/redisCommandCompletion",
  "@lib/redis/redisCommandCompletion",
  "@/lib/sql/sqlCodeMirrorCompletionAdapter",
  "@lib/sql/sqlCodeMirrorCompletionAdapter",
  "@/lib/sql/sqlCompletionContext",
  "@lib/sql/sqlCompletionContext",
  "@/lib/sql/sqlCompletionRequest",
  "@lib/sql/sqlCompletionRequest",
  "@/lib/sql/sqlHybridCompletionSource",
  "@lib/sql/sqlHybridCompletionSource",
] as const;

const COMPLETION_FEATURE_REMOVED_COMPAT_PATHS = [
  "src/hooks/useMongoAutocomplete.ts",
  "src/lib/completion/mongo.ts",
  "src/lib/sql/sqlCodeMirrorCompletionAdapter.ts",
  "src/lib/sql/sqlCompletionContext.ts",
  "src/lib/sql/sqlCompletionRequest.ts",
  "src/lib/sql/sqlHybridCompletionSource.ts",
  "src/lib/mongo/mongoAutocomplete.ts",
  "src/lib/redis/redisCommandCompletion.ts",
] as const;

type PublicExportKind = "type" | "value";

type ParsedPublicExport = {
  readonly name: string;
  readonly kind: PublicExportKind;
};

type NormalizeRepoPath = (path: string) => string;

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  for (const match of source.matchAll(
    /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
  )) {
    specifiers.push(match[1]!);
  }
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    specifiers.push(match[1]!);
  }
  return specifiers;
}

function startsWithImportSpecifier(source: string, prefix: string): boolean {
  return source === prefix || source.startsWith(`${prefix}/`);
}

function isLegacyCompletionSpecifier(specifier: string): boolean {
  return COMPLETION_FEATURE_LEGACY_SPECIFIER_PREFIXES.some((prefix) =>
    startsWithImportSpecifier(specifier, prefix),
  );
}

function publicNameFromExportMember(member: string): string | undefined {
  const normalized = member.trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return undefined;

  const withoutTypeModifier = normalized.replace(/^type\s+/, "");
  const aliasMatch = withoutTypeModifier.match(/\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (aliasMatch) return aliasMatch[1]!;

  const directMatch = withoutTypeModifier.match(/^([A-Za-z_$][\w$]*)$/);
  return directMatch?.[1];
}

function exportKindFromMember(
  statementKind: PublicExportKind,
  member: string,
): PublicExportKind {
  return member.trim().startsWith("type ") ? "type" : statementKind;
}

function collectCompletionPublicApiExports(source: string) {
  const exports: ParsedPublicExport[] = [];
  const wildcardSpecifiers: string[] = [];

  for (const match of source.matchAll(
    /\bexport\s+(type\s+)?\{([\s\S]*?)\}\s*(?:from\s*["'][^"']+["'])?\s*;?/g,
  )) {
    const statementKind: PublicExportKind = match[1] ? "type" : "value";
    const clause = match[2]!;
    for (const member of clause.split(",")) {
      const name = publicNameFromExportMember(member);
      if (name === undefined) continue;
      exports.push({
        name,
        kind: exportKindFromMember(statementKind, member),
      });
    }
  }

  for (const match of source.matchAll(
    /\bexport\s+(type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g,
  )) {
    exports.push({
      name: match[2]!,
      kind: match[1] ? "type" : "value",
    });
  }

  for (const match of source.matchAll(
    /\bexport\s+(?:type\s+)?\*\s+from\s+["']([^"']+)["']/g,
  )) {
    wildcardSpecifiers.push(match[1]!);
  }

  for (const match of source.matchAll(
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(const|let|var|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    const declarationKind = match[1]!;
    exports.push({
      name: match[2]!,
      kind:
        declarationKind === "interface" || declarationKind === "type"
          ? "type"
          : "value",
    });
  }

  return { exports, wildcardSpecifiers };
}

function findCompletionPublicApiExportViolations(source: string): string[] {
  const failures: string[] = [];
  const allowedExports = new Set(COMPLETION_FEATURE_PUBLIC_API_EXPORTS);
  const { exports, wildcardSpecifiers } =
    collectCompletionPublicApiExports(source);
  const exportNames = new Set(
    exports.map((exportedSymbol) => exportedSymbol.name),
  );

  for (const specifier of [...new Set(wildcardSpecifiers)].sort()) {
    failures.push(
      `${COMPLETION_FEATURE_PUBLIC_API_PATH}: wildcard public export from ${specifier} is not allowed; enumerate public exports.`,
    );
  }

  for (const exportName of COMPLETION_FEATURE_PUBLIC_API_EXPORTS) {
    if (!exportNames.has(exportName)) {
      failures.push(
        `${COMPLETION_FEATURE_PUBLIC_API_PATH}: missing public export ${exportName}.`,
      );
    }
  }

  for (const exportName of [...exportNames].sort()) {
    if (!allowedExports.has(exportName)) {
      failures.push(
        `${COMPLETION_FEATURE_PUBLIC_API_PATH}: unexpected public export ${exportName}.`,
      );
    }
  }

  return failures;
}

export function findCompletionFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
  normalizeRepoPath: NormalizeRepoPath,
): string[] {
  const failures: string[] = [];
  const publicApiSource = fileSources.get(COMPLETION_FEATURE_PUBLIC_API_PATH);
  if (publicApiSource === undefined) {
    failures.push(
      `${COMPLETION_FEATURE_PUBLIC_API_PATH}: missing completion feature public API.`,
    );
  } else {
    failures.push(...findCompletionPublicApiExportViolations(publicApiSource));
  }

  for (const compatPath of COMPLETION_FEATURE_REMOVED_COMPAT_PATHS) {
    if (fileSources.has(compatPath)) {
      failures.push(
        `${compatPath}: moved completion module must not remain as a compatibility path; import ${COMPLETION_FEATURE_PUBLIC_API_PATH}.`,
      );
    }
  }

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    if (!COMPLETION_FEATURE_MIGRATED_CONSUMERS.has(repoPath)) continue;

    for (const specifier of collectImportSpecifiers(source)) {
      if (!isLegacyCompletionSpecifier(specifier)) continue;
      failures.push(
        `${repoPath}: import completion request/context/UI adapters through ${COMPLETION_FEATURE_PUBLIC_API_PATH}, not ${specifier}.`,
      );
    }
  }

  return failures;
}

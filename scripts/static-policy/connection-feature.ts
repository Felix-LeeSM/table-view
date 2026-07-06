export const CONNECTION_FEATURE_PUBLIC_API_PATH =
  "src/features/connection/index.ts";

export const CONNECTION_FEATURE_PUBLIC_API_EXPORTS = [
  "ConnectionDialog",
  "sanitizeMessage",
  "ConnectionList",
  "ConnectionGroup",
  "ConnectionItem",
  "GroupDialog",
  "ImportExportDialog",
  "RecentConnections",
  "relativeTime",
  "DbLifecycleDialog",
  "KeyringFallbackToast",
  "ServerActivityPanel",
  "ServerInfoPanel",
  "useConnectionMutations",
  "useConnectionStore",
  "SYNCED_KEYS",
  "ConnectionState",
  "connectToDatabase",
  "createSqliteDatabaseFile",
  "deleteConnection",
  "deleteGroup",
  "disconnectFromDatabase",
  "exportConnections",
  "exportConnectionsEncrypted",
  "importConnections",
  "importConnectionsEncrypted",
  "listConnections",
  "listGroups",
  "moveConnectionToGroup",
  "saveConnection",
  "saveGroup",
  "testConnection",
  "EncryptedExportResult",
  "ImportRenamedEntry",
  "ImportResult",
  "getConnectionColor",
  "CONNECTION_COLOR_PALETTE",
  "FileConnectionPermissionScope",
  "FileConnectionPrivacyPolicyId",
  "FileConnectionInputKind",
  "FileConnectionInputStatus",
  "FileConnectionInputContract",
  "FileConnectionContract",
  "SQLITE_FILE_CONNECTION",
  "DUCKDB_FILE_CONNECTION",
  "DATABASE_DEFAULTS",
  "DATABASE_DEFAULT_FIELDS",
  "DATABASE_TYPE_LABELS",
  "ENVIRONMENT_META",
  "ENVIRONMENT_OPTIONS",
  "SUPPORTED_DATABASE_TYPES",
  "createEmptyDraft",
  "draftFromConnection",
  "isKvFamily",
  "isSearchFamily",
  "isSupportedDatabaseType",
  "paradigmOf",
  "parseConnectionUrl",
  "parseFileConnectionPath",
  "parseSqliteFilePath",
  "ConnectionConfig",
  "ConnectionDefaultFields",
  "ConnectionDraft",
  "ConnectionGroupModel",
  "ConnectionStatus",
  "DatabaseType",
  "EnvironmentTag",
  "FileConnectionDatabaseType",
  "Paradigm",
] as const;

const CONNECTION_FEATURE_MIGRATED_CONSUMERS: ReadonlySet<string> = new Set([
  "src/App.tsx",
  "src/AppRouter.tsx",
  "src/main.tsx",
  "src/pages/HomePage.tsx",
]);

const CONNECTION_FEATURE_LEGACY_SPECIFIER_PREFIXES = [
  "@/components/connection",
  "@components/connection",
  "@/stores/connectionStore",
  "@stores/connectionStore",
  "@/types/connection",
  "@/types/fileConnection",
  "@/lib/tauri/connection",
  "@lib/tauri/connection",
  "@/lib/connectionColor",
  "@lib/connectionColor",
  "@/hooks/useConnectionMutations",
  "@hooks/useConnectionMutations",
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

function isLegacyConnectionSpecifier(specifier: string): boolean {
  return CONNECTION_FEATURE_LEGACY_SPECIFIER_PREFIXES.some((prefix) =>
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

function collectConnectionPublicApiExports(source: string) {
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

function findConnectionPublicApiExportViolations(source: string): string[] {
  const failures: string[] = [];
  const allowedExports = new Set(CONNECTION_FEATURE_PUBLIC_API_EXPORTS);
  const { exports, wildcardSpecifiers } =
    collectConnectionPublicApiExports(source);
  const exportsByName = new Map<string, Set<PublicExportKind>>();

  for (const exportedSymbol of exports) {
    const kinds = exportsByName.get(exportedSymbol.name) ?? new Set();
    kinds.add(exportedSymbol.kind);
    exportsByName.set(exportedSymbol.name, kinds);
  }

  for (const specifier of [...new Set(wildcardSpecifiers)].sort()) {
    failures.push(
      `${CONNECTION_FEATURE_PUBLIC_API_PATH}: wildcard public export from ${specifier} is not allowed; enumerate public exports.`,
    );
  }

  for (const exportName of CONNECTION_FEATURE_PUBLIC_API_EXPORTS) {
    if (!exportsByName.has(exportName)) {
      failures.push(
        `${CONNECTION_FEATURE_PUBLIC_API_PATH}: missing public export ${exportName}.`,
      );
    }
  }

  for (const exportName of [...exportsByName.keys()].sort()) {
    if (!allowedExports.has(exportName)) {
      failures.push(
        `${CONNECTION_FEATURE_PUBLIC_API_PATH}: unexpected public export ${exportName}.`,
      );
    }
  }

  if (
    exportsByName.has("ConnectionGroup") &&
    !exportsByName.get("ConnectionGroup")?.has("value")
  ) {
    failures.push(
      `${CONNECTION_FEATURE_PUBLIC_API_PATH}: public export ConnectionGroup must be the component value; export the model type as ConnectionGroupModel.`,
    );
  }

  return failures;
}

export function findConnectionFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
  normalizeRepoPath: NormalizeRepoPath,
): string[] {
  const failures: string[] = [];
  const publicApiSource = fileSources.get(CONNECTION_FEATURE_PUBLIC_API_PATH);
  if (publicApiSource === undefined) {
    failures.push(
      `${CONNECTION_FEATURE_PUBLIC_API_PATH}: missing connection feature public API.`,
    );
  } else {
    failures.push(...findConnectionPublicApiExportViolations(publicApiSource));
  }

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    if (!CONNECTION_FEATURE_MIGRATED_CONSUMERS.has(repoPath)) continue;

    for (const specifier of collectImportSpecifiers(source)) {
      if (!isLegacyConnectionSpecifier(specifier)) continue;
      failures.push(
        `${repoPath}: import connection UI/model/api through ${CONNECTION_FEATURE_PUBLIC_API_PATH}, not ${specifier}.`,
      );
    }
  }

  return failures;
}

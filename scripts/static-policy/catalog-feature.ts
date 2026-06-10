export const CATALOG_FEATURE_PUBLIC_API_PATH = "src/features/catalog/index.ts";

export const CATALOG_FEATURE_PUBLIC_API_EXPORTS = [
  "SchemaTree",
  "DocumentDatabaseTree",
  "StructurePanel",
  "ViewStructurePanel",
  "SchemaErdPanel",
  "AddColumnDialog",
  "DropColumnDialog",
  "OrderedColumnPicker",
  "registerSchemaDbMismatchRecoveryHandler",
  "useSchemaStore",
  "SchemaDbMismatchRecoveryHandler",
  "extractSchemaGraph",
  "buildSchemaGraphCatalogSnapshot",
  "AddColumnRequest",
  "AddConstraintRequest",
  "AlterTableRequest",
  "ColumnChange",
  "ColumnDefinition",
  "ColumnInfo",
  "ConstraintDefinition",
  "ConstraintInfo",
  "CreateIndexRequest",
  "CreateTablePlanConstraint",
  "CreateTablePlanIndex",
  "CreateTablePlanRequest",
  "CreateTableRequest",
  "CreateTriggerRequest",
  "DropColumnRequest",
  "DropConstraintRequest",
  "DropIndexRequest",
  "DropTableRequest",
  "DropTriggerRequest",
  "FilterCondition",
  "FilterMode",
  "FilterOperator",
  "FunctionInfo",
  "IndexInfo",
  "PostgresExtensionInfo",
  "PostgresTypeInfo",
  "RenameTableRequest",
  "SchemaChangeResult",
  "SchemaInfo",
  "SortInfo",
  "TableData",
  "TableInfo",
  "TriggerInfo",
  "ViewInfo",
  "SchemaGraph",
  "SchemaGraphCatalogSnapshot",
  "SchemaGraphColumnNode",
  "SchemaGraphConstraintNode",
  "SchemaGraphConstraintPayload",
  "SchemaGraphDiagnostic",
  "SchemaGraphDiagnosticKind",
  "SchemaGraphEdge",
  "SchemaGraphEdgeKind",
  "SchemaGraphForeignKeyEndpoint",
  "SchemaGraphForeignKeyRawMetadata",
  "SchemaGraphForeignKeyRelationship",
  "SchemaGraphIndexNode",
  "SchemaGraphNode",
  "SchemaGraphNodeBase",
  "SchemaGraphNodeKind",
  "SchemaGraphSchemaNode",
  "SchemaGraphSource",
  "SchemaGraphTableNode",
] as const;

const CATALOG_FEATURE_MIGRATED_CONSUMERS: ReadonlySet<string> = new Set([
  "src/components/layout/MainArea.tsx",
  "src/components/structure/ColumnsEditor.tsx",
  "src/components/structure/IndexesEditor.tsx",
  "src/components/workspace/DocumentSidebar.tsx",
  "src/components/workspace/RdbSidebar.tsx",
]);

const CATALOG_FEATURE_LEGACY_SPECIFIER_PREFIXES = [
  "@/components/schema",
  "@components/schema",
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

function isLegacyCatalogSpecifier(specifier: string): boolean {
  return CATALOG_FEATURE_LEGACY_SPECIFIER_PREFIXES.some((prefix) =>
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

function collectCatalogPublicApiExports(source: string) {
  const exports: ParsedPublicExport[] = [];
  const wildcardSpecifiers: string[] = [];
  const defaultExports: string[] = [];

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
    /\bexport\s+default\s+(?:function|class)?\s*([A-Za-z_$][\w$]*)?/g,
  )) {
    defaultExports.push(match[1] ?? "default");
  }

  return { exports, wildcardSpecifiers, defaultExports };
}

function findCatalogPublicApiExportViolations(source: string): string[] {
  const failures: string[] = [];
  const allowedExports = new Set(CATALOG_FEATURE_PUBLIC_API_EXPORTS);
  const { exports, wildcardSpecifiers, defaultExports } =
    collectCatalogPublicApiExports(source);
  const exportsByName = new Set(
    exports.map((exportedSymbol) => exportedSymbol.name),
  );

  for (const specifier of [...new Set(wildcardSpecifiers)].sort()) {
    failures.push(
      `${CATALOG_FEATURE_PUBLIC_API_PATH}: wildcard public export from ${specifier} is not allowed; enumerate public exports.`,
    );
  }

  if (defaultExports.length > 0) {
    failures.push(
      `${CATALOG_FEATURE_PUBLIC_API_PATH}: default public export is not allowed; enumerate named exports.`,
    );
  }

  for (const exportName of CATALOG_FEATURE_PUBLIC_API_EXPORTS) {
    if (!exportsByName.has(exportName)) {
      failures.push(
        `${CATALOG_FEATURE_PUBLIC_API_PATH}: missing public export ${exportName}.`,
      );
    }
  }

  for (const exportName of [...exportsByName].sort()) {
    if (!allowedExports.has(exportName)) {
      failures.push(
        `${CATALOG_FEATURE_PUBLIC_API_PATH}: unexpected public export ${exportName}.`,
      );
    }
  }

  return failures;
}

export function findCatalogFeatureBoundaryViolations(
  fileSources: ReadonlyMap<string, string>,
  normalizeRepoPath: NormalizeRepoPath,
): string[] {
  const failures: string[] = [];
  const publicApiSource = fileSources.get(CATALOG_FEATURE_PUBLIC_API_PATH);
  if (publicApiSource === undefined) {
    failures.push(
      `${CATALOG_FEATURE_PUBLIC_API_PATH}: missing catalog feature public API.`,
    );
  } else {
    failures.push(...findCatalogPublicApiExportViolations(publicApiSource));
  }

  for (const [filePath, source] of [...fileSources.entries()].sort()) {
    const repoPath = normalizeRepoPath(filePath);
    if (!CATALOG_FEATURE_MIGRATED_CONSUMERS.has(repoPath)) continue;

    for (const specifier of collectImportSpecifiers(source)) {
      if (!isLegacyCatalogSpecifier(specifier)) continue;
      failures.push(
        `${repoPath}: import catalog/schema UI through ${CATALOG_FEATURE_PUBLIC_API_PATH}, not ${specifier}.`,
      );
    }
  }

  return failures;
}

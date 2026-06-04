import type { CompletionResult } from "@/lib/completion/coreContract";
import type { SqlCompletionRequest } from "./sqlCompletionRequest";

interface SqlCompletionWasmModule {
  default: (input?: unknown) => Promise<unknown>;
  complete_sql: (
    text: string,
    cursorUtf16: number,
    cursorUtf8: number,
    dialect: string,
    shell: string,
    serverVersion: string,
    catalogRevision: string,
    keywords: string,
    vocabularyFunctions: string,
    schemas: string,
    objects: string,
    columns: string,
    catalogFunctions: string,
    extensions: string,
  ) => unknown;
}

let modulePromise: Promise<SqlCompletionWasmModule> | null = null;
let loadedModule: SqlCompletionWasmModule | null = null;

async function loadCompletionWasm(): Promise<SqlCompletionWasmModule> {
  if (modulePromise === null) {
    modulePromise = (async () => {
      const mod =
        (await import("./wasm/sql_parser_core.js")) as unknown as SqlCompletionWasmModule;
      await mod.default();
      loadedModule = mod;
      return mod;
    })();
  }
  return modulePromise;
}

export async function completeSqlWithWasm(
  request: SqlCompletionRequest,
): Promise<CompletionResult> {
  const mod = await loadCompletionWasm();
  const raw = callCompleteSql(mod, request);
  return normalizeCompletionResult(raw, request);
}

export function completeSqlWithPreloadedWasm(
  request: SqlCompletionRequest,
): CompletionResult | null {
  if (loadedModule === null) return null;
  const raw = callCompleteSql(loadedModule, request);
  return isCompletionResult(raw) ? raw : null;
}

export async function preloadSqlCompletionWasm(): Promise<void> {
  await loadCompletionWasm();
}

function callCompleteSql(
  mod: SqlCompletionWasmModule,
  request: SqlCompletionRequest,
): unknown {
  return mod.complete_sql(
    request.text,
    request.cursor.utf16,
    request.cursor.utf8,
    request.dialect,
    request.shell,
    request.serverVersion ?? "",
    request.catalog.revision,
    request.vocabulary.keywords.join("\n"),
    request.vocabulary.functions.join("\n"),
    request.catalog.schemas.map((schema) => schema.name).join("\n"),
    request.catalog.objects
      .map((object) =>
        [object.kind, object.schema, object.name, object.qualifiedName].join(
          "\t",
        ),
      )
      .join("\n"),
    request.catalog.columns
      .map((column) =>
        [
          column.schema,
          column.table,
          column.name,
          column.qualifiedTableName,
        ].join("\t"),
      )
      .join("\n"),
    request.catalog.functions
      .map((fn) =>
        [
          fn.schema,
          fn.name,
          fn.qualifiedName,
          fn.arguments ?? "",
          fn.returnType ?? "",
        ].join("\t"),
      )
      .join("\n"),
    request.catalog.extensions
      .map((extension) =>
        [extension.schema, extension.name, extension.version].join("\t"),
      )
      .join("\n"),
  );
}

function normalizeCompletionResult(
  raw: unknown,
  request: SqlCompletionRequest,
): CompletionResult {
  if (isCompletionResult(raw)) return raw;
  return {
    items: [],
    replaceRange: {
      from: request.cursor,
      to: request.cursor,
    },
    incomplete: false,
    metadata: {
      engine: "wasm",
      dialect: request.dialect,
      shell: request.shell,
      catalogRevision: request.catalog.revision,
      completionState: "Unsupported",
    },
  };
}

function isCompletionResult(value: unknown): value is CompletionResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as {
    items?: unknown;
    replaceRange?: unknown;
    incomplete?: unknown;
    metadata?: unknown;
  };
  return (
    Array.isArray(result.items) &&
    typeof result.replaceRange === "object" &&
    result.replaceRange !== null &&
    typeof result.incomplete === "boolean" &&
    typeof result.metadata === "object" &&
    result.metadata !== null
  );
}

export function __resetSqlCompletionWasmModuleForTests(): void {
  modulePromise = null;
  loadedModule = null;
}

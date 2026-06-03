import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import type { SQLDialect, SQLNamespace } from "@codemirror/lang-sql";
import type {
  CompletionItem,
  CompletionResult as CoreCompletionResult,
} from "@/lib/completion/coreContract";
import { aliasColumnCompletionSource } from "./aliasColumnCompletion";
import { cteColumnCompletionSource } from "./cteColumnCompletion";
import { wrappedSchemaCompletionSource } from "./schemaCompletionWrapper";
import { buildSqlCompletionRequestFromCodeMirror } from "./sqlCodeMirrorCompletionAdapter";
import type { SqlCompletionContext } from "./sqlCompletionContext";
import type { SqlCompletionRequest } from "./sqlCompletionRequest";
import {
  completeSqlWithPreloadedWasm,
  completeSqlWithWasm,
} from "./sqlCompletionWasm";
import { updateColumnCompletionSource } from "./updateColumnCompletion";

type CompleteSqlSync = (
  request: SqlCompletionRequest,
) => CoreCompletionResult | null;
type CompleteSqlAsync = (
  request: SqlCompletionRequest,
) => Promise<CoreCompletionResult>;

export interface SqlHybridCompletionSourceOptions {
  dialect: SQLDialect;
  getNamespace: () => SQLNamespace | undefined;
  getCompletionContext: () => SqlCompletionContext | null | undefined;
  completeWithPreloadedWasm?: CompleteSqlSync;
  completeWithWasm?: CompleteSqlAsync;
  legacySources?: readonly CompletionSource[];
}

export function createSqlHybridCompletionSource({
  dialect,
  getNamespace,
  getCompletionContext,
  completeWithPreloadedWasm = completeSqlWithPreloadedWasm,
  completeWithWasm = completeSqlWithWasm,
  legacySources = defaultLegacySources(getNamespace, dialect),
}: SqlHybridCompletionSourceOptions): CompletionSource {
  return async (context) => {
    const completionContext = getCompletionContext();
    if (!completionContext) {
      return completeWithLegacySources(legacySources, context);
    }

    const request = buildSqlCompletionRequestFromCodeMirror(
      context,
      completionContext,
    );
    let coreResult: CoreCompletionResult | null = null;
    try {
      coreResult = completeWithPreloadedWasm(request);
      coreResult ??= await completeWithWasm(request);
    } catch {
      return completeWithLegacySources(legacySources, context);
    }

    const visibleCoreResult = filterShellMetaCommands(coreResult, request);
    return coreResultToCodeMirror(visibleCoreResult);
  };
}

function defaultLegacySources(
  getNamespace: () => SQLNamespace | undefined,
  dialect: SQLDialect,
): readonly CompletionSource[] {
  return [
    wrappedSchemaCompletionSource(getNamespace, dialect),
    updateColumnCompletionSource(getNamespace),
    aliasColumnCompletionSource(getNamespace),
    cteColumnCompletionSource(getNamespace),
  ];
}

async function completeWithLegacySources(
  sources: readonly CompletionSource[],
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const groups = new Map<string, CompletionResult>();

  for (const source of sources) {
    const result = await Promise.resolve(source(context));
    if (!result || result.options.length === 0) continue;
    const to = result.to ?? context.pos;
    const key = `${result.from}:${to}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        ...result,
        to,
        options: dedupeCompletions(result.options),
      });
      continue;
    }
    existing.options = dedupeCompletions([
      ...existing.options,
      ...result.options,
    ]);
  }

  let best: CompletionResult | null = null;
  for (const result of groups.values()) {
    if (!best || result.options.length > best.options.length) {
      best = result;
    }
  }
  return best;
}

function coreResultToCodeMirror(
  result: CoreCompletionResult,
): CompletionResult {
  return {
    from: result.replaceRange.from.utf16,
    to: result.replaceRange.to.utf16,
    options: result.items.map(coreItemToCompletion),
    validFor: coreValidFor(result),
  };
}

function coreItemToCompletion(item: CompletionItem): Completion {
  return {
    label: item.label,
    apply: item.apply ?? item.label,
    type: codeMirrorTypeForKind(item.kind),
    detail: item.detail,
    boost: item.boost,
  };
}

function filterShellMetaCommands(
  result: CoreCompletionResult,
  request: SqlCompletionRequest,
): CoreCompletionResult {
  if (isShellMetaCommandContext(request)) return result;
  const items = result.items.filter((item) => item.kind !== "meta-command");
  return items.length === result.items.length ? result : { ...result, items };
}

function isShellMetaCommandContext(request: SqlCompletionRequest): boolean {
  if (request.shell === "none") return false;
  const beforeCursor = request.text.slice(0, request.cursor.utf16);
  const lineStart = Math.max(
    beforeCursor.lastIndexOf("\n"),
    beforeCursor.lastIndexOf(";"),
  );
  const linePrefix = beforeCursor.slice(lineStart + 1).trimStart();
  if (linePrefix.length === 0) return true;

  const commandPrefix = request.shellProfile.commandPrefix;
  if (commandPrefix && linePrefix.startsWith(commandPrefix)) return true;

  if (!/^[A-Za-z]*$/.test(linePrefix)) return false;
  const normalized = linePrefix.toLowerCase();
  return request.shellProfile.commands.some((command) => {
    if (command.startsWith("\\") || command.startsWith(".")) return false;
    return command.toLowerCase().startsWith(normalized);
  });
}

function codeMirrorTypeForKind(kind: CompletionItem["kind"]): string {
  switch (kind) {
    case "schema":
      return "namespace";
    case "table":
    case "view":
      return "type";
    case "column":
      return "property";
    case "meta-command":
      return "keyword";
    default:
      return kind;
  }
}

function coreValidFor(result: CoreCompletionResult): RegExp {
  const hasMetaCommand = result.items.some(
    (item) => item.kind === "meta-command",
  );
  const hasOperator = result.items.some((item) => item.kind === "operator");
  const hasQuotedIdentifier = result.items.some(
    (item) => typeof item.apply === "string" && item.apply.startsWith("`"),
  );
  if (hasMetaCommand) return /^[\w$.\\]*$/;
  if (hasQuotedIdentifier) return /^`?[\w$]*`?$/;
  return hasOperator ? /^[\w$+\-*/<>=~!@#%^&|`?]*$/ : /^[\w$]*$/;
}

function dedupeCompletions(options: readonly Completion[]): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const option of options) {
    const key = [
      option.label.toLowerCase(),
      option.type ?? "",
      option.detail ?? "",
      typeof option.apply === "string" ? option.apply : "",
    ].join("\0");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
  }
  return out;
}

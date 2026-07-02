import type { Paradigm } from "@/types/connection";
import type { QueryLanguageId } from "@/types/dataSource";
import { getQueryLanguageMetadata } from "@/types/queryLanguage";
import type {
  DocumentQueryMode,
  HistoryQueryMode,
  RdbQueryMode,
} from "@lib/tauri/history";

export type WorkspaceQueryMode = "sql" | "find" | "aggregate";

export type DocumentWorkspaceQueryModeInput =
  | DocumentQueryMode
  | "countDocuments";

export type WorkspaceQueryModeInput =
  | HistoryQueryMode
  | { paradigm: "rdb"; queryMode?: RdbQueryMode | null }
  | {
      paradigm: "document";
      queryMode?: DocumentWorkspaceQueryModeInput | null;
    }
  | { paradigm: Exclude<Paradigm, "rdb" | "document">; queryMode?: unknown };

export function toWorkspaceQueryMode(input: {
  paradigm: Paradigm;
  queryMode?: unknown;
}): WorkspaceQueryMode | undefined {
  if (input.paradigm === "rdb") {
    return "sql";
  }
  if (input.paradigm === "document") {
    return input.queryMode === "find" || input.queryMode === "aggregate"
      ? input.queryMode
      : undefined;
  }
  return undefined;
}

export function sanitizeWorkspaceQueryMode(
  paradigm: Paradigm,
  queryMode: unknown,
): WorkspaceQueryMode | undefined {
  return toWorkspaceQueryMode({ paradigm, queryMode });
}

export function toWorkspaceQueryLanguage(input: {
  paradigm: Paradigm;
  queryLanguage?: unknown;
}): QueryLanguageId | undefined {
  if (input.paradigm === "rdb") {
    return "sql";
  }
  if (input.paradigm === "document") {
    return "mongosh";
  }
  if (input.paradigm === "kv") {
    return "redis-command";
  }
  if (input.paradigm === "search") {
    return "search-dsl";
  }
  return isQueryLanguageId(input.queryLanguage)
    ? input.queryLanguage
    : undefined;
}

/**
 * User-facing query-language label for a paradigm's log/history entry.
 * Resolves through {@link toWorkspaceQueryLanguage} + the shared
 * `QUERY_LANGUAGE_REGISTRY` so surfaces never re-hardcode per-paradigm
 * strings (#1055). The `?? ""` branch is unreachable for the active
 * paradigms — all four resolve to a registered language id.
 */
export function toQueryLanguageLabel(paradigm: Paradigm): string {
  const id = toWorkspaceQueryLanguage({ paradigm });
  return id ? getQueryLanguageMetadata(id).label : "";
}

function isQueryLanguageId(value: unknown): value is QueryLanguageId {
  return (
    value === "sql" ||
    value === "mongosh" ||
    value === "redis-command" ||
    value === "search-dsl" ||
    value === "cql" ||
    value === "partiql" ||
    value === "cypher" ||
    value === "gql" ||
    value === "gremlin" ||
    value === "vector-query" ||
    value === "stream-command"
  );
}

import type { Paradigm } from "@/types/connection";
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
}): WorkspaceQueryMode {
  if (input.paradigm === "rdb") {
    return "sql";
  }
  if (input.paradigm === "document") {
    return input.queryMode === "aggregate" ? "aggregate" : "find";
  }
  return "sql";
}

export function sanitizeWorkspaceQueryMode(
  paradigm: Paradigm,
  queryMode: unknown,
): WorkspaceQueryMode {
  return toWorkspaceQueryMode({ paradigm, queryMode });
}

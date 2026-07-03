/**
 * Sprint 373 (Phase 5 F.5) — `add_history_entry` IPC 의 thin caller.
 *
 * 작성 2026-05-17. 6 source caller (raw / grid-edit / ddl-structure /
 * mongo-op / explain / sidebar-prefetch) 가 공유. 책임:
 *
 *   1. `useHistorySettingsStore.queryHistoryEnabled` 가 false 면 early
 *      return — IPC 호출 자체를 skip 한다 (AC-373-03 invariant).
 *   2. 호출자가 넘긴 history input shape (`paradigm` + `queryMode` +
 *      `duration` + 기타) 을 backend wire shape (discriminated union +
 *      `durationMs`) 으로 normalise.
 *   3. `useQueryHistoryStore.addOptimisticEntry` 에 위임 — optimistic
 *      `recentVisible` prepend + backend IPC.
 *
 * RDB paradigm 의 `queryMode` 는 항상 `"sql"` 로 normalise (backend
 * `RdbQueryMode` 의 유일한 variant). Document paradigm 의 legacy mode
 * `"countDocuments"` 는 backend `"count"` 로 매핑 — 그 외에는 그대로 통과.
 *
 * 함수 노출 이유 (hook 이 아님): non-React 모듈 / hook 안 useCallback 안
 * 양쪽에서 동일 진입점을 쓸 수 있도록 plain function. React 컴포넌트도
 * 필요 시 `useHistorySettingsStore((s) => s.queryHistoryEnabled)` 로
 * subscribe 해서 추가 selector 캐싱을 할 수 있다 — 본 함수는 호출 시점에
 * `useHistorySettingsStore.getState()` 로 truth 를 직접 읽으므로 selector
 * 캐싱 없이도 정확.
 */

import type { Paradigm } from "@/types/connection";
import {
  useQueryHistoryStore,
  type QueryHistorySource,
} from "@stores/queryHistoryStore";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import type {
  AddHistoryEntryRequest,
  DocumentQueryMode,
  RdbQueryMode,
} from "@lib/tauri/history";

export type DocumentRecordHistoryQueryMode =
  | DocumentQueryMode
  | "countDocuments";

interface RecordHistoryEntryCommonArgs {
  /** Connection id; required (snapshot truth from tab/grid context). */
  connectionId: string;
  /** Optional db/collection (document paradigm 의 경우 거의 항상 set). */
  database?: string;
  collection?: string;
  /** Source label — 호출자가 명시. */
  source: QueryHistorySource;
  /** 원본 SQL 또는 mongosh 표현. backend 가 `sql_redacted` 생성. */
  sql: string;
  /** `"success" | "error" | "cancelled"`. */
  status: "success" | "error" | "cancelled";
  /** 사용자 시계 unix ms. backend 가 5min drift 시 override (sprint-371). */
  executedAt: number;
  /** legacy 인자명 — backend wire 는 `durationMs`. */
  duration: number;
  /** optional metadata. */
  tabId?: string;
  errorMessage?: string;
  rowsAffected?: number;
  serverPid?: number;
}

export type RecordHistoryEntryArgs = RecordHistoryEntryCommonArgs &
  (
    | { paradigm: "rdb"; queryMode?: RdbQueryMode }
    | {
        paradigm: "document";
        queryMode?: DocumentRecordHistoryQueryMode;
      }
    | {
        paradigm: Exclude<Paradigm, "rdb" | "document">;
        queryMode?: never;
      }
  );

/**
 * Frontend history input → backend `DocumentQueryMode` 매핑.
 * `countDocuments` 가 유일한 legacy method-name 정정 — 나머지는 1:1.
 * `kv` / `search` paradigm 은 `toAddHistoryEntryRequest` 가 고정 query mode
 * (`command` / `dsl`) 로 직접 처리 (#1171) — 본 함수는 document 전용.
 */
function toDocumentQueryMode(
  mode: DocumentRecordHistoryQueryMode | undefined,
): DocumentQueryMode | null {
  if (mode === undefined) {
    return "find";
  }
  switch (mode) {
    case "countDocuments":
      return "count";
    case "find":
    case "findOne":
    case "aggregate":
    case "count":
    case "estimatedDocumentCount":
    case "distinct":
    case "insertOne":
    case "insertMany":
    case "updateOne":
    case "updateMany":
    case "replaceOne":
    case "deleteOne":
    case "deleteMany":
    case "createIndex":
    case "dropIndex":
    case "bulkWrite":
      return mode;
    default:
      return null;
  }
}

/**
 * Frontend history input → backend `AddHistoryEntryRequest`.
 * Invalid runtime pair 는 기존 동작대로 silent skip (`null`) 한다.
 */
function toAddHistoryEntryRequest(
  args: RecordHistoryEntryArgs,
): AddHistoryEntryRequest | null {
  const common = {
    connectionId: args.connectionId,
    tabId: args.tabId,
    database: args.database,
    collection: args.collection,
    source: args.source,
    sql: args.sql,
    status: args.status,
    errorMessage: args.errorMessage,
    rowsAffected: args.rowsAffected,
    durationMs: args.duration,
    executedAt: args.executedAt,
    serverPid: args.serverPid,
  } as const;

  if (args.paradigm === "rdb") {
    if (args.queryMode !== undefined && args.queryMode !== "sql") {
      return null;
    }
    return {
      ...common,
      paradigm: "rdb",
      queryMode: "sql",
    };
  }

  if (args.paradigm === "document") {
    const queryMode = toDocumentQueryMode(args.queryMode);
    if (!queryMode) {
      return null;
    }
    return {
      ...common,
      paradigm: "document",
      queryMode,
    };
  }

  // Issue #1171 — kv (Redis/Valkey) / search (ES/OpenSearch) now record. Each
  // paradigm has a single backend query mode; the display path labels by
  // paradigm (#1055/#1166), so the fixed mode is all the wire needs.
  if (args.paradigm === "kv") {
    return { ...common, paradigm: "kv", queryMode: "command" };
  }
  if (args.paradigm === "search") {
    return { ...common, paradigm: "search", queryMode: "dsl" };
  }

  return null;
}

/**
 * 메인 진입점. 모든 history caller 가 본 함수를 호출.
 *
 * "Disable history" 토글 (`query_history_enabled = false`) 검사가 본
 * 함수의 첫 줄 — 토글 OFF 일 때는 IPC 호출 path 가 0 (AC-373-03 spy
 * test 가 본 invariant 를 lock).
 */
export function recordHistoryEntry(args: RecordHistoryEntryArgs): void {
  void recordHistoryEntryAsync(args);
}

/**
 * Awaitable variant for UI paths whose next visible state depends on the
 * backend list-history row being committed before they expose a history view.
 */
export async function recordHistoryEntryAsync(
  args: RecordHistoryEntryArgs,
): Promise<void> {
  if (!useHistorySettingsStore.getState().queryHistoryEnabled) {
    return;
  }

  const req = toAddHistoryEntryRequest(args);
  if (!req) {
    return;
  }

  // Error 는 store 내부에서 logger.warn 으로만 노출 (best-effort).
  await useQueryHistoryStore.getState().addOptimisticEntry(req);
}

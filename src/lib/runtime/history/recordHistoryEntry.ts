/**
 * Sprint 373 (Phase 5 F.5) — `add_history_entry` IPC 의 thin caller.
 *
 * 작성 2026-05-17. 5 source caller (raw / grid-edit / ddl-structure /
 * mongo-op / sidebar-prefetch) 가 공유. 책임:
 *
 *   1. `useHistorySettingsStore.queryHistoryEnabled` 가 false 면 early
 *      return — IPC 호출 자체를 skip 한다 (AC-373-03 invariant).
 *   2. 호출자가 넘긴 history input shape (`paradigm` + `queryMode` +
 *      `duration` + 기타) 을 backend wire shape (discriminated union +
 *      `durationMs`) 으로 normalise.
 *   3. `useQueryHistoryStore.addOptimisticEntry` 에 위임 — optimistic
 *      `recentVisible` prepend + backend IPC fire.
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
  /** 5 source label — 호출자가 명시. */
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
 * `kv` / `search` paradigm 은 본 sprint 범위 밖이라 호출자가
 * `paradigm: "rdb" | "document"` 만 넘긴다 (외 paradigm 은 호출 site 가 없음).
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
 * 메인 진입점. 5 caller 모두 본 함수를 호출.
 *
 * "Disable history" 토글 (`query_history_enabled = false`) 검사가 본
 * 함수의 첫 줄 — 토글 OFF 일 때는 IPC 호출 path 가 0 (AC-373-03 spy
 * test 가 본 invariant 를 lock).
 */
export function recordHistoryEntry(args: RecordHistoryEntryArgs): void {
  if (!useHistorySettingsStore.getState().queryHistoryEnabled) {
    return;
  }

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

  let req: AddHistoryEntryRequest;
  if (args.paradigm === "rdb") {
    if (args.queryMode !== undefined && args.queryMode !== "sql") {
      return;
    }
    req = {
      ...common,
      paradigm: "rdb",
      queryMode: "sql",
    };
  } else if (args.paradigm === "document") {
    const queryMode = toDocumentQueryMode(args.queryMode);
    if (!queryMode) {
      return;
    }
    req = {
      ...common,
      paradigm: "document",
      queryMode,
    };
  } else {
    // kv / search — no backend wire support today. silent skip to avoid
    // backend serde reject (`paradigm: "kv"` 자체가 union 에 부재).
    return;
  }

  // Promise 반환 안 받음 — fire-and-forget. error 는 store 내부에서
  // logger.warn 으로만 노출 (best-effort).
  void useQueryHistoryStore.getState().addOptimisticEntry(req);
}

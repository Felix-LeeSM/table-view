/**
 * Sprint 373 (Phase 5 F.5) — `queryHistoryStore` thin wrapper.
 *
 * 작성 2026-05-17 — sprint-371 backend IPC + sprint-372 hook 도착 직후의
 * 잔여 in-memory `entries` / `globalLog` field 를 retire 한다. backend
 * `query_history` 가 single source of truth — store 는 (a) optimistic
 * insert 직후 사용자에게 즉시 row 를 보여주는 `recentVisible` cache 와
 * (b) write helper (`addOptimisticEntry`) + (c) list refetch 결과를 받는
 * setter (`setRecentVisible`) 만 보유.
 *
 * 사유 (요약):
 *   - In-memory `entries` 는 process 메모리에 한정 — cross-window 공유 불가.
 *     sprint-365 의 `state-changed` event + sprint-372 의 `useQueryHistory`
 *     hook 으로 단일 backend truth 가 multi-window 에 dispatch 된다.
 *   - `globalLog` 의 500 cap 은 disk-backed retention (sprint-371 의
 *     `boot_vacuum_old_history` + sprint-373 의 `query_history_retention_days`
 *     setting) 로 대체.
 *   - "Disable history" 토글 (`query_history_enabled`) 은 호출자가
 *     `useSettings().queryHistoryEnabled` 를 확인하고 `addOptimisticEntry`
 *     자체를 호출 안 함으로써 enforce — store 내부 분기 없음.
 */

import { create } from "zustand";
import {
  addHistoryEntry as addHistoryEntryIpc,
  type AddHistoryEntryRequest,
  type HistoryListRow,
} from "@lib/tauri/history";
import { logger } from "@lib/logger";

/**
 * Origin of the recorded query/operation. Lets the UI distinguish a raw
 * query the user typed from generated SQL emitted by another surface.
 *
 * - `raw`              — user-typed SQL / MQL from the QueryTab editor.
 * - `grid-edit`        — DataGrid pending-edit commit (RDB batch / Mongo
 *                       dispatchMqlCommand) + EditableQueryResultGrid edits.
 * - `ddl-structure`    — StructurePanel editors + SchemaTree drop-table.
 * - `mongo-op`         — Mongo-specific direct ops that bypass the grid
 *                       pending pipeline (e.g. Add Document modal).
 * - `sidebar-prefetch` — sprint-373 새 source. Sidebar 의 preview-rows
 *                       (사용자가 sidebar tree 에서 collection/table 을
 *                       클릭해 DataGrid 로 열 때) prefetch row 가 비-동
 *                       backend SELECT 으로 기록된다.
 */
export type QueryHistorySource =
  | "raw"
  | "grid-edit"
  | "ddl-structure"
  | "mongo-op"
  | "sidebar-prefetch";

interface QueryHistoryState {
  /**
   * sprint-372 (Phase 5 F.5) — thin-wrapper field. Visible history rows
   * after a backend `list_history` fetch. Populated/managed by the
   * `useQueryHistory` hook + cross-window `history.create` / `clear`
   * receivers. The store itself only holds the slot so consumers that
   * still read off zustand can subscribe to it.
   */
  recentVisible: HistoryListRow[];

  /**
   * sprint-372 — optimistic prepend after a user-triggered query, then
   * fire-and-forget the backend `add_history_entry` IPC. Backend emits
   * `history.create`; sprint-365 dispatcher self-echo-skips the origin
   * window so we don't double-insert. Errors are best-effort
   * (logger.warn only); the next backend list refetch is the recovery
   * path.
   *
   * sprint-373 — only writer the store offers. Callers gate on
   * `useQueryHistoryEnabledSetting()` BEFORE invoking — when the user
   * disabled history this function is never reached and the backend IPC
   * count is zero (AC-373-03).
   */
  addOptimisticEntry: (req: AddHistoryEntryRequest) => Promise<void>;
  /** sprint-372 — `useQueryHistory` 의 list 결과를 store 에 저장. */
  setRecentVisible: (rows: HistoryListRow[]) => void;
}

export const useQueryHistoryStore = create<QueryHistoryState>((set) => ({
  recentVisible: [],

  setRecentVisible: (rows) => set({ recentVisible: rows }),

  addOptimisticEntry: async (req) => {
    // 1. Optimistic prepend — sql_redacted 가 backend 생성이므로 본
    //    시점에는 `sqlRedacted` 를 `sql` 로 채워둔다. backend 응답이
    //    오면 정상 redact 본으로 덮어쓴다 (아래 set 호출).
    const tempId = -Date.now();
    const tempRow: HistoryListRow = {
      id: tempId,
      connectionId: req.connectionId,
      tabId: req.tabId ?? null,
      paradigm: req.paradigm,
      queryMode: req.queryMode,
      database: req.database ?? null,
      collection: req.collection ?? null,
      source: req.source,
      sqlRedacted: req.sql,
      status: req.status,
      errorMessage: req.errorMessage ?? null,
      rowsAffected: req.rowsAffected ?? null,
      durationMs: req.durationMs,
      executedAt: req.executedAt,
      serverPid: req.serverPid ?? null,
    };
    set((state) => ({ recentVisible: [tempRow, ...state.recentVisible] }));

    // 2. Backend IPC — emits `history.create`; origin window self-echoes
    //    skip via sprint-365 dispatcher.
    try {
      const resp = await addHistoryEntryIpc(req);
      set((state) => ({
        recentVisible: state.recentVisible.map((r) =>
          r.id === tempId
            ? { ...r, id: resp.id, sqlRedacted: resp.sqlRedacted }
            : r,
        ),
      }));
    } catch (e) {
      // best-effort — backend 가 reject 하면 다음 refetch 가 truth 를
      // 다시 잡는다. optimistic row 는 그대로 두고 사용자에게는 보이는
      // 그대로 — 잠시 후 새 list 에서 빠진다. logger 만 남긴다.
      logger.warn(
        "[queryHistoryStore.addOptimisticEntry] backend reject",
        e instanceof Error ? e.message : e,
      );
    }
  },
}));

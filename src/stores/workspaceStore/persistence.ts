/**
 * `workspaceStore` persistence helpers — ADR 0027 + sprint-358 (Phase 1 W1
 * dual-write).
 *
 *   - `STORAGE_KEY = "table-view-workspaces"` — **read-only** as of sprint-358.
 *     The fossil key remains for the boot-time legacy LS import path (see
 *     `import_legacy_localstorage`). All write sites have moved to the
 *     SQLite-only `persist_workspace` IPC (codex 6차 #5).
 *   - `persistWorkspaces` dehydrates every `(connId, db)` cell and UPSERTs it
 *     through the `persist_workspace` IPC (#1091, sprint-365). It no longer
 *     touches localStorage; callers continue to invoke it from the same hooks.
 *   - `debouncePersistWorkspaces` honors the 200ms coalescing window so a burst
 *     of edits (e.g. typing in a query tab) collapses into one IPC flush.
 *   - `migrateLoadedWorkspaces` rehydration step: collapses in-flight
 *     `QueryTab.queryState` to idle and backfills `sidebar` defaults so
 *     downstream consumers can drop guards.
 */
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import {
  persistWorkspace,
  type PersistWorkspaceRequest,
} from "@lib/tauri/workspaces";
import type { Paradigm } from "@/types/connection";
import type { Tab, WorkspaceQueryMode, WorkspaceState } from "./types";
import {
  sanitizeWorkspaceQueryMode,
  toWorkspaceQueryLanguage,
} from "./queryMode";

export const STORAGE_KEY = "table-view-workspaces";

/**
 * Sprint 353 (Phase 0 dehydration, state-management-strategy Q16/M-1).
 * Strips memory-only fields from a `WorkspaceState` before LS write so
 * the persisted blob carries no transient invariants.
 */
function stripQueryState(tab: Tab): Tab {
  if (tab.type !== "query") return tab;
  return { ...tab, queryState: { status: "idle" as const } };
}

export function dehydrate(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    dirtyTabIds: [],
    sidebar: {
      ...state.sidebar,
      selectedNode: null,
      scrollTop: 0,
    },
    tabs: state.tabs.map(stripQueryState),
    closedTabHistory: state.closedTabHistory.slice(0, 25).map(stripQueryState),
  };
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sprint 375 (Phase 6 cleanup, 2026-05-17) — test-only escape hatch for
 * the module-scope `persistTimer`. The 200ms debounce handle is kept in
 * a module variable (not Zustand state) so the timer survives across
 * store mutations without being treated as React-driving state; that means
 * a test that mounts the store, fires a `debouncePersistWorkspaces` call,
 * and tears down without awaiting the timeout will leak a pending
 * `setTimeout` into the next test. The helper drains the handle without
 * running the callback, so the next test starts from a clean ledger.
 * Mirrors `__resetCountersForTests` in `workspaceStore.ts` (sprint-354)
 * and `__resetFavoriteCounterForTests` in `favoritesStore.ts`. Namespaced
 * `__` to flag intent.
 */
export function __resetPersistTimerForTests(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
}

export type WorkspacesShape = Record<string, Record<string, WorkspaceState>>;

function dehydrateAll(workspaces: WorkspacesShape): WorkspacesShape {
  const out: WorkspacesShape = {};
  for (const connId of Object.keys(workspaces)) {
    const byDb = workspaces[connId];
    if (!byDb) continue;
    const conn: Record<string, WorkspaceState> = {};
    for (const db of Object.keys(byDb)) {
      const ws = byDb[db];
      if (!ws) continue;
      conn[db] = dehydrate(ws);
    }
    out[connId] = conn;
  }
  return out;
}

function toPersistRequest(
  connectionId: string,
  dbName: string,
  ws: WorkspaceState,
): PersistWorkspaceRequest {
  return {
    connectionId,
    dbName,
    activeTabId: ws.activeTabId,
    tabsJson: JSON.stringify(ws.tabs),
    sidebarExpandedJson: JSON.stringify(ws.sidebar.expanded),
    closedTabsJson: JSON.stringify(ws.closedTabHistory),
  };
}

export function persistWorkspaces(workspaces: WorkspacesShape): void {
  if (typeof window === "undefined") return;
  // Sprint 358 (Phase 1 W1) — workspaces 는 codex 6차 #5 결정에 따라 SQLite-only.
  // #1091 (sprint-365) — dehydrate every `(connId, db)` cell and UPSERT it
  // through the `persist_workspace` IPC. sprint-358 left this a no-op
  // (`void dehydrateAll`) so a restart lost every tab / SQL. The 200ms
  // debounce already coalesces bursts, so this per-workspace loop is bounded
  // by the number of open workspaces (typically 1–3) — no dirty-diff bookkeeping.
  const dehydrated = dehydrateAll(workspaces);
  const pending: Promise<void>[] = [];
  for (const connId of Object.keys(dehydrated)) {
    const byDb = dehydrated[connId];
    if (!byDb) continue;
    for (const db of Object.keys(byDb)) {
      const ws = byDb[db];
      if (!ws) continue;
      pending.push(persistWorkspace(toPersistRequest(connId, db, ws)));
    }
  }
  if (pending.length === 0) return;
  // Fire-and-forget mirror of the mru/favorites contract (#1092): SQLite is
  // the single SOT with no boot reconcile, so a swallowed write is lost on the
  // next restart — the exact silent-loss #1091 fixes. Surface a dev log + one
  // `storageWriteFailed` toast, deduped to a single toast per debounced flush
  // so a multi-workspace failure never stacks N toasts.
  void Promise.allSettled(pending).then((results) => {
    const failed = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (failed.length === 0) return;
    const reason = failed[0]!.reason;
    const message =
      reason instanceof Error ? reason.message : String(reason ?? "");
    logger.warn(
      `[workspaceStore] persist_workspace failed (${failed.length}): ${message}`,
    );
    toast.error(i18n.t("feedback:storageWriteFailed"));
  });
}

export function debouncePersistWorkspaces(workspaces: WorkspacesShape): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistWorkspaces(workspaces);
    persistTimer = null;
  }, 200);
}

function migrateTab(t: Tab, workspaceDb: string): Tab {
  if (t.type === "query") {
    const paradigm: Paradigm = t.paradigm ?? "rdb";
    const queryMode: WorkspaceQueryMode | undefined =
      sanitizeWorkspaceQueryMode(paradigm, t.queryMode);
    const queryLanguage = toWorkspaceQueryLanguage({
      paradigm,
      queryLanguage: t.queryLanguage,
    });
    return {
      ...t,
      queryState: { status: "idle" as const },
      paradigm,
      queryMode,
      queryLanguage,
    };
  }
  if (t.type === "table") {
    const paradigm = t.paradigm ?? ("rdb" as const);
    const isDocument = paradigm === "document";
    const database = isDocument
      ? (t.database ?? t.schema ?? workspaceDb)
      : (t.database ?? workspaceDb);
    const collection = isDocument ? (t.collection ?? t.table) : t.collection;
    return {
      ...t,
      isPreview: false,
      paradigm,
      sorts: t.sorts ?? [],
      database,
      collection,
    };
  }
  return t;
}

function migrateWorkspace(
  raw: Partial<WorkspaceState>,
  workspaceDb: string,
): WorkspaceState {
  return {
    tabs: (raw.tabs ?? []).map((tab) => migrateTab(tab, workspaceDb)),
    activeTabId: raw.activeTabId ?? null,
    closedTabHistory: (raw.closedTabHistory ?? []).map((tab) =>
      migrateTab(tab, workspaceDb),
    ),
    dirtyTabIds: raw.dirtyTabIds ?? [],
    sidebar: {
      selectedNode: raw.sidebar?.selectedNode ?? null,
      expanded: raw.sidebar?.expanded ?? [],
      scrollTop: raw.sidebar?.scrollTop ?? 0,
    },
  };
}

export function migrateLoadedWorkspaces(
  raw: Record<string, Record<string, Partial<WorkspaceState>>>,
): WorkspacesShape {
  const out: WorkspacesShape = {};
  for (const connId of Object.keys(raw)) {
    const byDb = raw[connId];
    if (!byDb) continue;
    const conn: Record<string, WorkspaceState> = {};
    for (const db of Object.keys(byDb)) {
      const ws = byDb[db];
      if (!ws) continue;
      conn[db] = migrateWorkspace(ws, db);
    }
    out[connId] = conn;
  }
  return out;
}

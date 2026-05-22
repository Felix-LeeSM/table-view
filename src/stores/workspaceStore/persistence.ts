/**
 * `workspaceStore` persistence helpers — ADR 0027 + sprint-358 (Phase 1 W1
 * dual-write).
 *
 *   - `STORAGE_KEY = "table-view-workspaces"` — **read-only** as of sprint-358.
 *     The fossil key remains for the boot-time legacy LS import path (see
 *     `import_legacy_localstorage`). All write sites have moved to the
 *     SQLite-only `persist_workspace` IPC (codex 6차 #5).
 *   - `persistWorkspaces` retains its dehydration responsibilities but no
 *     longer touches localStorage. Callers continue to invoke it from the
 *     same hooks; the IPC bridge will land in sprint-365 (consumer hook-up).
 *   - `debouncePersistWorkspaces` is preserved so the call sites do not need
 *     to be rewritten in this sprint; the underlying body is a no-op-equivalent
 *     for LS but still honors the 200ms coalescing window for the future IPC.
 *   - `migrateLoadedWorkspaces` rehydration step: collapses in-flight
 *     `QueryTab.queryState` to idle and backfills `sidebar` defaults so
 *     downstream consumers can drop guards.
 */
import type { Paradigm } from "@/types/connection";
import type { QueryMode, Tab, WorkspaceState } from "./types";

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

export function persistWorkspaces(workspaces: WorkspacesShape): void {
  if (typeof window === "undefined") return;
  // Sprint 358 (Phase 1 W1) — workspaces 는 codex 6차 #5 결정에 따라
  // SQLite-only. file/LS write 사이트 제거. backend `persist_workspace` IPC
  // 가 SQLite UPSERT 를 담당한다 (consumer hook-up 은 sprint-365).
  //
  // 본 함수는 dehydration 작업을 보존하기 위해 호출 사이트와 시그너처를 유지.
  // 향후 IPC 연결 sprint 가 본 함수 body 안에서 `invoke("persist_workspace", ...)`
  // 호출만 추가하면 된다. **write 가 LS 로 가지 않는다는 invariant 는 본 sprint
  // 에서 잠긴 것** — `persistence.no-ls-write.test.ts` 가 회귀 가드.
  void dehydrateAll(workspaces);
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
    const queryMode: QueryMode =
      t.queryMode ?? (paradigm === "rdb" ? "sql" : "find");
    return {
      ...t,
      queryState: { status: "idle" as const },
      paradigm,
      queryMode,
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

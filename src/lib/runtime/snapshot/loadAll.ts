/**
 * Sprint 367 (Phase 4) — atomic snapshot hydration + listener pre-register.
 *
 * Boot critical path:
 *
 *   1. `registerSnapshotListener()` — `listen("state-changed", …)` 등록.
 *      등록 직후 buffer 모드가 ON 이며, dispatch 는 사프린트-365 의
 *      `dispatchStateChangedPayload` 으로 위임하지 않고 큐에 적재.
 *   2. `loadAllFromSnapshot()` — `getInitialAppState()` IPC 호출. fake fast
 *      path < 100ms. 응답이 도착하면 5 boot-critical store + runtime
 *      `activeStatuses` 를 await Promise.all 로 일괄 hydrate.
 *   3. snapshot 적용 후 buffer drain. snapshotVersion <= snap.snapshotVersion 인
 *      event 는 이미 truth 에 포함되어 있으므로 drop (중복 dispatch 방지).
 *      newer event 는 sprint-365 의 dispatch 로 1회 전달.
 *
 * Failure 처리 (AC-367-05):
 *
 *   - IPC reject 시 store 는 default 그대로 유지 — partial hydrate 0.
 *   - `toast.error("Failed to load app state …", { action: { label: "Retry", … } })`
 *     로 사용자에게 노출. Retry click → `loadAllFromSnapshot()` 재호출.
 *   - listener 는 등록된 채로 유지 + buffer 활성 → 다음 retry 에서 race-window
 *     event 가 다시 잡힌다.
 *
 * In Scope (sprint-367):
 *   - 5 store hydrate path + runtime mirror.
 *   - listener buffer drain.
 *
 * Out of Scope:
 *   - 9 domain receiver 본문 (sprint-365 완료).
 *   - LS retire — theme/safeMode (sprint-368), datagrid prefs (sprint-369).
 *   - `useCurrentWindowConnectionId` (sprint-366).
 */

// CRITICAL: listener registration MUST precede the IPC call line below.
// AC-367-03 (codex 2차 #12 strict order) regression-locked by
// `loadAll.listener-order.test.ts` — the static grep test scans this file for
// `listen("state-changed"` and `getInitialAppState(` and asserts the former
// appears at a lower line number. Do NOT swap the imports or relocate the
// `registerSnapshotListener` body below the IPC call site.

import { getInitialAppState, type InitialAppState } from "@lib/tauri/snapshot";
import { dispatchStateChangedPayload } from "@lib/events/stateChanged";
import { getCurrentWindowLabel } from "@lib/window-label";
import { toast } from "@lib/runtime/toast";
import { logger } from "@lib/logger";

import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore, type WorkspaceState } from "@stores/workspaceStore";
import { toWorkspaceQueryLanguage } from "@stores/workspaceStore/queryMode";
import { useMruStore, type MruEntry } from "@stores/mruStore";
import { useThemeStore } from "@stores/themeStore";
import { useSafeModeStore, type SafeMode } from "@stores/safeModeStore";
import type { Paradigm } from "@/types/connection";
import type { ThemeMode } from "@lib/themeBoot";
import { DEFAULT_THEME_ID, isThemeId } from "@lib/themeCatalog";
import {
  normalizeActiveStatuses,
  normalizeConnectionConfig,
  normalizeQueryState,
} from "@lib/wireCamelCase";

// ---------------------------------------------------------------------------
// Listener buffer — collects `state-changed` events that arrive while a
// snapshot read is in-flight. Drained after `applyToStores` mutates.
// ---------------------------------------------------------------------------

interface BufferedEvent {
  payload: unknown;
}

/**
 * `bufferActive` = true → listener queues events into `buffer` instead of
 * dispatching. Set ON at boot, briefly OFF after `applyToStores`, then back
 * ON if the IPC rejects (so a retry can drain race-window events).
 */
let bufferActive = false;
let buffer: BufferedEvent[] = [];
let unlistenFn: (() => void) | null = null;
let listenerRegistered = false;

/**
 * Register the singleton `state-changed` listener for this window. The
 * handler queues into `buffer` while `bufferActive` is true, otherwise
 * dispatches straight to the sprint-365 router.
 *
 * Best-effort: if the Tauri runtime is unavailable (vitest jsdom default),
 * returns silently. Tests inject buffered events via
 * {@link __pushFakeBufferedEvent} instead of round-tripping through Tauri.
 */
export async function registerSnapshotListener(): Promise<void> {
  if (listenerRegistered) return;
  listenerRegistered = true;
  bufferActive = true;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    // The literal `listen("state-changed"` substring below is what the
    // listener-order grep test pattern-matches against — keep it in source.
    const unlisten = await listen<unknown>("state-changed", (event) => {
      handleIncomingEvent(event.payload);
    });
    unlistenFn = unlisten;
  } catch {
    // Tauri runtime unavailable — vitest jsdom path. Tests drive the
    // listener via `__pushFakeBufferedEvent`.
  }
}

function handleIncomingEvent(payload: unknown): void {
  if (bufferActive) {
    buffer.push({ payload });
    return;
  }
  // Buffer is drained — route to sprint-365 dispatcher immediately.
  const label = getCurrentWindowLabel() ?? "";
  dispatchStateChangedPayload(label, payload);
}

/**
 * Vitest helper: inject an event into the buffer as if Tauri had emitted
 * one during the in-flight snapshot read. Used by `loadAll.listener-order`
 * to simulate the backend race window without standing up Tauri.
 */
export function __pushFakeBufferedEvent(payload: unknown): void {
  handleIncomingEvent(payload);
}

/**
 * Vitest helper: reset the buffer + bufferActive flag between tests so a
 * single test's leftover events cannot leak into the next.
 */
export function resetSnapshotBufferForTests(): void {
  buffer = [];
  bufferActive = false;
  listenerRegistered = false;
  if (unlistenFn) {
    try {
      unlistenFn();
    } catch {
      // ignore — Tauri may already be torn down between tests.
    }
    unlistenFn = null;
  }
}

/** AC-367-05 evidence helper — true while the buffer is collecting events. */
export function isSnapshotBufferActive(): boolean {
  return bufferActive;
}

// ---------------------------------------------------------------------------
// Snapshot orchestrator
// ---------------------------------------------------------------------------

/**
 * Atomic boot hydration.
 *
 *   1. Ensure the listener is registered + buffer active.
 *   2. Call `getInitialAppState()` IPC.
 *   3. await Promise.all over the 5 boot-critical store hydrate paths +
 *      `runtime.activeStatuses` mirror.
 *   4. Drain the buffer — dispatch every event whose `snapshotVersion >
 *      snap.snapshotVersion` (newer than what snapshot already encoded).
 *   5. Flip `bufferActive` OFF — subsequent events dispatch directly.
 *
 * On IPC failure: re-enable the buffer (so a Retry catches race events),
 * push an error toast with a Retry action, and re-throw so `main.tsx` can
 * fall through to a degraded boot.
 */
export async function loadAllFromSnapshot(): Promise<InitialAppState> {
  // Guarantee the listener is up before the IPC kicks off. Idempotent.
  await registerSnapshotListener();

  let snap: InitialAppState;
  try {
    snap = await getInitialAppState();
  } catch (e) {
    // Failure path — store remains at default (no partial hydrate).
    // Buffer stays active so a future Retry sees race-window events.
    bufferActive = true;
    const message =
      e instanceof Error ? e.message : String(e ?? "unknown error");
    logger.error("[snapshot] boot hydrate failed:", message);
    toast.error(
      "Failed to load app state from snapshot. Click Retry to try again.",
      {
        durationMs: null, // sticky — the user must act.
        action: {
          label: "Retry",
          onClick: () => {
            void loadAllFromSnapshot().catch(() => {
              // Re-thrown again — the next failure pushes a fresh toast.
            });
          },
        },
      },
    );
    throw e;
  }

  await applyToStores(snap);

  if (snap.recovered) {
    toast.warning(
      "앱 상태를 초기화했어요. 기존 데이터는 state.db.bak 백업에 있습니다.",
      { durationMs: 8000 },
    );
  }

  drainBuffer(snap.snapshotVersion);
  bufferActive = false;

  return snap;
}

/**
 * Apply the snapshot to the 5 boot-critical stores + runtime mirror.
 * `Promise.all` invariant (contract Invariants line 35) — every store
 * receiver returns synchronously today but the Promise.all shape guards
 * against accidental serialization if a future receiver goes async.
 */
async function applyToStores(snap: InitialAppState): Promise<void> {
  await Promise.all([
    hydrateConnections(snap),
    hydrateWorkspaces(snap),
    hydrateMru(snap),
    hydrateTheme(snap),
    hydrateSafeMode(snap),
    hydrateRuntimeActiveStatuses(snap),
  ]);
}

// ---------------------------------------------------------------------------
// Per-store hydrate receivers. Each receiver tolerates the `{ error }` partial
// slot by leaving that store at default.
// ---------------------------------------------------------------------------

async function hydrateConnections(snap: InitialAppState): Promise<void> {
  const slot = snap.stores.connections;
  if ("error" in slot) {
    // partial slot — leave default. Dev banner is handled by snapshot.ts
    // partial flag at a higher layer.
    return;
  }
  useConnectionStore
    .getState()
    .hydrateConnectionsFromSnapshot(
      slot.items.map(normalizeConnectionConfig),
      slot.groups,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeWorkspaceTab(value: unknown): unknown {
  if (!isRecord(value) || value.type !== "query") return value;
  const paradigm = normalizeWorkspaceTabParadigm(value.paradigm);
  return {
    ...value,
    queryState: normalizeQueryState(value.queryState),
    queryLanguage: toWorkspaceQueryLanguage({
      paradigm,
      queryLanguage: value.queryLanguage,
    }),
  };
}

function normalizeWorkspaceTabParadigm(value: unknown): Paradigm {
  return value === "document" || value === "search" || value === "kv"
    ? value
    : "rdb";
}

function normalizeWorkspaceState(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    tabs: Array.isArray(value.tabs)
      ? value.tabs.map(normalizeWorkspaceTab)
      : value.tabs,
    closedTabHistory: Array.isArray(value.closedTabHistory)
      ? value.closedTabHistory.map(normalizeWorkspaceTab)
      : value.closedTabHistory,
  };
}

function normalizeWorkspaceSnapshot(
  value: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [connId, byDb] of Object.entries(value)) {
    if (!isRecord(byDb)) continue;
    out[connId] = {};
    for (const [db, workspace] of Object.entries(byDb)) {
      out[connId][db] = normalizeWorkspaceState(workspace);
    }
  }
  return out;
}

async function hydrateWorkspaces(snap: InitialAppState): Promise<void> {
  const slot = snap.stores.workspaces;
  if ("error" in slot) return;
  // Wire shape: `byConnectionId[connId][db] = unknown`. The store treats each
  // cell as a `WorkspaceState`; normalize query tab result payloads here so
  // legacy snake_case snapshots do not enter the renderer.
  //
  // The cast is bounded to the call boundary; the store's internal type
  // is `Record<string, Record<string, WorkspaceState>>`.
  useWorkspaceStore
    .getState()
    .hydrateWorkspacesFromSnapshot(
      normalizeWorkspaceSnapshot(slot.byConnectionId) as Record<
        string,
        Record<string, WorkspaceState>
      >,
    );
}

async function hydrateMru(snap: InitialAppState): Promise<void> {
  const slot = snap.stores.mru;
  if ("error" in slot) return;
  // Wire shape: `recentConnections: string[]` (ids only). Store shape:
  // `recentConnections: MruEntry[]` (id + lastUsed). Map ids → entries
  // with `lastUsed = generatedAt` so the relative-time labels reflect
  // the snapshot's view, not Date.now() at boot.
  const entries: MruEntry[] = slot.recentConnections.map((connectionId) => ({
    connectionId,
    lastUsed: snap.generatedAt,
  }));
  useMruStore
    .getState()
    .hydrateMruFromSnapshot(entries, slot.lastUsedConnectionId);
}

async function hydrateTheme(snap: InitialAppState): Promise<void> {
  const slot = snap.stores.theme;
  if ("error" in slot) return;
  const mode: ThemeMode =
    slot.mode === "light" || slot.mode === "dark" || slot.mode === "system"
      ? slot.mode
      : "system";
  // wire 의 `themeId` 가 frontend catalog 에 없는 id (legacy "default", 사용자
  // SQLite tamper, schema drift 등) 면 DEFAULT_THEME_ID 로 fallback. unsafe
  // cast 가 themes.css 의 매칭 selector 가 없는 `data-theme` 을 박아 시각적
  // 깨짐을 일으켰던 회귀를 막는다 (Wave 9.5, 2026-05-16).
  const themeId = isThemeId(slot.themeId) ? slot.themeId : DEFAULT_THEME_ID;
  useThemeStore.getState().hydrateThemeFromSnapshot({ themeId, mode });
}

async function hydrateSafeMode(snap: InitialAppState): Promise<void> {
  const slot = snap.stores.safeMode;
  if ("error" in slot) return;
  const mode: SafeMode =
    slot.mode === "strict" || slot.mode === "warn" || slot.mode === "off"
      ? slot.mode
      : "strict"; // unknown → strict (safest default).
  useSafeModeStore.getState().hydrateSafeModeFromSnapshot(mode);
}

async function hydrateRuntimeActiveStatuses(
  snap: InitialAppState,
): Promise<void> {
  useConnectionStore
    .getState()
    .hydrateActiveStatusesFromSnapshot(
      normalizeActiveStatuses(snap.runtime.activeStatuses),
    );
}

// ---------------------------------------------------------------------------
// Buffer drain
// ---------------------------------------------------------------------------

function drainBuffer(appliedSnapshotVersion: number): void {
  const drained = buffer;
  buffer = [];
  const label = getCurrentWindowLabel() ?? "";
  for (const ev of drained) {
    const sv = extractSnapshotVersion(ev.payload);
    if (sv !== null && sv <= appliedSnapshotVersion) {
      // Event is already captured by the snapshot — dispatching it again
      // would double-apply (e.g. duplicate insert). Drop.
      continue;
    }
    dispatchStateChangedPayload(label, ev.payload);
  }
}

function extractSnapshotVersion(payload: unknown): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const v = (payload as { snapshotVersion?: unknown }).snapshotVersion;
  return typeof v === "number" ? v : null;
}

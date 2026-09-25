/**
 * Atomic snapshot hydration + listener pre-register.
 *
 * Boot critical path:
 *
 *   1. `registerSnapshotListener()` — registers `listen("state-changed", …)`.
 *      Buffer mode is ON right after registration: events are queued
 *      instead of being handed to `dispatchStateChangedPayload`.
 *   2. `loadAllFromSnapshot()` — calls the `getInitialAppState()` IPC. Fast
 *      path < 100ms with a fake IPC. When the response arrives, the 5
 *      boot-critical stores + runtime `activeStatuses` are hydrated together
 *      via await Promise.all.
 *   3. After the snapshot applies, drain the buffer. Events with
 *      snapshotVersion <= snap.snapshotVersion are already part of the
 *      truth, so they are dropped (no double dispatch). Newer events are
 *      dispatched once through `dispatchStateChangedPayload`.
 *
 * Failure handling (AC-367-05):
 *
 *   - On IPC reject the stores stay at their defaults — no partial hydrate.
 *   - `toast.error("Failed to load app state …", { action: { label: "Retry", … } })`
 *     surfaces it to the user. Retry click → `loadAllFromSnapshot()` again.
 *   - The listener stays registered and the buffer stays active → the next
 *     retry catches race-window events again.
 *
 * In Scope:
 *   - 5 store hydrate paths + runtime mirror.
 *   - Listener buffer drain.
 *
 * Out of Scope:
 *   - 9 domain receiver bodies.
 *   - LS retirement — theme/safeMode, datagrid prefs.
 *   - `useCurrentWindowConnectionId`.
 */

// CRITICAL: listener registration MUST precede the IPC call line below.
// AC-367-03 (strict order) regression-locked by
// `loadAll.listener-order.test.ts` — the static grep test scans this file for
// `listen("state-changed"` and `getInitialAppState(` and asserts the former
// appears at a lower line number. Do NOT swap the imports or relocate the
// `registerSnapshotListener` body below the IPC call site.

import { dispatchStateChangedPayload } from "@lib/events/stateChanged";
import i18n from "@lib/i18n";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import { getInitialAppState, type InitialAppState } from "@lib/tauri/snapshot";
import type { ThemeMode } from "@lib/themeBoot";
import { DEFAULT_THEME_ID, isThemeId } from "@lib/themeCatalog";
import { getCurrentWindowLabel } from "@lib/window-label";
import {
  normalizeActiveStatuses,
  normalizeConnectionConfig,
  normalizeQueryState,
} from "@lib/wireCamelCase";
import { useConnectionStore } from "@stores/connectionStore";
import { type MruEntry, useMruStore } from "@stores/mruStore";
import { type SafeMode, useSafeModeStore } from "@stores/safeModeStore";
import { useThemeStore } from "@stores/themeStore";
import { useWorkspaceStore, type WorkspaceState } from "@stores/workspaceStore";
import { toWorkspaceQueryLanguage } from "@stores/workspaceStore/queryMode";
import type { Paradigm } from "@/types/connection";

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
 * dispatches straight to `dispatchStateChangedPayload`.
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
  // Buffer is drained — route to `dispatchStateChangedPayload` immediately.
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
    toast.error(i18n.t("feedback:snapshotLoadFailed"), {
      durationMs: null, // sticky — the user must act.
      action: {
        label: i18n.t("feedback:retry"),
        onClick: () => {
          void loadAllFromSnapshot().catch(() => {
            // Re-thrown again — the next failure pushes a fresh toast.
          });
        },
      },
    });
    throw e;
  }

  await applyToStores(snap);

  if (snap.recovered) {
    toast.warning(
      "앱 상태를 초기화했어요. 기존 데이터는 state.db.bak 백업에 있습니다.",
      { durationMs: 8000 },
    );
  }

  // #2183 — separate from `recovered` on purpose: that one says the app state
  // was reset and points at state.db.bak, this one says the stored connections
  // and groups came back from connections.json.bak and nothing was reset. The
  // backend raises it for either half of that store on its own, which is why
  // the text names both. Sticky rather than timed, because the silent handling
  // of this exact event is what let a real machine lose every saved connection
  // unnoticed on 2026-08-06.
  if (snap.connectionsRestoredFromBackup) {
    toast.warning(i18n.t("feedback:connectionsRestoredFromBackup"), {
      durationMs: null,
    });
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
  // #1091 — the backend `read_workspaces` reconstitutes only
  // { activeTabId, tabs, sidebar: { expanded }, closedTabHistory }. dirtyTabIds
  // is a window-local marker that is intentionally never persisted, and
  // selectedNode/scrollTop are dehydrated to defaults. Backfill them here so
  // the hydrated cell is a complete `WorkspaceState` — otherwise consumers like
  // `App.tsx`'s `useConnectionHasDirtyTabs` read `ws.dirtyTabIds.length` on the
  // partial shape, throw, and unmount the whole workspace window on reopen.
  const sidebar = isRecord(value.sidebar) ? value.sidebar : {};
  return {
    ...value,
    tabs: Array.isArray(value.tabs)
      ? value.tabs.map(normalizeWorkspaceTab)
      : [],
    closedTabHistory: Array.isArray(value.closedTabHistory)
      ? value.closedTabHistory.map(normalizeWorkspaceTab)
      : [],
    dirtyTabIds: Array.isArray(value.dirtyTabIds) ? value.dirtyTabIds : [],
    sidebar: {
      selectedNode:
        typeof sidebar.selectedNode === "string" ? sidebar.selectedNode : null,
      expanded: Array.isArray(sidebar.expanded) ? sidebar.expanded : [],
      scrollTop: typeof sidebar.scrollTop === "number" ? sidebar.scrollTop : 0,
    },
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
  // Fall back to DEFAULT_THEME_ID when the wire `themeId` is not in the
  // frontend catalog (legacy "default", a user tampering with SQLite, schema
  // drift, etc.). This blocks the regression where an unsafe cast wrote a
  // `data-theme` with no matching selector in themes.css and visibly broke
  // the styles (2026-05-16).
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

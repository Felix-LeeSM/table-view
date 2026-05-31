/**
 * Session-scoped localStorage utility.
 *
 * Each app process gets a unique session UUID from the Rust side
 * (`get_session_id` command). Data is stored as `{ sessionId, data }` in
 * localStorage. When a new app process starts, the session ID changes, so
 * stale entries from the previous run are automatically ignored by
 * `sessionGet()`.
 *
 * This bridges the gap between launcher and workspace windows: the launcher
 * persists state (e.g. focusedConnId) tagged with the session ID, and the
 * workspace reads it back immediately on boot — no IPC timing dependency.
 *
 * Sprint 375 (Phase 6 cleanup, 2026-05-17) — renamed from
 * `session-storage.ts` to `scopedLocalStorage.ts`. The previous name was a
 * misnomer (M-4 in the state-management strategy doc): data lives in
 * `window.localStorage`, not `window.sessionStorage`. The session scoping
 * is an envelope-level UUID match, not a medium switch. Public function
 * names (`sessionSet` / `sessionGet` / `sessionRemove` / `initSession`)
 * are unchanged so call sites still read with the intended semantics.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";

let _sessionId: string | null = null;

function createBrowserSessionId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `browser-${crypto.randomUUID()}`;
  }
  return `browser-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

/**
 * Fetch the session UUID from Rust and cache it. Must be called once before
 * any `sessionSet` / `sessionGet` calls — typically in `main.tsx` before
 * the React tree mounts.
 */
export async function initSession(): Promise<void> {
  if (!isTauri()) {
    _sessionId = createBrowserSessionId();
    return;
  }
  _sessionId = await invoke<string>("get_session_id");
}

/** The raw session UUID. `null` before `initSession()` completes. */
export function getSessionId(): string | null {
  return _sessionId;
}

/**
 * Store `value` under `key` tagged with the current session ID.
 * No-op if `initSession()` hasn't completed yet.
 */
export function sessionSet(key: string, value: unknown): void {
  if (!_sessionId) return;
  try {
    const entry = JSON.stringify({ sessionId: _sessionId, data: value });
    window.localStorage.setItem(key, entry);
  } catch {
    // localStorage might be unavailable in some environments
  }
}

/**
 * Read the value stored under `key`. Returns `null` if:
 * - `initSession()` hasn't completed
 * - the key doesn't exist
 * - the stored session ID doesn't match (stale from a previous run)
 * - the stored JSON is malformed
 */
export function sessionGet<T = unknown>(key: string): T | null {
  if (!_sessionId) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { sessionId: string; data: T };
    if (entry.sessionId !== _sessionId) return null;
    return entry.data;
  } catch {
    return null;
  }
}

/**
 * Remove a session entry from localStorage.
 */
export function sessionRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function sessionHasCurrentValue(key: string): boolean {
  if (!_sessionId) return false;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return false;
    const entry = JSON.parse(raw) as { sessionId: string };
    return entry.sessionId === _sessionId;
  } catch {
    return false;
  }
}

/**
 * Sprint 375 (Phase 6 cleanup, 2026-05-17) — test-only escape hatch for
 * the module-scope `_sessionId` cache. Each app process resolves the
 * UUID exactly once via `initSession()`; vitest, however, runs multiple
 * "session" cases inside one process and would otherwise see the first
 * test's UUID leak into the second. This helper drops the cache so a
 * subsequent `initSession()` re-invokes the Rust IPC. Mirrors the
 * `__resetCountersForTests` / `__resetFavoriteCounterForTests` pattern.
 * Namespaced `__` to flag intent.
 */
export function __resetSessionIdForTests(): void {
  _sessionId = null;
}

// -- Connection store session keys --
const SESSION_KEY_FOCUSED = "table-view-session:focusedConnId";
const SESSION_KEY_STATUSES = "table-view-session:activeStatuses";

/** Persist `focusedConnId` to session-scoped localStorage. */
export function persistFocusedConnId(id: string | null): void {
  // `null` is an explicit clear mirror; a missing key means "do not hydrate".
  sessionSet(SESSION_KEY_FOCUSED, id);
}

/** Persist `activeStatuses` to session-scoped localStorage. */
export function persistActiveStatuses(statuses: Record<string, unknown>): void {
  // `{}` is an explicit clear mirror; a missing key means "do not hydrate".
  sessionSet(SESSION_KEY_STATUSES, statuses);
}

/**
 * Hydrate the connection store from session-scoped localStorage.
 * Called from `connectionStore.hydrateFromSession()` after `initSession()`
 * completes. Kept here to avoid circular deps between scopedLocalStorage
 * and the store.
 */
export function readConnectionSession(): {
  focusedConnId: string | null;
  activeStatuses: Record<string, unknown> | null;
  hasFocusedConnId: boolean;
  hasActiveStatuses: boolean;
} {
  const hasFocusedConnId = sessionHasCurrentValue(SESSION_KEY_FOCUSED);
  const hasActiveStatuses = sessionHasCurrentValue(SESSION_KEY_STATUSES);
  return {
    focusedConnId: sessionGet<string | null>(SESSION_KEY_FOCUSED),
    activeStatuses: sessionGet<Record<string, unknown>>(SESSION_KEY_STATUSES),
    hasFocusedConnId,
    hasActiveStatuses,
  };
}

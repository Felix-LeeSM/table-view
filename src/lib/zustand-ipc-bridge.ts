/**
 * Zustand-over-Tauri-events bridge — Sprint 151.
 *
 * Generic primitive for synchronising a Zustand store across two (or more)
 * Tauri windows. A state mutation in one window is broadcast on a stable
 * Tauri event channel; remote windows attached to the same channel apply the
 * inbound diff to their local store WITHOUT re-broadcasting (loop guard).
 *
 * ---------------------------------------------------------------------------
 * Sync-safe vs window-local key contract
 * ---------------------------------------------------------------------------
 *
 * **Sync-safe keys** — included in `syncKeys` allowlist. Must be:
 *   - **Plain JSON-serializable values** — `null | boolean | number | string`,
 *     plain objects, and plain arrays of the same. NO `Map`/`Set`/`Date`
 *     instances, NO functions, NO class instances, NO `undefined` (use
 *     `null` instead — `undefined` does not survive `JSON.stringify`).
 *   - **Diff-stable** — the bridge skips an outbound emit when the
 *     allowlisted subset is referentially or structurally unchanged, so
 *     mutating a nested object in place will be missed. Treat synced state
 *     immutably (`set({ tabs: [...tabs, t] })`, not `tabs.push(t)`).
 *   - **Free of secrets** — `password`, API keys, session tokens MUST NOT be
 *     in `syncKeys`. The allowlist is the single defensive boundary; defense
 *     in depth is enforced at the bridge layer (inbound payloads with only
 *     non-allowlisted keys are dropped) but the right place to keep secrets
 *     out of cross-window broadcast is to omit the key from the allowlist.
 *
 * **Window-local keys** — anything NOT in `syncKeys`. Typical examples:
 *   - Ephemeral UI state — modal open flags, drag-in-flight indicators,
 *     focus rings, in-flight request ids.
 *   - Window-scoped state — the current workspace tab, scroll position.
 *   - Sensitive state — passwords, decrypted credentials.
 *   - Anything that should differ between launcher and workspace windows.
 *
 * ---------------------------------------------------------------------------
 * Loop-guard mechanism
 * ---------------------------------------------------------------------------
 *
 * Every outbound emit is wrapped in an envelope tagged with the bridge's
 * `originId`. When an inbound payload arrives, the bridge:
 *   1. drops the payload if `payload.origin === originId` — this is our own
 *      echo (some Tauri runtimes echo emits back to the originating window);
 *   2. otherwise, sets a per-instance `applyingInbound = true` flag,
 *      applies the filtered state to the store, then clears the flag.
 *
 * The store-subscribe callback checks `applyingInbound` and short-circuits
 * the outbound emit when the change came from an inbound apply. This is a
 * deterministic flag, not a "best-effort" counter — re-entrant inbound
 * applies are not expected (Tauri events are dispatched serially) and would
 * still be safe because the flag is restored to its previous value via a
 * try/finally.
 *
 * ---------------------------------------------------------------------------
 * Why allowlist (not denylist)
 * ---------------------------------------------------------------------------
 *
 * Allowlist enforcement at the bridge layer means a future store can't
 * accidentally widen the broadcast surface by adding a sensitive field. With
 * a denylist, every new field defaults to "broadcast" — exactly the wrong
 * default for a desktop DB tool that holds credentials. With an allowlist,
 * every new field defaults to "window-local" and must be explicitly opted in
 * to cross-window sync.
 */

import { emit, listen } from "@tauri-apps/api/event";
import type { StoreApi } from "zustand/vanilla";

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

/** Configuration for {@link attachZustandIpcBridge}. */
export interface ZustandIpcBridgeOptions<T> {
  /**
   * Stable Tauri event channel name — both `emit` and `listen` use this.
   * Each cross-window-synced store should use a unique channel
   * (e.g. `"theme-sync"`, `"connections-sync"`).
   */
  channel: string;
  /**
   * Allowlist of state keys to broadcast. Keys outside this list are NEVER
   * emitted outbound and ALWAYS dropped from inbound payloads (defense in
   * depth). See module-level JSDoc for the sync-safe contract.
   */
  syncKeys: ReadonlyArray<keyof T>;
  /**
   * Stable id used as the loop-guard discriminant. Two bridge instances
   * within the same process must use distinct ids (e.g. window labels).
   * Defaults to a per-instance random id if omitted.
   */
  originId?: string;
}

/**
 * The envelope shipped on the wire. Top-level `origin` is the loop-guard
 * key; `state` is the allowlisted subset (already filtered at the sender).
 */
interface BridgeEnvelope {
  origin: string;
  state: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function defaultOriginId(): string {
  // `crypto.randomUUID()` is the portable choice in modern Vite/Node/jsdom.
  // The test-setup polyfills it for jsdom; production already has it.
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `bridge-${crypto.randomUUID()}`;
  }
  // Fallback: low-entropy is fine — collisions only matter within one process.
  return `bridge-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

/**
 * Pick the allowlisted keys from a state snapshot. Always returns a fresh
 * plain object so referential equality with a previous snapshot is safe to
 * test against (we structurally compare, not referentially — see {@link shallowEqual}).
 */
function pickAllowlisted<T>(
  state: T,
  syncKeys: ReadonlyArray<keyof T>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of syncKeys) {
    out[key as string] = (state as Record<string, unknown>)[key as string];
  }
  return out;
}

/** Shallow structural equality for two plain-object snapshots. */
function shallowEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Validate an inbound payload's structural shape. Returns the typed envelope
 * if valid, or `null` if anything is off (caller must treat `null` as
 * "silently ignore"). Defensive against:
 *   - `null` / non-object payloads
 *   - missing `origin` / `state`
 *   - `state` that is not a plain object
 */
function validateEnvelope(payload: unknown): BridgeEnvelope | null {
  if (payload === null || typeof payload !== "object") return null;
  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.origin !== "string") return null;
  const state = candidate.state;
  if (state === null || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }
  return {
    origin: candidate.origin,
    state: state as Record<string, unknown>,
  };
}

/** Filter an inbound state object to only the allowlisted keys. */
function filterInboundState<T>(
  inbound: Record<string, unknown>,
  syncKeys: ReadonlyArray<keyof T>,
): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of syncKeys) {
    const k = key as string;
    if (Object.prototype.hasOwnProperty.call(inbound, k)) {
      out[k] = inbound[k];
    }
  }
  return out as Partial<T>;
}

/**
 * Attach the bridge to a Zustand vanilla store.
 *
 * Returns a Promise that resolves to a dispose function. The Promise is the
 * shape because `@tauri-apps/api/event::listen` is async — the dispose
 * function is only safe to call after the listener has actually been
 * registered. Callers that don't await will still see correct behavior for
 * outbound emits (the store subscription is synchronous), but inbound events
 * may race; awaiting is the recommended pattern.
 */
export async function attachZustandIpcBridge<T>(
  store: StoreApi<T>,
  options: ZustandIpcBridgeOptions<T>,
): Promise<() => void> {
  const { channel, syncKeys } = options;
  const originId = options.originId ?? defaultOriginId();

  /**
   * Loop-guard flag — set to `true` while the bridge is applying an inbound
   * payload to the store. The store-subscribe callback short-circuits its
   * outbound emit when this is `true`, so the inbound apply doesn't trigger
   * an echo back to the sender.
   */
  let applyingInbound = false;

  // Track the last broadcast subset so a no-op `setState` (same value) does
  // not produce a redundant emit. Initialised from the current state.
  let lastBroadcast = pickAllowlisted(store.getState(), syncKeys);

  // ------------------------------------------------------------- outbound
  const unsubscribeStore = store.subscribe((nextState) => {
    if (applyingInbound) return;
    const subset = pickAllowlisted(nextState, syncKeys);
    if (shallowEqual(subset, lastBroadcast)) return;
    lastBroadcast = subset;
    const envelope: BridgeEnvelope = { origin: originId, state: subset };
    // `emit` returns a Promise; we don't `await` because the store-subscribe
    // signature is synchronous. Errors from the IPC layer are swallowed —
    // logging would pollute test output and there's no recovery path.
    void emit(channel, envelope).catch(() => {
      // best-effort: a failed emit means the other window won't see this
      // diff; the next mutation will retry. No state corruption.
    });
  });

  // ------------------------------------------------------------- inbound
  const unlisten = await listen<unknown>(channel, (event) => {
    const envelope = validateEnvelope(event.payload);
    if (envelope === null) return;
    // Self-loop guard: drop our own echoes.
    if (envelope.origin === originId) return;
    const filtered = filterInboundState<T>(envelope.state, syncKeys);
    if (Object.keys(filtered).length === 0) return;

    const previous = applyingInbound;
    applyingInbound = true;
    try {
      // Refresh the lastBroadcast snapshot with the inbound values too —
      // this prevents the next local change from spuriously emitting if the
      // user just reverts to the inbound value.
      const merged = {
        ...lastBroadcast,
        ...(filtered as Record<string, unknown>),
      };
      lastBroadcast = merged;
      // Zustand's setState accepts a Partial<T> for shallow merge.
      store.setState(filtered as Partial<T>);
    } finally {
      applyingInbound = previous;
    }
  });

  // ------------------------------------------------------------- dispose
  return () => {
    unsubscribeStore();
    // `unlisten` is sync (returned synchronously by Tauri's `listen` once
    // resolved) and idempotent.
    unlisten();
  };
}

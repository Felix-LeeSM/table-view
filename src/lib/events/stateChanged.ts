/**
 * Sprint 365 (Phase 3, F.4) — cross-window `state-changed` event router.
 *
 * Backend `emit_state_changed` (see `src-tauri/src/events.rs`) broadcasts
 * a canonical payload via `AppHandle::emit("state-changed", payload)`.
 * Every window listener receives the same envelope; this module is the
 * single dispatch site.
 *
 * Design notes:
 *
 *  - **Handler registry**, not direct store calls. Stores register their
 *    own callbacks via {@link setStateChangedHandlers} so the dispatcher
 *    stays a thin policy layer (dedup / self-echo / gap detection)
 *    independent of the concrete stores. Tests drive the dispatcher with
 *    `vi.fn()` mocks without standing up Zustand.
 *
 *  - **Three protection mechanisms**, in order of evaluation:
 *      1. **Self-echo skip** — `payload.originWindow === currentWindowLabel`
 *         → mutate skip (the origin window already applied via the IPC
 *         response). The `lastApplied[(domain, entity)]` version IS
 *         updated so later stale broadcasts are still dropped.
 *      2. **Dedup** — `payload.version <= lastApplied` → drop. This
 *         handles same-version re-receives (rare but possible) and
 *         out-of-order stale events.
 *      3. **Gap detection** — `payload.version > lastApplied + 1` AND a
 *         baseline exists → call the domain's `onGapDetected` handler
 *         (which triggers a domain refetch) instead of the per-event
 *         handler. First receive (no baseline) is always treated as a
 *         baseline, never a gap — frontend just got woken up.
 *
 *  - **`lastApplied` map is window-local & not persisted.** Boot starts
 *    fresh; the strategy doc accepts this because the boot snapshot
 *    re-establishes truth on every relaunch.
 *
 *  - **`resetStateChangedRegistryForTests`** is a vitest-only escape
 *    hatch — clears both the handler registry and the `lastApplied`
 *    map between test cases.
 */

/**
 * Strategy doc F.4 (line 1300–1313) wire shape. `camelCase` matches the
 * backend `#[serde(rename_all = "camelCase")]` on `StateChangedPayload`.
 */
export type EventDomain =
  | "connection"
  | "group"
  | "workspace"
  | "mru"
  | "favorite"
  | "history"
  | "setting"
  | "schemaCache"
  | "datagridColumnPrefs";

export type EventOp =
  | "create"
  | "update"
  | "delete"
  | "reorder"
  | "bulk"
  | "status"
  | "invalidate"
  | "reset"
  | "clear";

export type ResetField = "widths" | "hiddenColumns" | "all";

export interface StateChangedPayload {
  domain: EventDomain;
  op: EventOp;
  entityId: string | null;
  version: number;
  snapshotVersion: number;
  originWindow: string | null;
  emittedAt: number;
  field?: ResetField;
}

// ---------------------------------------------------------------------------
// Handler registry — per-domain callback shape
// ---------------------------------------------------------------------------

/**
 * Each domain registers a subset of the ops it cares about. All handlers
 * are optional — a missing handler means "ignore this domain×op
 * combination" (the dispatcher silently drops the payload). This lets
 * stores opt into the events they need without forcing every domain to
 * register every op.
 *
 * `onGapDetected` is also optional per domain — domains that can survive
 * a missed event without a refetch (rare; arguably none) can omit it.
 * Most domains will set it to `() => refetch()` so a gap triggers a
 * full domain reload.
 */
export interface DomainHandlerSet {
  connection: {
    onCrudChanged?: (entityId: string, payload: StateChangedPayload) => void;
    onStatusChanged?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  group: {
    onCrudChanged?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  mru: {
    onBulkChanged?: (payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  favorite: {
    onCrudChanged?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  setting: {
    onUpdated?: (entityId: string, payload: StateChangedPayload) => void;
    onReset?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  workspace: {
    onUpdated?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  history: {
    onCreated?: (entityId: string, payload: StateChangedPayload) => void;
    onClear?: (payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  schemaCache: {
    onInvalidate?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
  datagridColumnPrefs: {
    onUpdated?: (entityId: string, payload: StateChangedPayload) => void;
    onReset?: (entityId: string, payload: StateChangedPayload) => void;
    onGapDetected?: (payload: StateChangedPayload) => void;
  };
}

type PartialHandlerSet = {
  [K in keyof DomainHandlerSet]?: Partial<DomainHandlerSet[K]>;
};

// Internal: the live registry. Stores override entries via
// {@link setStateChangedHandlers}. Tests reset via
// {@link resetStateChangedRegistryForTests}.
let registry: PartialHandlerSet = {};

/**
 * Merge `handlers` into the current registry. Domains not in `handlers`
 * are left untouched; per-domain handlers within a partial set are
 * shallow-merged with the existing entries (so two callers can register
 * disjoint ops on the same domain).
 */
export function setStateChangedHandlers(handlers: PartialHandlerSet): void {
  for (const key of Object.keys(handlers) as Array<keyof DomainHandlerSet>) {
    const incoming = handlers[key];
    if (!incoming) continue;
    // Shallow-merge per-domain. Using `any` here once at the boundary —
    // the type-level guarantee is the function signature.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry[key] = { ...(registry[key] ?? {}), ...incoming } as any;
  }
}

/** Vitest-only reset — drops the registry AND the lastApplied map. */
export function resetStateChangedRegistryForTests(): void {
  registry = {};
  lastApplied.clear();
}

// ---------------------------------------------------------------------------
// lastApplied + dispatcher
// ---------------------------------------------------------------------------

// Keyed by `${domain}:${entityId ?? ""}`. The empty-string sentinel for
// null entity_id mirrors the backend `EventVersionRegistry::bump` policy
// — there's no real entity_id that collides with empty.
const lastApplied = new Map<string, number>();

function applyKey(domain: EventDomain, entityId: string | null): string {
  return `${domain}:${entityId ?? ""}`;
}

/**
 * Minimal runtime shape guard. The dispatcher is invoked from
 * `listen("state-changed", ...)` — the payload is theoretically any
 * `unknown`, so a defensive shape check prevents a malformed broadcast
 * from crashing the listener loop.
 */
function isStateChangedPayload(p: unknown): p is StateChangedPayload {
  if (p === null || typeof p !== "object") return false;
  const r = p as Record<string, unknown>;
  return (
    typeof r.domain === "string" &&
    typeof r.op === "string" &&
    (r.entityId === null || typeof r.entityId === "string") &&
    typeof r.version === "number" &&
    typeof r.snapshotVersion === "number" &&
    (r.originWindow === null || typeof r.originWindow === "string") &&
    typeof r.emittedAt === "number"
  );
}

/**
 * Dispatch a single `state-changed` payload received over the IPC bus.
 *
 * Order of operations:
 *   1. Validate shape — drop silently if malformed.
 *   2. Self-echo check — if `originWindow === currentWindowLabel`, skip
 *      the handler call but still update `lastApplied`.
 *   3. Dedup — drop if `version <= lastApplied`.
 *   4. Gap detection — if `version > lastApplied + 1` AND a baseline
 *      exists, call `onGapDetected` (refetch path) instead of the
 *      per-event handler.
 *   5. Normal path — route to the domain×op handler.
 *
 * `currentWindowLabel` is passed by the caller so the dispatcher itself
 * is pure (no Tauri/dom dependency) — tests inject any string. The
 * production listen() site reads `getCurrentWindowLabel()` once and
 * passes it for every event.
 */
export function dispatchStateChangedPayload(
  currentWindowLabel: string,
  payload: StateChangedPayload | unknown,
): void {
  if (!isStateChangedPayload(payload)) return;

  const key = applyKey(payload.domain, payload.entityId);
  const baseline = lastApplied.get(key);

  // 1. Self-echo skip — origin window already mutated via IPC response.
  //    Update lastApplied so later stale broadcasts are dropped.
  if (
    payload.originWindow !== null &&
    payload.originWindow === currentWindowLabel
  ) {
    // Still respect monotonicity — don't roll the bookkeeping backwards.
    if (baseline === undefined || payload.version > baseline) {
      lastApplied.set(key, payload.version);
    }
    return;
  }

  // 2. Dedup — same or stale version.
  if (baseline !== undefined && payload.version <= baseline) {
    return;
  }

  // 3. Gap detection — only when a baseline exists AND we missed at least
  //    one version. First-ever receive (no baseline) is treated as the
  //    baseline, not a gap.
  if (baseline !== undefined && payload.version > baseline + 1) {
    lastApplied.set(key, payload.version);
    routeGapHandler(payload);
    return;
  }

  // 4. Normal path.
  lastApplied.set(key, payload.version);
  routeNormalHandler(payload);
}

function routeNormalHandler(payload: StateChangedPayload): void {
  switch (payload.domain) {
    case "connection": {
      const h = registry.connection;
      if (!h) return;
      if (payload.op === "status") {
        // status payloads always carry an entityId per F.4.
        if (payload.entityId !== null) {
          h.onStatusChanged?.(payload.entityId, payload);
        }
        return;
      }
      if (
        payload.op === "create" ||
        payload.op === "update" ||
        payload.op === "delete" ||
        payload.op === "reorder"
      ) {
        if (payload.entityId !== null) {
          h.onCrudChanged?.(payload.entityId, payload);
        }
      }
      return;
    }
    case "group": {
      const h = registry.group;
      if (!h) return;
      if (
        payload.op === "create" ||
        payload.op === "update" ||
        payload.op === "delete" ||
        payload.op === "reorder"
      ) {
        if (payload.entityId !== null) {
          h.onCrudChanged?.(payload.entityId, payload);
        }
      }
      return;
    }
    case "mru": {
      const h = registry.mru;
      if (!h) return;
      if (payload.op === "bulk") {
        h.onBulkChanged?.(payload);
      }
      return;
    }
    case "favorite": {
      const h = registry.favorite;
      if (!h) return;
      if (
        payload.op === "create" ||
        payload.op === "update" ||
        payload.op === "delete" ||
        payload.op === "reorder"
      ) {
        if (payload.entityId !== null) {
          h.onCrudChanged?.(payload.entityId, payload);
        }
      }
      return;
    }
    case "setting": {
      const h = registry.setting;
      if (!h) return;
      if (payload.entityId === null) return;
      if (payload.op === "update") {
        h.onUpdated?.(payload.entityId, payload);
      } else if (payload.op === "reset") {
        h.onReset?.(payload.entityId, payload);
      }
      return;
    }
    case "workspace": {
      const h = registry.workspace;
      if (!h) return;
      if (payload.op === "update" && payload.entityId !== null) {
        h.onUpdated?.(payload.entityId, payload);
      }
      return;
    }
    case "history": {
      const h = registry.history;
      if (!h) return;
      if (payload.op === "create") {
        if (payload.entityId !== null) {
          h.onCreated?.(payload.entityId, payload);
        }
      } else if (payload.op === "clear") {
        h.onClear?.(payload);
      }
      return;
    }
    case "schemaCache": {
      const h = registry.schemaCache;
      if (!h) return;
      if (payload.op === "invalidate" && payload.entityId !== null) {
        h.onInvalidate?.(payload.entityId, payload);
      }
      return;
    }
    case "datagridColumnPrefs": {
      const h = registry.datagridColumnPrefs;
      if (!h) return;
      if (payload.entityId === null) return;
      if (payload.op === "update") {
        h.onUpdated?.(payload.entityId, payload);
      } else if (payload.op === "reset") {
        h.onReset?.(payload.entityId, payload);
      }
      return;
    }
  }
}

function routeGapHandler(payload: StateChangedPayload): void {
  // Gap-recovery is universal: every domain that registered a callback
  // gets its `onGapDetected` invoked with the full payload. The handler
  // is responsible for the refetch path (e.g. `get_all_connections()`).
  switch (payload.domain) {
    case "connection":
      registry.connection?.onGapDetected?.(payload);
      return;
    case "group":
      registry.group?.onGapDetected?.(payload);
      return;
    case "mru":
      registry.mru?.onGapDetected?.(payload);
      return;
    case "favorite":
      registry.favorite?.onGapDetected?.(payload);
      return;
    case "setting":
      registry.setting?.onGapDetected?.(payload);
      return;
    case "workspace":
      registry.workspace?.onGapDetected?.(payload);
      return;
    case "history":
      registry.history?.onGapDetected?.(payload);
      return;
    case "schemaCache":
      registry.schemaCache?.onGapDetected?.(payload);
      return;
    case "datagridColumnPrefs":
      registry.datagridColumnPrefs?.onGapDetected?.(payload);
      return;
  }
}

// ---------------------------------------------------------------------------
// Tauri listen() registration
// ---------------------------------------------------------------------------

/**
 * Tauri event name — keep in lockstep with backend `STATE_CHANGED_EVENT`
 * in `src-tauri/src/events.rs`.
 */
export const STATE_CHANGED_EVENT = "state-changed";

/**
 * Register the singleton `state-changed` listener for this window. Reads
 * the current window label once and passes it into every dispatch so the
 * self-echo skip works correctly.
 *
 * Returns the Tauri unlisten function. Production callers don't dispose
 * (listener lives for the renderer's lifetime); tests can dispose to
 * drop the listen() registration between cases.
 *
 * Best-effort: if Tauri is unavailable (vitest jsdom default), returns
 * a no-op unlisten so callers don't have to special-case the environment.
 */
export async function registerStateChangedListener(): Promise<() => void> {
  // Lazy-import the Tauri runtime + window-label helpers — vitest jsdom
  // mocks `@lib/window-label` to return `null`, and `@tauri-apps/api/event`
  // throws synchronously if loaded outside a Tauri runtime in some
  // configurations. The lazy path keeps the module import-safe.
  try {
    const { listen } = await import("@tauri-apps/api/event");
    const { getCurrentWindowLabel } = await import("@lib/window-label");
    const label = getCurrentWindowLabel() ?? "";
    const unlisten = await listen<unknown>(STATE_CHANGED_EVENT, (event) => {
      dispatchStateChangedPayload(label, event.payload);
    });
    return unlisten;
  } catch {
    // Tauri runtime unavailable — return a no-op unlisten so callers
    // can keep their lifecycle code straight.
    return () => {};
  }
}

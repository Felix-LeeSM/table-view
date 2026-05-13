import { useCallback, useEffect, useRef, useState } from "react";

import * as tauri from "@lib/tauri";
import { POSTGRES_COMMON_TYPES } from "@/lib/sql/postgresTypes";
import { resolveActiveDb } from "@stores/workspaceStore";
import type { PostgresTypeInfo } from "@/types/schema";

/**
 * Sprint 230 — `usePostgresTypes(connectionId)` lazy-fetches the PG
 * type list from `tauri.listPostgresTypes` and merges it with the
 * canonical `POSTGRES_COMMON_TYPES` list so the combobox is
 * responsive on mount (the canonical list shows immediately) and
 * extension types (`geometry`, `citext`) + user-defined enums show
 * up once the fetch resolves.
 *
 * Cache layer = module-level `Map<connectionId, CacheEntry>` memo,
 * NOT zustand. Justification (locked by contract Decisions §1):
 * - Data is small per connection (~200-500 strings) and pure-derived
 *   from PG state — no cross-window broadcast required.
 * - A zustand slice would require adding a `typesByConnection` field
 *   to `schemaStore` AND wiring `clearForConnection` cache punch
 *   AND IPC bridge subscriptions for sync. `schemaStore.ts` body is
 *   a Sprint 224 frozen invariant — out of scope for Sprint 230.
 * - Module memo + `invalidatePostgresTypesCache(connectionId)` free
 *   function gives Sprint 231 the single hook point it needs to
 *   wire disconnect / reconnect cleanup later.
 *
 * Concurrent calls on the same connection share one in-flight
 * Promise (stored in the cache entry). A connectionId change between
 * mount and resolution is detected via `latestConnectionIdRef.current`
 * compare and the stale response is dropped without state mutation.
 */

export interface UsePostgresTypesResult {
  /** Merged type list — canonical first, then non-duplicate live extras. */
  types: string[];
  /**
   * Sprint 234 — display label → `type_kind` lookup map. Keys are the
   * same display labels surfaced in `types` (`pg_catalog.X` stripped to
   * `X`; other schemas qualified as `<schema>.X`). Values are the raw
   * `PostgresTypeInfo.type_kind` string from the live fetch (`"base"`
   * / `"enum"` / `"domain"` / `"range"` / `"composite"`); canonical
   * entries that have no live counterpart get `"base"`. The map is
   * always non-null — empty during the very first render before the
   * fetch resolves so consumers can call `.get(label)` without
   * null-checking the map itself.
   */
  typesByName: Map<string, string>;
  /** True while a fetch is in flight (first mount or `reload()`). */
  loading: boolean;
  /** Non-null if the last fetch rejected; canonical fallback active. */
  error: string | null;
  /** Imperative refetch — invalidates the per-connection cache then refetches. */
  reload: () => void;
}

interface CacheEntry {
  /** Resolved merged list (canonical + non-duplicate live extras). */
  types: string[] | null;
  /**
   * Sprint 234 — resolved display-label → `type_kind` map. Built by
   * `mergeTypesByName`; canonical entries default to `"base"`, live
   * entries reflect their `PostgresTypeInfo.type_kind`. `null` until
   * the first fetch resolves (matches `types` semantics).
   */
  typesByName: Map<string, string> | null;
  /** Raw `PostgresTypeInfo[]` retained for future Sprint 231 type-coloring. */
  raw: PostgresTypeInfo[] | null;
  /** Sticky error string — surfaced to the consumer until next reload. */
  error: string | null;
  /** Shared in-flight Promise so concurrent mounts don't double-fetch. */
  inFlight: Promise<void> | null;
  /** Wall-clock ms when the last successful fetch resolved. */
  fetchedAt: number;
}

// Module-level memo. Each entry is keyed by `connectionId`. Test
// isolation goes through `invalidatePostgresTypesCache(connectionId)`
// which deletes the entry; on next mount the hook re-fetches.
const cache: Map<string, CacheEntry> = new Map();

/**
 * Sprint 230 — free helper exported alongside the hook so future
 * Sprint 231 wiring (connection disconnect / reconnect / DB switch)
 * can punch the cache without depending on the hook lifecycle.
 *
 * Calling this for an unknown `connectionId` is a safe no-op.
 */
export function invalidatePostgresTypesCache(connectionId: string): void {
  cache.delete(connectionId);
}

/**
 * Map a single live `PostgresTypeInfo` to its display label.
 *
 * Rule (AC-230-06):
 * - `pg_catalog.X` → `X` (built-ins read naturally — `varchar`,
 *   not `pg_catalog.varchar`).
 * - `<schema>.X`   → `<schema>.X` for any other schema (`public.my_enum`,
 *   `extensions.geometry` etc.) — users see where the type lives.
 *
 * Returns `null` for defensive-drop entries (empty name, `pg_toast`
 * leak — backend should never emit these but the hook double-checks).
 */
function toLabel(info: PostgresTypeInfo): string | null {
  const schema = info.schema?.trim() ?? "";
  const name = info.name?.trim() ?? "";
  if (name.length === 0) return null;
  if (schema === "pg_toast") return null;
  if (schema === "pg_catalog") return name;
  if (schema.length === 0) return name;
  return `${schema}.${name}`;
}

/**
 * Merge canonical `POSTGRES_COMMON_TYPES` with the live list.
 *
 * Order (AC-230-05 b): canonical first (preserves user familiarity +
 * keeps `expandParametricDefault` working since `varchar` / `char` /
 * `numeric` are guaranteed-present in the merged head), then
 * non-duplicate live extras at the tail. Dedup is case-sensitive via
 * a `Set` lookup (PG identifiers are case-sensitive when quoted).
 */
function mergeTypes(live: PostgresTypeInfo[]): string[] {
  const canonical = [...POSTGRES_COMMON_TYPES];
  const seen = new Set<string>(canonical);
  const extras: string[] = [];
  for (const info of live) {
    const label = toLabel(info);
    if (label === null) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    extras.push(label);
  }
  return [...canonical, ...extras];
}

/**
 * Sprint 234 — companion to `mergeTypes`. Builds the display-label →
 * `type_kind` lookup map.
 *
 * Rules:
 * - Canonical entries (`POSTGRES_COMMON_TYPES`) seed the map with
 *   `"base"`. They always win when a live entry shares the same label
 *   (preserves familiar built-in coloring even if PG's `typtype`
 *   somehow disagrees with the canonical assumption).
 * - Live entries that produce a non-canonical label (`public.my_enum`,
 *   `extensions.geometry`, …) record their raw `type_kind` from the
 *   `PostgresTypeInfo`. Defensive-drop entries (empty name, `pg_toast`)
 *   are filtered by `toLabel` returning `null`.
 *
 * Lookup is case-sensitive — same as `mergeTypes`'s dedup `Set`.
 */
function mergeTypesByName(live: PostgresTypeInfo[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of POSTGRES_COMMON_TYPES) out.set(t, "base");
  for (const info of live) {
    const label = toLabel(info);
    if (label === null) continue;
    if (out.has(label)) continue; // canonical wins (already "base")
    out.set(label, info.type_kind);
  }
  return out;
}

/**
 * Sprint 234 — fallback map used in the error path so consumers always
 * observe a non-null `typesByName`. Mirrors the canonical-fallback
 * shape from `mergeTypes`.
 */
function canonicalKindMap(): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of POSTGRES_COMMON_TYPES) out.set(t, "base");
  return out;
}

/**
 * Trigger a fresh fetch for `connectionId`. Stores the in-flight
 * Promise in the cache entry so concurrent calls share it. Resolves
 * once the cache entry is in its final state (success or error).
 */
function fetchTypes(connectionId: string): Promise<void> {
  const existing = cache.get(connectionId);
  if (existing?.inFlight) {
    return existing.inFlight;
  }

  const entry: CacheEntry = existing ?? {
    types: null,
    typesByName: null,
    raw: null,
    error: null,
    inFlight: null,
    fetchedAt: 0,
  };

  const promise = (async () => {
    try {
      // Sprint 271a — forward (connId, db) so a swapped backend pool rejects
      // with DbMismatch instead of returning a stale db's type list.
      const expectedDb = resolveActiveDb(connectionId) || undefined;
      const live = await tauri.listPostgresTypes(connectionId, expectedDb);
      entry.raw = live;
      entry.types = mergeTypes(live);
      entry.typesByName = mergeTypesByName(live);
      entry.error = null;
      entry.fetchedAt = Date.now();
    } catch (err) {
      // Load-bearing recovery — the consumer surfaces the error
      // string for telemetry but the combobox stays usable via the
      // canonical fallback. NOT a silent catch (AC-230-12).
      const message = err instanceof Error ? err.message : String(err);
      entry.raw = null;
      entry.types = [...POSTGRES_COMMON_TYPES];
      entry.typesByName = canonicalKindMap();
      entry.error = message;
      entry.fetchedAt = Date.now();
    } finally {
      entry.inFlight = null;
    }
  })();

  entry.inFlight = promise;
  cache.set(connectionId, entry);
  return promise;
}

export function usePostgresTypes(connectionId: string): UsePostgresTypesResult {
  // `version` is bumped to force a re-render whenever the cache
  // entry's resolved state changes. The Map itself isn't reactive,
  // so we treat the bump as the React-visible signal.
  const [, setVersion] = useState(0);
  const latestConnectionIdRef = useRef(connectionId);

  // Keep the ref synced for stale-resolution comparisons. Done in
  // every render (cheap — single ref write) so the next fetch's
  // resolution path sees the right id.
  latestConnectionIdRef.current = connectionId;

  useEffect(() => {
    let cancelled = false;
    const cached = cache.get(connectionId);

    // Cache hit (resolved value present, no in-flight fetch) — no
    // need to re-fetch. The hook returns the cached value directly
    // via the read at the bottom of this function.
    if (cached && cached.types !== null && cached.inFlight === null) {
      return;
    }

    void fetchTypes(connectionId).then(() => {
      // Stale-connectionId guard (AC-230-05 + edge case): if the
      // hook re-rendered with a different id while the fetch was
      // in flight, drop the resolution silently — the new id has
      // its own fetch (or cache hit) in motion.
      if (cancelled) return;
      if (latestConnectionIdRef.current !== connectionId) return;
      setVersion((v) => v + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [connectionId]);

  const reload = useCallback(() => {
    invalidatePostgresTypesCache(connectionId);
    void fetchTypes(connectionId).then(() => {
      if (latestConnectionIdRef.current !== connectionId) return;
      setVersion((v) => v + 1);
    });
    // Bump immediately so consumers observe `loading=true` while the
    // refetch runs (otherwise the stale resolved state would still
    // satisfy `cached.types !== null`).
    setVersion((v) => v + 1);
  }, [connectionId]);

  // Read the latest cache state synchronously. If no entry yet (very
  // first render before the effect runs), surface the canonical list
  // + loading=true so the combobox is instantly usable.
  //
  // Sprint 234 — `typesByName` follows the same invariant as `types`:
  // never null. Empty `Map` while the very first fetch is in flight so
  // consumers can call `.get(label)` without null-checking. Once a
  // fetch resolves it switches to the populated cache map (canonical
  // entries seeded with `"base"` + live entries with their `type_kind`).
  const cached = cache.get(connectionId);
  if (!cached) {
    return {
      types: [...POSTGRES_COMMON_TYPES],
      typesByName: new Map(),
      loading: true,
      error: null,
      reload,
    };
  }
  if (cached.inFlight !== null) {
    return {
      // Loading-canonical-first surface (AC-230-10): never expose a
      // partially-merged list while the fetch is in flight. If a
      // previous fetch resolved successfully, prefer that merged
      // list (refetch silently replaces); otherwise canonical.
      types: cached.types ?? [...POSTGRES_COMMON_TYPES],
      typesByName: cached.typesByName ?? new Map(),
      loading: true,
      error: cached.error,
      reload,
    };
  }
  return {
    types: cached.types ?? [...POSTGRES_COMMON_TYPES],
    typesByName: cached.typesByName ?? new Map(),
    loading: false,
    error: cached.error,
    reload,
  };
}

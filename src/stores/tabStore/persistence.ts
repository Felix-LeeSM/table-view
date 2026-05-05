/**
 * Sprint 208 — `tabStore` persistence helpers + cross-store db lookup.
 *
 * Extracted from the 1009-line `tabStore.ts` god file. Owns:
 *   - `STORAGE_KEY` + raw `persistTabs` write + 200ms debounced wrapper.
 *   - `migrateLoadedTabs` — Sprint 73/76/129 schema migrations applied at
 *     load time so downstream consumers always see normalized tabs.
 *   - `resolveActiveDb` — `connectionStore` lookup for the active sub-pool
 *     database (used by `addTab` / `addQueryTab` autofill paths).
 *
 * `useConnectionStore` cross-store import is preserved with the existing
 * `eslint-disable no-restricted-imports` exemption — Sprint 196 lint rule
 * scope. Removing the cross-store dependency is a separate sprint
 * candidate (see the in-tabStore TODO at the entry module).
 */
import type { Paradigm } from "@/types/connection";
/* eslint-disable no-restricted-imports */
import { useConnectionStore } from "@stores/connectionStore";
/* eslint-enable no-restricted-imports */
import type { Tab, QueryMode } from "./types";

export const STORAGE_KEY = "table-view-tabs";

let persistTimer: ReturnType<typeof setTimeout> | null = null;

export function persistTabs(tabs: Tab[], activeTabId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    const data = JSON.stringify({ tabs, activeTabId });
    window.localStorage.setItem(STORAGE_KEY, data);
  } catch {
    // localStorage may be unavailable (SSR, quota exceeded, etc.)
  }
}

export function debouncePersist(tabs: Tab[], activeTabId: string | null): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTabs(tabs, activeTabId);
    persistTimer = null;
  }, 200);
}

/**
 * Sprint 130 — resolve the active database for `connectionId`.
 *
 * Reads `connectionStore.activeStatuses[id].activeDb` first (set by
 * `setActiveDb` after a successful `switchActiveDb` dispatch), falling back
 * to the connection's stored default `database` when there is no live
 * `activeDb` yet (e.g. tab opened before the user switched DBs at all).
 *
 * Returns `undefined` when the connection isn't in the store — opening a
 * tab against an unknown id is a programmer error, but we don't want to
 * crash the tab creation path.
 */
export function resolveActiveDb(connectionId: string): string | undefined {
  const conn = useConnectionStore.getState();
  const status = conn.activeStatuses[connectionId];
  if (status?.type === "connected" && status.activeDb) {
    return status.activeDb;
  }
  return conn.connections.find((c) => c.id === connectionId)?.database;
}

/**
 * Sprint 73 / 76 / 129 schema migrations applied at load time so downstream
 * consumers always see normalized tabs:
 *
 *   - Sprint 73: legacy `QueryTab`s lacked `paradigm`/`queryMode` fields.
 *     Default to `"rdb"` + `"sql"` (matches user expectations — every
 *     legacy tab targeted SQL on RDB).
 *   - Sprint 76: legacy `TableTab`s lacked `sorts`. Default to `[]` so
 *     `DataGrid` / `DataGridTable` / `fetchData` consumers can drop the
 *     `undefined` guard.
 *   - Sprint 129: document tabs persisted before this sprint stored the
 *     MongoDB database/collection in `schema`/`table` (RDB aliasing).
 *     Backfill the new dedicated `database`/`collection` fields when
 *     missing. Idempotent — keeps existing values.
 *
 * Also resets every `QueryTab.queryState` to `idle` since running queries
 * cannot be resumed across reloads.
 */
export function migrateLoadedTabs(rawTabs: Tab[]): Tab[] {
  return rawTabs.map((t) => {
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
      const database = isDocument ? (t.database ?? t.schema) : t.database;
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
  });
}

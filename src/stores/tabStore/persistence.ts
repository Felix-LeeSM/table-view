/**
 * `tabStore` persistence helpers + cross-store db lookup.
 *   - `STORAGE_KEY` + raw `persistTabs` write + 200ms debounced wrapper.
 *   - `migrateLoadedTabs` — schema migrations applied at load time so
 *     downstream consumers always see normalized tabs.
 *   - `resolveActiveDb` — `connectionStore` lookup for the active
 *     sub-pool database (used by `addTab` / `addQueryTab` autofill).
 *
 * The `useConnectionStore` cross-store import keeps its
 * `no-restricted-imports` exemption — removing the dependency is out of
 * scope here.
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
 * Resolve the active database for `connectionId`. Prefers the live
 * `activeDb` set by `switchActiveDb`; falls back to the connection's
 * stored default `database`. Returns `undefined` when the connection is
 * unknown rather than throwing — keeps the tab creation path crash-free.
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
 * Schema migrations applied at load time so downstream consumers always
 * see normalized tabs:
 *   - Legacy `QueryTab` defaults `paradigm` to `"rdb"` and `queryMode`
 *     to `"sql"` — every legacy tab targeted SQL on RDB.
 *   - Legacy `TableTab` defaults `sorts` to `[]` so consumers can drop
 *     the `undefined` guard.
 *   - Legacy document tabs stored Mongo db/collection in `schema`/
 *     `table`; backfill the dedicated `database`/`collection` fields
 *     when missing (idempotent — keeps existing values).
 *
 * Also resets every `QueryTab.queryState` to `idle` since in-flight
 * queries can't be resumed across reloads.
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

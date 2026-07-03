import { create } from "zustand";
import { logger } from "@lib/logger";
import { toast } from "@lib/runtime/toast";
import i18n from "@lib/i18n";
import { getCurrentWindowLabel, parseWorkspaceLabel } from "@lib/window-label";
import {
  listTableActivity,
  persistTableActivity,
  type PersistTableActivityPayload,
} from "@lib/tauri/tableActivity";

/**
 * Table-level pin + recent-usage store (#1218). Unlike `favoritesStore`
 * (SQL-query scoped) and `mruStore` (connection scoped), this tracks
 * individual tables so a heavily-populated schema tree offers a quick
 * "Pinned" / "Recent" re-entry section.
 *
 * One flat list holds every connection's entries. A single row can be both
 * pinned (`pinnedAt != null`) and recent (`lastUsed != null`); the sidebar
 * derives the two sections with the exported selectors.
 *
 * `schema` is `string | null` — the key structure keeps the schema segment
 * optional so schemaless RDBMS (no-schema MySQL, flat SQLite) behave the same
 * as with-schema PG (user requirement, 2026-07-03). In practice today every
 * relational shape passes a non-null schema name (PG schema / MySQL db name /
 * SQLite "main"); `null` is reserved for a future genuinely-schemaless
 * paradigm and is exercised by the round-trip tests.
 *
 * Persistence mirrors `favoritesStore`: synchronous in-memory mutate + a
 * fire-and-forget `persist_table_activity` IPC, boot hydrate via
 * `list_table_activity`. #1092 — a failed write has no fallback source, so a
 * reject surfaces a dev log AND an error toast.
 *
 * Cross-window safety (#1232 review): persist ships ONLY the entries owned by
 * the current workspace window's connection, and the backend replace is scoped
 * to that `connection_id`. So even though the in-memory list is global (boot
 * hydrate loads every connection), two windows on different connections write
 * to disjoint partitions and never clobber each other — no sync bridge needed
 * because the persist units don't overlap.
 */

/**
 * The connection this window owns, parsed from its workspace label
 * (`workspace-{connection_id}`). `null` in the launcher or under vitest
 * without a window mock — a window that owns nothing persists nothing.
 */
function owningConnectionId(): string | null {
  const label = getCurrentWindowLabel();
  return label ? parseWorkspaceLabel(label) : null;
}

export interface TableRef {
  connectionId: string;
  db: string;
  schema: string | null;
  table: string;
}

export interface TableActivityEntry extends TableRef {
  /** epoch ms of the last table-tab open; null = pinned-only, never opened. */
  lastUsed: number | null;
  /** epoch ms the table was pinned; null = not pinned. */
  pinnedAt: number | null;
}

/** Max recent (non-pinned) entries retained per `(connectionId, db)`. */
export const RECENT_CAP = 10;

/**
 * Stable identity for a table across the (connectionId, db, schema?, table)
 * tuple. A single-space separator can't collide because identifiers with
 * spaces would themselves be quoted before reaching here, and an empty schema
 * segment (schemaless paradigm) stays unambiguous as a doubled separator.
 */
export function tableActivityKey(ref: TableRef): string {
  return [ref.connectionId, ref.db, ref.schema ?? "", ref.table].join(" ");
}

function toPersistPayload(
  entries: TableActivityEntry[],
): PersistTableActivityPayload[] {
  return entries.map((e) => ({
    connectionId: e.connectionId,
    db: e.db,
    schema: e.schema,
    table: e.table,
    lastUsed: e.lastUsed,
    pinnedAt: e.pinnedAt,
  }));
}

function persist(entries: TableActivityEntry[]): void {
  const connId = owningConnectionId();
  if (!connId) return; // window owns no connection → nothing to persist
  const owned = entries.filter((e) => e.connectionId === connId);
  void persistTableActivity(connId, toPersistPayload(owned)).catch(
    (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(
        `[tableActivityStore] persist_table_activity failed: ${message}`,
      );
      toast.error(i18n.t("feedback:storageWriteFailed"));
    },
  );
}

/**
 * Drop non-pinned recent entries beyond `RECENT_CAP` for each
 * `(connectionId, db)` group. Pinned rows always survive so a pin can't be
 * evicted by newer opens; orphans (neither pinned nor recent) are removed.
 */
function pruneRecent(entries: TableActivityEntry[]): TableActivityEntry[] {
  const perGroupKept = new Map<string, number>();
  const ordered = [...entries].sort(
    (a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0),
  );
  const survivorKeys = new Set<string>();
  for (const e of ordered) {
    if (e.pinnedAt != null) {
      survivorKeys.add(tableActivityKey(e));
      continue;
    }
    if (e.lastUsed == null) continue; // orphan
    const group = `${e.connectionId} ${e.db}`;
    const kept = perGroupKept.get(group) ?? 0;
    if (kept >= RECENT_CAP) continue;
    perGroupKept.set(group, kept + 1);
    survivorKeys.add(tableActivityKey(e));
  }
  return entries.filter((e) => survivorKeys.has(tableActivityKey(e)));
}

interface TableActivityState {
  entries: TableActivityEntry[];
  recordTableUsed: (ref: TableRef) => void;
  togglePin: (ref: TableRef) => void;
  isPinned: (ref: TableRef) => boolean;
  /**
   * Reset affordance for the Recent list (product §1 — persistent state needs
   * a reset path). Drops the recent-only rows for one `(connectionId, db)`;
   * pins survive (they have their own per-item unpin).
   */
  clearRecentTables: (connectionId: string, db: string) => void;
  loadPersistedTableActivity: () => Promise<void>;
}

export const useTableActivityStore = create<TableActivityState>((set, get) => ({
  entries: [],

  recordTableUsed: (ref) => {
    const now = Date.now();
    const key = tableActivityKey(ref);
    set((state) => {
      const existing = state.entries.find((e) => tableActivityKey(e) === key);
      const updated: TableActivityEntry = existing
        ? { ...existing, lastUsed: now }
        : { ...ref, lastUsed: now, pinnedAt: null };
      const next = pruneRecent([
        updated,
        ...state.entries.filter((e) => tableActivityKey(e) !== key),
      ]);
      persist(next);
      return { entries: next };
    });
  },

  togglePin: (ref) => {
    const key = tableActivityKey(ref);
    set((state) => {
      const existing = state.entries.find((e) => tableActivityKey(e) === key);
      let next: TableActivityEntry[];
      if (existing?.pinnedAt != null) {
        // Unpin. Keep the row only if it still carries recent usage.
        next =
          existing.lastUsed != null
            ? state.entries.map((e) =>
                tableActivityKey(e) === key ? { ...e, pinnedAt: null } : e,
              )
            : state.entries.filter((e) => tableActivityKey(e) !== key);
      } else if (existing) {
        next = state.entries.map((e) =>
          tableActivityKey(e) === key ? { ...e, pinnedAt: Date.now() } : e,
        );
      } else {
        next = [
          { ...ref, lastUsed: null, pinnedAt: Date.now() },
          ...state.entries,
        ];
      }
      persist(next);
      return { entries: next };
    });
  },

  isPinned: (ref) => {
    const key = tableActivityKey(ref);
    return (
      get().entries.find((e) => tableActivityKey(e) === key)?.pinnedAt != null
    );
  },

  clearRecentTables: (connectionId, db) => {
    set((state) => {
      const next = state.entries.filter(
        (e) =>
          e.connectionId !== connectionId || e.db !== db || e.pinnedAt != null, // keep pins; drop recent-only rows for this scope
      );
      if (next.length === state.entries.length) return state;
      persist(next);
      return { entries: next };
    });
  },

  loadPersistedTableActivity: async () => {
    try {
      const rows = await listTableActivity();
      // #1091 — hydrate must normalize every nullable field so a persisted
      // row never crashes a downstream render. The backend's empty schema
      // sentinel ('') maps back to null; absent timestamps stay null.
      const entries: TableActivityEntry[] = rows.map((r) => ({
        connectionId: r.connectionId,
        db: r.db,
        schema: r.schema == null || r.schema === "" ? null : r.schema,
        table: r.table,
        lastUsed: typeof r.lastUsed === "number" ? r.lastUsed : null,
        pinnedAt: typeof r.pinnedAt === "number" ? r.pinnedAt : null,
      }));
      set({ entries });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e ?? "");
      logger.warn(
        `[tableActivityStore] list_table_activity failed: ${message}`,
      );
    }
  },
}));

// ---------------------------------------------------------------------------
// Pure selectors — Quick Open (#1216) consumes these as ranking signals.
// ---------------------------------------------------------------------------

/**
 * Recent tables for a `(connectionId, db)`, most-recent first, capped.
 * Pinned rows are excluded — they surface in the Pinned section, so counting
 * them here would silently shrink the visible Recent list below `limit`
 * (#1232 review). Quick Open reads `selectTableActivitySignals` for the full
 * picture (pins included).
 */
export function selectRecentTables(
  entries: TableActivityEntry[],
  connectionId: string,
  db: string,
  limit = RECENT_CAP,
): TableActivityEntry[] {
  return entries
    .filter(
      (e) =>
        e.connectionId === connectionId &&
        e.db === db &&
        e.lastUsed != null &&
        e.pinnedAt == null,
    )
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0))
    .slice(0, limit);
}

/** Pinned tables for a `(connectionId, db)`, oldest pin first (stable order). */
export function selectPinnedTables(
  entries: TableActivityEntry[],
  connectionId: string,
  db: string,
): TableActivityEntry[] {
  return entries
    .filter(
      (e) =>
        e.connectionId === connectionId && e.db === db && e.pinnedAt != null,
    )
    .sort((a, b) => (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0));
}

/** Flat ranking signal for Quick Open (#1216) — all connections. */
export function selectTableActivitySignals(
  entries: TableActivityEntry[],
): Array<TableRef & { lastUsed: number | null; pinned: boolean }> {
  return entries.map((e) => ({
    connectionId: e.connectionId,
    db: e.db,
    schema: e.schema,
    table: e.table,
    lastUsed: e.lastUsed,
    pinned: e.pinnedAt != null,
  }));
}

export type { PersistTableActivityPayload };

export function __resetTableActivityStoreForTests(): void {
  useTableActivityStore.setState({ entries: [] });
}

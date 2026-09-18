/**
 * `get_initial_app_state` IPC frontend wrapper.
 *
 * Atomic single-shot boot read that hydrates the 5 boot-critical stores
 * plus runtime `activeStatuses`. Wire shape is byte-equivalent to
 * Strategy F.2 (line 911–998). Callable from either the launcher or a
 * workspace window — the backend derives the window scope from
 * `window.label()` automatically.
 *
 * Out of scope:
 *   - Applying the snapshot on the frontend (store mirrors, listener
 *     registration order).
 *   - Schema version mismatch handling (safe mode entry).
 *
 * Lazy stores (favorites / queryHistory / schemaCache / datagrid_prefs)
 * are not part of this snapshot. They are fetched through their domain
 * IPC on mount.
 *
 * Partial fallback: with `partial=true` the caller shows the dev-mode
 * banner and re-initializes only the failed stores to their defaults.
 * Boot itself proceeds (F.2 line 1125).
 */

import { invoke } from "@tauri-apps/api/core";

import type {
  ConnectionConfig,
  ConnectionGroup,
  ConnectionStatus,
} from "@/types/connection";

/** Each store slot is either the domain data or `{ error: ... }` (partial). */
export type StoreSlot<T> = T | { error: string };

export interface ConnectionsStore {
  /** `ConnectionConfig` is the frontend name; wire form of the Rust
   * `ConnectionConfigPublic` — exposes only the `hasPassword` boolean,
   * no plaintext / ciphertext. */
  items: ConnectionConfig[];
  groups: ConnectionGroup[];
}

/**
 * Q13 PK (connection_id, db_name). Launcher window → empty map;
 * workspace window → only that conn's entries. Per-cell shape is the
 * `PersistedWorkspaceState` dehydrate output — the hydration layer owns
 * rehydration, so this wrapper exposes only `unknown`.
 */
export interface WorkspacesStore {
  byConnectionId: Record<string, Record<string, unknown>>;
}

export interface MruStore {
  recentConnections: string[];
  lastUsedConnectionId: string | null;
}

export interface ThemeStore {
  themeId: string;
  /** `"system" | "light" | "dark"` (the frontend `ThemeMode` union mirrors this). */
  mode: string;
}

export interface SafeModeStore {
  /** `"off" | "on"` (the frontend `SafeMode` union mirrors this). */
  mode: string;
}

export interface InitialAppState {
  /** Incremented on every breaking shape change. */
  schemaVersion: 1;
  /** monotonic per boot — frontend event dedup baseline. */
  snapshotVersion: number;
  /** Unix ms — measured by the backend via `SystemTime::now()`. */
  generatedAt: number;
  /** True when at least one store failed to hydrate; the others proceed normally. */
  partial: boolean;
  /** v0.3.1: true when boot auto-recovery (quarantine + fresh) ran. Runtime meta only — schemaVersion stays 1. */
  recovered: boolean;
  /**
   * #2183: true when `connections.json` was missing, the adjacent backup was
   * used to restore, and that backup contained connections or groups.
   * Restoring an empty document is false — there was nothing to bring back.
   * A different key from `recovered`: `recovered` means the app state was
   * reset, while this means nothing was reset and the saved connections and
   * groups came back, so the user-facing message and the file to point at
   * differ. True even when only one of the two came back. Also runtime
   * meta, so schemaVersion stays 1.
   */
  connectionsRestoredFromBackup: boolean;
  stores: {
    connections: StoreSlot<ConnectionsStore>;
    workspaces: StoreSlot<WorkspacesStore>;
    mru: StoreSlot<MruStore>;
    theme: StoreSlot<ThemeStore>;
    safeMode: StoreSlot<SafeModeStore>;
  };
  runtime: {
    /** Q14 — process-state mirror of the backend M2 truth. */
    activeStatuses: Record<string, ConnectionStatus>;
  };
}

/**
 * Fetch the atomic boot snapshot from the backend. The window scope
 * (launcher / workspace) is resolved by the backend from `tauri::Window`'s
 * `label()` — the frontend passes no argument.
 *
 * Failure cases:
 *   - SQLite corrupt / lock timeout → rejects with `Error("Storage error: ...")`.
 *     The caller should show a fatal toast and recommend entering safe mode.
 *   - Some stores fail → returns `partial: true` + `{ error }` in those slots.
 *     The caller proceeds with the dev banner + default initialization.
 */
export async function getInitialAppState(): Promise<InitialAppState> {
  return invoke<InitialAppState>("get_initial_app_state");
}

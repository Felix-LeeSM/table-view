/**
 * Sprint 357 (Phase 1) — `get_initial_app_state` IPC frontend wrapper.
 *
 * Boot 시 atomic single-shot read 로 5 boot-critical store + runtime
 * activeStatuses 를 hydration. Strategy F.2 (line 911–998) 의 wire shape
 * 과 byte-equivalent. 호출은 launcher 또는 workspace window 어디서나 가능 —
 * window scope 분기는 backend 가 `window.label()` 로 자동 처리.
 *
 * Out of Scope (sprint-365 / sprint-367):
 *   - Snapshot 의 frontend hydrate 적용 (store mirror, listener 등록 순서).
 *   - Schema version mismatch handling (safe mode 진입).
 *
 * Lazy stores (favorites / queryHistory / schemaCache / datagrid_prefs) 는
 * 본 snapshot 에 포함되지 않음. Mount 시 도메인별 IPC 로 fetch.
 *
 * Partial fallback: `partial=true` 면 dev mode banner + 해당 store 만 default
 * 초기화. Boot 자체는 진행 (F.2 line 1125).
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
  /** `ConnectionConfig` 는 frontend 명. Rust 측 `ConnectionConfigPublic` 의 wire
   * 형태 — `hasPassword` boolean 만 노출, plaintext / ciphertext 없음. */
  items: ConnectionConfig[];
  groups: ConnectionGroup[];
}

/**
 * Q13 PK (connection_id, db_name). Launcher window → 빈 map; workspace window
 * → 그 conn 만. Per-cell shape 은 `PersistedWorkspaceState` (sprint-353
 * dehydrate output) — sprint-367 의 hydration 책임이므로 본 wrapper 는
 * `unknown` 으로만 노출.
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
  /** `"system" | "light" | "dark"` (실제 ThemeMode union 은 sprint-367 에서 mirror). */
  mode: string;
}

export interface SafeModeStore {
  /** `"off" | "on"` (실제 SafeMode union 은 sprint-367 에서 mirror). */
  mode: string;
}

export interface InitialAppState {
  /** breaking shape change 마다 ++. 현재 1. */
  schemaVersion: 1;
  /** monotonic per boot — frontend event dedup baseline. */
  snapshotVersion: number;
  /** unix ms — backend 가 SystemTime::now() 으로 측정. */
  generatedAt: number;
  /** 한 store 라도 hydrate 실패면 true. 다른 store 는 정상 진행. */
  partial: boolean;
  /** v0.3.1: boot 자동 복구(quarantine + fresh)가 발생했으면 true. runtime meta 이라 schemaVersion 은 1 유지. */
  recovered: boolean;
  stores: {
    connections: StoreSlot<ConnectionsStore>;
    workspaces: StoreSlot<WorkspacesStore>;
    mru: StoreSlot<MruStore>;
    theme: StoreSlot<ThemeStore>;
    safeMode: StoreSlot<SafeModeStore>;
  };
  runtime: {
    /** Q14 — backend M2 truth 의 process state mirror. */
    activeStatuses: Record<string, ConnectionStatus>;
  };
}

/**
 * Atomic boot snapshot 을 backend 에서 fetch. Window scope (launcher /
 * workspace) 는 backend 가 `tauri::Window` 의 `label()` 로 자동 분기 —
 * frontend 는 인자 전달 안 함.
 *
 * 실패 케이스:
 *   - SQLite corrupt / 락 timeout → `Error("Storage error: ...")` reject.
 *     호출자는 fatal toast + safe mode 진입 권장.
 *   - 일부 store 실패 → `partial: true` 반환 + 그 슬롯에 `{ error }`.
 *     호출자는 dev banner + default 초기화로 계속 진행.
 */
export async function getInitialAppState(): Promise<InitialAppState> {
  return invoke<InitialAppState>("get_initial_app_state");
}

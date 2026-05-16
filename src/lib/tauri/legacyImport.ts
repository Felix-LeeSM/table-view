/**
 * Sprint 355 (Phase 1) — `import_legacy_localstorage` IPC frontend wrapper.
 *
 * Strategy line 1140–1180: 첫 boot 시 frontend 가 5 LS key 를 read 해 정규화
 * 후 본 wrapper 를 통해 backend 로 전송. Backend 는 SQLite 에 1회 import
 * + `meta.legacy_imported` 4-state transition 관리 (idempotent).
 *
 * 본 sprint 의 wrapper 는 `favorites` / `mru` 두 도메인만 wire — 나머지
 * (workspaces / theme / safeMode) 는 sprint-358+ 에서 추가.
 *
 * 호출자는 다음을 책임:
 *   1. 각 LS key 의 raw shape 을 parse / normalize.
 *   2. dehydrated camelCase payload 생성.
 *   3. 호출 후 LS key 즉시 삭제 안 함 (W3 진입 step 에서 cleanup).
 *
 * Backend 가 idempotent 이므로 호출자가 두 번 보내도 안전.
 */

import { invoke } from "@tauri-apps/api/core";

export interface LegacyFavorite {
  id: string;
  name: string;
  sql: string;
  /** `null` 또는 생략 시 backend column 은 NULL — global favorite. */
  connectionId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface LegacyMruEntry {
  connectionId: string;
  /** unix ms — `Date.now()` 호출 시점. */
  lastUsed: number;
}

export interface LegacyPayload {
  favorites?: LegacyFavorite[];
  mru?: LegacyMruEntry[];
}

/**
 * Backend 에 legacy LS payload 를 전송.
 *
 * - 처음 호출 시 `meta.legacy_imported`: pending → importing → done.
 * - 이미 done 이면 backend 가 no-op 으로 반환 (호출 비용 ~IPC overhead).
 * - 실패 시 backend 가 state 를 failed 로 set + error throw — 호출자는
 *   safe-mode 진입 또는 사용자에게 retry 안내.
 */
export async function importLegacyLocalStorage(
  payload: LegacyPayload,
): Promise<void> {
  await invoke<void>("import_legacy_localstorage", { payload });
}

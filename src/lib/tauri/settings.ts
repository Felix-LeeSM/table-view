/**
 * Sprint 369 (Phase 4) — settings IPC frontend wrapper.
 * Sprint 376 (Phase 6 Q21) — `resetSetting` 추가. Q21 9 affordance 가
 * 모두 본 wrapper 를 경유. Strategy doc line 1389 — `setting.reset` 은
 * receiver refetch 없이 frontend `SETTING_DEFAULTS[entityId]` 적용.
 *
 * `persist_setting` 은 sprint-358 (Phase 1 W1) 에서 backend dual-write 가
 * 도착했으나 frontend 호출 사이트는 아직 없다. 본 sprint 가 처음으로
 * `home_recent_collapsed` / `sidebar_width` 사이트를 LS → SQLite 로 옮기며
 * 사용. value 는 backend `value_json: String` 으로 그대로 흘러간다 (어떤
 * JSON-encodable 도 OK — frontend 가 serialize).
 */

import { invoke } from "@tauri-apps/api/core";

export interface PersistSettingRequest {
  key: string;
  /** Already-serialized JSON. boolean / number / object 모두 OK. */
  valueJson: string;
}

export async function persistSetting(
  req: PersistSettingRequest,
): Promise<void> {
  await invoke("persist_setting", { req });
}

export async function persistSettingValue(
  key: string,
  value: unknown,
): Promise<void> {
  return persistSetting({ key, valueJson: JSON.stringify(value) });
}

/**
 * Sprint 376 (Phase 6 Q21) — single-key reset to default. Backend
 * deletes the SQLite `settings` row and emits `state-changed
 * { domain:"setting", op:"reset", entityId: key }`. Strategy doc line
 * 1389 — receivers do NOT refetch; they apply the frontend
 * `SETTING_DEFAULTS[entityId]` constant directly. Idempotent: missing
 * key is a no-op but still emits so cross-window state converges.
 *
 * Callers MUST NOT pair this with a follow-up `persistSettingValue` of
 * the default — that would write the default back to SQLite and defeat
 * the row-delete contract. Just call `resetSetting(key)`; the local
 * window's store will receive the `state-changed` event and apply the
 * frontend default itself.
 */
export async function resetSetting(key: string): Promise<void> {
  await invoke("reset_setting", { key });
}

export async function getSetting(key: string): Promise<string | null> {
  return invoke<string | null>("get_setting", { key });
}

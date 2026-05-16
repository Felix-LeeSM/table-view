/**
 * Sprint 369 (Phase 4) — settings IPC frontend wrapper.
 *
 * `persist_setting` 은 sprint-358 (Phase 1 W1) 에서 backend dual-write 가
 * 도착했으나 frontend 호출 사이트는 아직 없다. 본 sprint 가 처음으로
 * `home_recent_collapsed` / `sidebar_width` 사이트를 LS → SQLite 로 옮기며
 * 사용. value 는 backend `value_json: String` 으로 그대로 흘러간다 (어떤
 * JSON-encodable 도 OK — frontend 가 serialize).
 *
 * Out of Scope (sprint-370+):
 *   - W2 dual-read gate (theme / safeMode 의 frontend hydration switch).
 *   - settings reset IPC (`reset_setting`).
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

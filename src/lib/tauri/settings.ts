/**
 * Settings IPC frontend wrapper. `resetSetting` (Q21) — every Q21
 * affordance routes through it. Strategy doc line 1389 — `setting.reset`
 * applies the frontend `SETTING_DEFAULTS[entityId]` without a receiver
 * refetch.
 *
 * `persist_setting` has backend dual-write but no frontend call site yet.
 * This wrapper introduces the first call sites, moving
 * `home_recent_collapsed` / `sidebar_width` from LS → SQLite. The value
 * flows through as the backend's `value_json: String` (any
 * JSON-encodable value works — the frontend serializes).
 */

import { invoke } from "@tauri-apps/api/core";

export interface PersistSettingRequest {
  key: string;
  /** Already-serialized JSON. boolean / number / object all work. */
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
 * Single-key reset to default (Q21). Backend
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

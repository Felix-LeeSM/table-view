/**
 * Sprint 369 (Phase 4) — `meta` table sentinel IPC wrapper.
 *
 * `meta` 는 boot-state (`legacy_imported` / `last_legacy_import_at`) 외에도
 * "한 번만 처리하는" frontend migration 의 dismiss sentinel 을 보관한다.
 * settings 의 known key 와는 별도 — Q21 reset audit 대상 0.
 *
 * 사용 사이트 (sprint-369):
 *   - `legacy_column_prefs_drop_dismissed` — `column-widths:*` /
 *     `hidden-columns:*` LS key drop 의 1회 toast 표시 후 set.
 */

import { invoke } from "@tauri-apps/api/core";

export async function getMetaSentinel(key: string): Promise<string | null> {
  return await invoke<string | null>("get_meta_sentinel", { key });
}

export async function setMetaSentinel(args: {
  key: string;
  value: string;
}): Promise<void> {
  await invoke("set_meta_sentinel", { req: args });
}

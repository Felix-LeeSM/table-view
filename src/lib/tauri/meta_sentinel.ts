/**
 * `meta` table sentinel IPC wrapper.
 *
 * Besides the boot-state keys (`legacy_imported` /
 * `last_legacy_import_at`), `meta` also holds dismiss sentinels for
 * "process once" frontend migrations. Separate from the settings known
 * keys — none of them are Q21 reset-audit targets.
 *
 * Call sites:
 *   - `legacy_column_prefs_drop_dismissed` — set after showing the
 *     one-time toast for the `column-widths:*` / `hidden-columns:*` LS
 *     key drop.
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

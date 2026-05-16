/**
 * Sprint 356 (Phase 1, Q22) — Linux keyring fallback sentinel writer.
 *
 * Backend lives in `src-tauri/src/storage/key_migration.rs`. The toast lives
 * outside any SQLite migration so it can't use the `meta` table; instead a
 * **file sidecar** (`.keyring-fallback-dismissed`, AC-356-06) marks the
 * "user has dismissed this notice" state. The Tauri command writes that
 * sidecar; here we expose the typed wrapper so the React component can call
 * it without worrying about IPC plumbing.
 *
 * Implementation note: as of sprint-356 the Tauri command is registered as
 * `set_keyring_fallback_dismissed`. This wrapper exists to give us a single
 * place to swap the command name (or stub it out in unit tests, as the
 * `KeyringFallbackToast.test.tsx` `vi.mock` does).
 */

import { invoke } from "@tauri-apps/api/core";

export async function setKeyringFallbackDismissed(): Promise<void> {
  await invoke("set_keyring_fallback_dismissed");
}

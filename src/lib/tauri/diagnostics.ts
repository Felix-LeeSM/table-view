/**
 * 작성 2026-07-17 (#1566) — diagnostics IPC frontend wrapper.
 *
 * `open_log_dir` — reveal the rotating log folder (#1599 file sink) in the OS
 * file explorer so a user can attach logs to a bug report without hunting the
 * platform data dir. Resolves to the opened path (created first if absent).
 */

import { invoke } from "@tauri-apps/api/core";

export function openLogDir(): Promise<string> {
  return invoke<string>("open_log_dir");
}

/**
 * Sprint 369 (Phase 4, Q20.3) — `set_group_collapsed` IPC frontend wrapper.
 *
 * 기존 `table-view-group-collapsed` localStorage 영속 → SQLite
 * `connection_groups.collapsed` 컬럼. cross-window 일관성 확보.
 */

import { invoke } from "@tauri-apps/api/core";

export interface SetGroupCollapsedRequest {
  groupId: string;
  collapsed: boolean;
}

export async function setGroupCollapsed(
  req: SetGroupCollapsedRequest,
): Promise<void> {
  await invoke("set_group_collapsed", { req });
}

/**
 * `set_group_collapsed` IPC frontend wrapper (Q20.3).
 *
 * Replaces the `table-view-group-collapsed` localStorage persistence with
 * the SQLite `connection_groups.collapsed` column, so collapsed state is
 * consistent across windows.
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

import { invoke } from "@tauri-apps/api/core";

/**
 * Mirror of Rust `PersistWorkspaceRequest` (serde `rename_all = "camelCase"`).
 * The `*Json` fields are already-serialized JSON strings — the backend stores
 * them verbatim in the SQLite `workspaces` table (keyed by `(connectionId,
 * dbName)`) and `get_initial_app_state` reconstitutes them on boot into the
 * `WorkspaceState` shape the store hydrates.
 */
export interface PersistWorkspaceRequest {
  connectionId: string;
  dbName: string;
  activeTabId: string | null;
  tabsJson: string;
  sidebarExpandedJson: string;
  closedTabsJson: string;
}

/** UPSERT a single `(connectionId, dbName)` workspace snapshot into SQLite. */
export async function persistWorkspace(
  req: PersistWorkspaceRequest,
): Promise<void> {
  await invoke("persist_workspace", { req });
}

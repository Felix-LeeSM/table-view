import { useDataGridEditStore } from "@stores/dataGridEditStore";
import { useDocumentCatalogStore } from "@stores/documentCatalogStore";
import { useDocumentQueryStore } from "@stores/documentQueryStore";
import { useSchemaStore } from "@stores/schemaStore";
import { useWorkspaceStore } from "@stores/workspaceStore";

function getOptionalState<T>(store: { getState?: () => T }): T | null {
  // Component suites often use selector-only store doubles; production
  // Zustand stores expose getState.
  return typeof store.getState === "function" ? store.getState() : null;
}

/**
 * Single frontend teardown invariant for a connection id.
 *
 * This intentionally lives outside any one store: removing or disconnecting a
 * connection must clear metadata caches, workspace tabs, and pending edits as
 * one lifecycle step.
 */
export function cleanupConnectionFrontendState(connectionId: string): void {
  getOptionalState(useSchemaStore)?.clearForConnection?.(connectionId);
  getOptionalState(useDocumentCatalogStore)?.clearConnection?.(connectionId);
  getOptionalState(useDocumentQueryStore)?.clearConnection?.(connectionId);
  getOptionalState(useWorkspaceStore)?.clearForConnection?.(connectionId);
  getOptionalState(useDataGridEditStore)?.purgeForConnection?.(connectionId);
}

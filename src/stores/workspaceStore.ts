/**
 * `workspaceStore` — per-workspace state keyed by `(connId, db)`. ADR 0027.
 *
 * Absorbs the former `tabStore`: tabs, active tab, closed-tab history,
 * dirty markers, and sidebar (selected node / expanded set / scroll
 * position) all live in a cohesive `WorkspaceState` keyed by the
 * `(connId, db)` tuple.
 *
 * This module is the public composition point (single import surface for
 * consumers). It re-exports from same-store internal modules under
 * `./workspaceStore/*`; the store instance itself lives in `./store` and the
 * derived read hooks in `./selectors`, so nothing here imports back through the
 * barrel (no runtime cycle — #1361). The `no-restricted-imports` store-boundary
 * rule (eslint.config.js) still flags these same-store paths (their dir sits
 * under `workspaceStore`), so each value re-export carries a justified line
 * disable — the guardrail stays live for genuine sibling-store imports.
 */
export type {
  ErdTab,
  QueryTab,
  SidebarState,
  Tab,
  TableTab,
  TableTabInit,
  TabObjectKind,
  TabSubView,
  WorkspaceQueryMode,
  WorkspaceState,
  WorkspaceStoreState,
} from "./workspaceStore/types";

// eslint-disable-next-line no-restricted-imports -- same-store internal: store instance leaf
export { SYNCED_KEYS, useWorkspaceStore } from "./workspaceStore/store";
// eslint-disable-next-line no-restricted-imports -- same-store internal: persistence flush (#1580)
export { flushPersistWorkspaces } from "./workspaceStore/persistence";
// eslint-disable-next-line no-restricted-imports -- same-store internal: shared helpers
export {
  __resetCountersForTests,
  resolveActiveDb,
} from "./workspaceStore/shared";
// eslint-disable-next-line no-restricted-imports -- same-store internal: derived read hooks
export {
  useActiveTab,
  useActiveTabId,
  useActiveTabSansSql,
  useClosedTabHistory,
  useConnectionHasDirtyTabs,
  useCurrentTabIds,
  useCurrentTabs,
  useCurrentWorkspace,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceFor,
  useWorkspaceKeyForConnection,
  type ActiveTabSansSql,
  type WorkspaceKey,
} from "./workspaceStore/selectors";

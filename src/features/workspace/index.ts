export { default as WorkspaceApp } from "@/App";
export { default as WorkspacePage } from "@/pages/WorkspacePage";
export { default as MainArea } from "@components/layout/MainArea";
export { default as Sidebar } from "@components/layout/Sidebar";
export { default as SidebarModeToggle } from "@components/layout/SidebarModeToggle";
export { default as TabBar } from "@components/layout/TabBar";
export { default as TabItem } from "@components/layout/TabItem";
export { default as ConfirmDestructiveDialog } from "@components/workspace/ConfirmDestructiveDialog";
export { default as DbSwitcher } from "@components/workspace/DbSwitcher";
export { default as DisconnectButton } from "@components/workspace/DisconnectButton";
export { default as DocumentSidebar } from "@components/workspace/DocumentSidebar";
export { default as DryRunPreview } from "@components/workspace/DryRunPreview";
export { KvMutationPanel } from "@components/workspace/KvMutationPanel";
export { default as KvSidebar } from "@components/workspace/KvSidebar";
export { default as RdbSidebar } from "@components/workspace/RdbSidebar";
export { default as SafeModeToggle } from "@components/workspace/SafeModeToggle";
export { default as SearchSidebar } from "@components/workspace/SearchSidebar";
export { default as UnsupportedShellNotice } from "@components/workspace/UnsupportedShellNotice";
export { default as WorkspaceSidebar } from "@components/workspace/WorkspaceSidebar";
export { default as WorkspaceToolbar } from "@components/workspace/WorkspaceToolbar";
export { pickSidebar } from "@components/workspace/pickSidebar";
export type { SidebarKind } from "@components/workspace/pickSidebar";
export { useTabDrag } from "@components/layout/useTabDrag";
export type {
  GhostStyle,
  TabDragHandlers,
  UseTabDragResult,
} from "@components/layout/useTabDrag";
export {
  SYNCED_KEYS,
  __resetCountersForTests,
  resolveActiveDb,
  useActiveTab,
  useActiveTabId,
  useClosedTabHistory,
  useCurrentTabs,
  useCurrentWorkspace,
  useCurrentWorkspaceKey,
  useDirtyTabIds,
  useWorkspaceFor,
  useWorkspaceKeyForConnection,
  useWorkspaceStore,
} from "@stores/workspaceStore";
export type {
  QueryTab,
  SidebarState,
  Tab,
  TableTab,
  TableTabInit,
  TabObjectKind,
  TabSubView,
  WorkspaceKey,
  WorkspaceQueryMode,
  WorkspaceState,
  WorkspaceStoreState,
} from "@stores/workspaceStore";

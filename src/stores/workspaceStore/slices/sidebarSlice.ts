import type { WorkspaceStoreState } from "../types";
import { withWorkspace, type WorkspaceSet } from "../shared";

type SidebarSlice = Pick<
  WorkspaceStoreState,
  "toggleExpand" | "setExpanded" | "setScrollTop" | "setSelectedNode"
>;

export function createSidebarSlice(set: WorkspaceSet): SidebarSlice {
  return {
    toggleExpand: (connId, db, nodeId) => {
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) => {
          const current = ws.sidebar.expanded ?? [];
          const has = current.includes(nodeId);
          const expanded = has
            ? current.filter((n) => n !== nodeId)
            : [...current, nodeId];
          return { ...ws, sidebar: { ...ws.sidebar, expanded } };
        });
        return next ? { workspaces: next } : state;
      });
    },

    setExpanded: (connId, db, nodes) => {
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) => {
          const current = ws.sidebar.expanded;
          if (
            current !== null &&
            current.length === nodes.length &&
            current.every((n, i) => n === nodes[i])
          ) {
            return ws;
          }
          return { ...ws, sidebar: { ...ws.sidebar, expanded: [...nodes] } };
        });
        return next ? { workspaces: next } : state;
      });
    },

    setScrollTop: (connId, db, px) => {
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) =>
          ws.sidebar.scrollTop === px
            ? ws
            : { ...ws, sidebar: { ...ws.sidebar, scrollTop: px } },
        );
        return next ? { workspaces: next } : state;
      });
    },

    setSelectedNode: (connId, db, nodeId) => {
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) =>
          ws.sidebar.selectedNode === nodeId
            ? ws
            : { ...ws, sidebar: { ...ws.sidebar, selectedNode: nodeId } },
        );
        return next ? { workspaces: next } : state;
      });
    },
  };
}

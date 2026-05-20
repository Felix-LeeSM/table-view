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
          const has = ws.sidebar.expanded.includes(nodeId);
          const expanded = has
            ? ws.sidebar.expanded.filter((n) => n !== nodeId)
            : [...ws.sidebar.expanded, nodeId];
          return { ...ws, sidebar: { ...ws.sidebar, expanded } };
        });
        return next ? { workspaces: next } : state;
      });
    },

    setExpanded: (connId, db, nodes) => {
      set((state) => {
        const next = withWorkspace(state, connId, db, (ws) => {
          if (
            ws.sidebar.expanded.length === nodes.length &&
            ws.sidebar.expanded.every((n, i) => n === nodes[i])
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

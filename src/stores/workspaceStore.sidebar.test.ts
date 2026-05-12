/**
 * `workspaceStore` sidebar axis. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors covered:
 *   - `toggleExpand(connId, db, nodeId)` — lazy workspace creation +
 *     toggle in `sidebar.expanded` (order-preserving array).
 *   - `setScrollTop(connId, db, px)` — isolated per workspace.
 *   - `setSelectedNode(connId, db, nodeId | null)` — per-workspace
 *     selected highlight.
 *
 * Author intent (2026-05-12): vertical slice. Each behavior is a separate
 * RED→GREEN cycle.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";

describe("workspaceStore — sidebar", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("toggleExpand — lazy-creates workspace and appends nodeId", () => {
    useWorkspaceStore.getState().toggleExpand("conn1", "dbA", "schema:public");

    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.sidebar.expanded).toEqual(["schema:public"]);
    expect(ws!.tabs).toEqual([]);
    expect(ws!.activeTabId).toBeNull();
  });

  it("toggleExpand — second call on same node removes it (toggle)", () => {
    const store = useWorkspaceStore.getState();
    store.toggleExpand("conn1", "dbA", "schema:public");
    store.toggleExpand("conn1", "dbA", "schema:public");

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.sidebar.expanded).toEqual([]);
  });

  it("toggleExpand — preserves insertion order across distinct nodes", () => {
    const store = useWorkspaceStore.getState();
    store.toggleExpand("conn1", "dbA", "schema:public");
    store.toggleExpand("conn1", "dbA", "schema:tenant");
    store.toggleExpand("conn1", "dbA", "schema:audit");

    const ws = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    expect(ws.sidebar.expanded).toEqual([
      "schema:public",
      "schema:tenant",
      "schema:audit",
    ]);
  });

  it("setScrollTop — only mutates the targeted workspace's scrollTop", () => {
    const store = useWorkspaceStore.getState();
    store.setScrollTop("conn1", "dbA", 120);
    store.setScrollTop("conn1", "dbB", 40);

    const a = useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!;
    const b = useWorkspaceStore.getState().workspaces["conn1"]!["dbB"]!;
    expect(a.sidebar.scrollTop).toBe(120);
    expect(b.sidebar.scrollTop).toBe(40);
  });

  it("setSelectedNode — stores per-workspace selection, null clears", () => {
    const store = useWorkspaceStore.getState();
    store.setSelectedNode("conn1", "dbA", "table:public.users");
    expect(
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.sidebar
        .selectedNode,
    ).toBe("table:public.users");

    store.setSelectedNode("conn1", "dbA", null);
    expect(
      useWorkspaceStore.getState().workspaces["conn1"]!["dbA"]!.sidebar
        .selectedNode,
    ).toBeNull();
  });
});

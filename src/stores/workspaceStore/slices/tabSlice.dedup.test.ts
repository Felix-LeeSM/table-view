// Issue #1096 — addTab dedup must compare schema (and database) alongside
// table, or a same-named table in a different schema focuses the wrong tab
// instead of opening its own. `database` is already isolated by the
// `workspaces[connId][db]` bucket, so `schema` is the real missing axis;
// these tests lock both the fix and the preserved "reopen focuses existing"
// behavior for the same schema+table.
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { TableTabInit } from "../types";

function tableInit(overrides: Partial<TableTabInit>): TableTabInit {
  return {
    type: "table",
    connectionId: "conn1",
    title: "t",
    closable: true,
    database: "mydb",
    schema: "public",
    table: "users",
    subView: "records",
    permanent: true,
    ...overrides,
  };
}

describe("tabSlice — Issue #1096 addTab dedup includes schema", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
  });

  it("opens a separate tab for a same-named table in a different schema", () => {
    const add = useWorkspaceStore.getState().addTab;
    add("conn1", tableInit({ schema: "public", title: "public.users" }));
    add("conn1", tableInit({ schema: "audit", title: "audit.users" }));

    const ws = useWorkspaceStore.getState().workspaces.conn1!.mydb!;
    const tableTabs = ws.tabs.filter((t) => t.type === "table");
    expect(tableTabs).toHaveLength(2);
    expect(
      tableTabs.map((t) => (t as { schema?: string }).schema).sort(),
    ).toEqual(["audit", "public"]);
  });

  it("focuses the existing tab when reopening the same schema+table", () => {
    const add = useWorkspaceStore.getState().addTab;
    add("conn1", tableInit({ schema: "public", title: "public.users" }));
    const firstId =
      useWorkspaceStore.getState().workspaces.conn1!.mydb!.activeTabId;
    add("conn1", tableInit({ schema: "public", title: "public.users" }));

    const ws = useWorkspaceStore.getState().workspaces.conn1!.mydb!;
    expect(ws.tabs.filter((t) => t.type === "table")).toHaveLength(1);
    expect(ws.activeTabId).toBe(firstId);
  });
});

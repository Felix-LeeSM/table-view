/**
 * `persistWorkspaces` → `persist_workspace` IPC wiring (#1091).
 *
 * sprint-358 left `persistWorkspaces` a no-op (`void dehydrateAll(...)`),
 * dropping the dehydration result on the floor — zero `invoke` sites, so a
 * restart lost every tab / SQL. sprint-365 was meant to hook up the consumer
 * but never did. These tests lock the wiring.
 *
 * Boundary mock: only `@tauri-apps/api/core` `invoke` is stubbed (mock-scope
 * rule). Dehydration + request shaping run for real, so any snake_case /
 * camelCase or object-vs-string drift against the Rust `PersistWorkspaceRequest`
 * fails here (guards the #1190-class shape mismatch).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "@lib/runtime/toast";
import { persistWorkspaces, type WorkspacesShape } from "./persistence";
import type { WorkspaceState } from "./types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { error: vi.fn() },
}));

function ws(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
    ...overrides,
  };
}

function firstReq(): Record<string, unknown> {
  const call = vi.mocked(invoke).mock.calls[0];
  if (!call) throw new Error("invoke was not called");
  return (call[1] as { req: Record<string, unknown> }).req;
}

describe("persistWorkspaces — persist_workspace IPC (#1091)", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(toast.error).mockClear();
  });

  it("ships each (connId, db) workspace to persist_workspace with the Rust request shape", () => {
    const workspaces: WorkspacesShape = {
      conn1: {
        dbA: ws({
          tabs: [
            {
              type: "table",
              id: "tab-1",
              title: "users",
              connectionId: "conn1",
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
              database: "dbA",
              isPreview: false,
              paradigm: "rdb",
              sorts: [],
            },
          ],
          activeTabId: "tab-1",
          sidebar: {
            selectedNode: "node-x",
            expanded: ["public"],
            scrollTop: 40,
          },
        }),
      },
    };

    persistWorkspaces(workspaces);

    expect(invoke).toHaveBeenCalledTimes(1);
    const [cmd] = vi.mocked(invoke).mock.calls[0]!;
    expect(cmd).toBe("persist_workspace");
    const req = firstReq();
    // camelCase keys mirroring PersistWorkspaceRequest (serde rename_all).
    expect(req).toMatchObject({
      connectionId: "conn1",
      dbName: "dbA",
      activeTabId: "tab-1",
    });
    // *_json fields are serialized JSON strings, not nested objects.
    expect(typeof req.tabsJson).toBe("string");
    expect(typeof req.sidebarExpandedJson).toBe("string");
    expect(typeof req.closedTabsJson).toBe("string");
    // sidebar payload carries ONLY the expanded array (backend reconstitutes
    // sidebar = { expanded }); transient selectedNode / scrollTop dropped.
    expect(JSON.parse(req.sidebarExpandedJson as string)).toEqual(["public"]);
    const tabs = JSON.parse(req.tabsJson as string) as { id: string }[];
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toBe("tab-1");
  });

  it("UPSERTs one row per (connId, db) across multiple workspaces / windows", () => {
    const workspaces: WorkspacesShape = {
      conn1: { dbA: ws(), dbB: ws() },
      conn2: { dbC: ws() },
    };
    persistWorkspaces(workspaces);
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("collapses a running query tab to idle in the persisted payload", () => {
    const workspaces: WorkspacesShape = {
      conn1: {
        dbA: ws({
          tabs: [
            {
              type: "query",
              id: "query-1",
              title: "Query 1",
              connectionId: "conn1",
              closable: true,
              sql: "SELECT 1",
              queryState: { status: "running", queryId: "q-run" },
              paradigm: "rdb",
              queryMode: "sql",
              database: "dbA",
            },
          ],
        }),
      },
    };
    persistWorkspaces(workspaces);
    const tabs = JSON.parse(firstReq().tabsJson as string) as {
      queryState: unknown;
    }[];
    expect(tabs[0]!.queryState).toEqual({ status: "idle" });
  });

  // #1092 / #1091 — SQLite is the SOT with no boot reconcile, so a rejected
  // write is lost on the next restart (the exact silent loss #1091 fixes). A
  // failure must reach the user, and a multi-workspace failure surfaces ONE
  // toast per flush, not one per workspace.
  it("surfaces a single storageWriteFailed toast when persist_workspace rejects", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    persistWorkspaces({ conn1: { dbA: ws(), dbB: ws() } });
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
  });

  it("stays silent when every persist_workspace write resolves", async () => {
    persistWorkspaces({ conn1: { dbA: ws(), dbB: ws() } });
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

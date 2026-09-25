/**
 * `workspaceStore` persistence axis (ADR 0027).
 *
 * Behaviors (updated 2026-05-16):
 *   - Zero LS write sites from the start of state-management-strategy W1.
 *     This store's mutations no longer write to the `table-view-workspaces`
 *     key — the SQLite UPSERT of the backend `persist_workspace` IPC is the
 *     SOT.
 *   - `loadPersistedWorkspaces()` keeps only the legacy LS read — this test
 *     verifies that read path from a seeded LS entry.
 *
 * Author intent (2026-05-12): vertical-slice persistence smoke. The
 * 2026-05-16 update narrowed the write path to read-only-from-legacy.
 *
 * 2026-07-22 (issue #1631 test-audit) — the no-LS-write invariant ("a store
 * mutation does not write LS") has its single SOT in
 * workspaceStore/persistence.no-ls-write.test.ts. The duplicate re-check in
 * this file was removed; here only the read/rehydrate path from a legacy LS
 * seed is verified.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";
import { useWorkspaceStore } from "./workspaceStore";

describe("workspaceStore — persistence", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  // The no-LS-write invariant (store mutation → zero LS writes) has its
  // single SOT in workspaceStore/persistence.no-ls-write.test.ts — issue
  // #1631 (2026-07-22). The duplicate re-check here was removed.

  it("loadPersistedWorkspaces still rehydrates from legacy LS seed (boot import fallback)", () => {
    // Pre-seed LS as if a previous app version had written it.
    // `loadPersistedWorkspaces` reads this entry and hydrates from it.
    const seeded = {
      workspaces: {
        conn1: {
          dbA: {
            tabs: [
              {
                type: "table",
                id: "t-legacy-1",
                title: "users",
                connectionId: "conn1",
                closable: true,
                schema: "public",
                table: "users",
                subView: "records",
                database: "dbA",
              },
            ],
            activeTabId: "t-legacy-1",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    };
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify(seeded),
    );
    useWorkspaceStore.setState({ workspaces: {} });

    useWorkspaceStore.getState().loadPersistedWorkspaces();
    const ws = useWorkspaceStore.getState().workspaces.conn1?.dbA;
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect((ws!.tabs[0] as { table?: string }).table).toBe("users");
  });

  it("[RISK-039] legacy RDB table tabs without database inherit the workspace db on rehydrate", () => {
    // Older persisted table tabs were keyed under workspaces[connId][db] but
    // did not always carry `tab.database`. Pending edit keys and the RDB
    // commit `expectedDatabase` need that identity.
    window.localStorage.setItem(
      "table-view-workspaces",
      JSON.stringify({
        workspaces: {
          conn1: {
            dbA: {
              tabs: [
                {
                  type: "table",
                  id: "t-legacy-no-db",
                  title: "users",
                  connectionId: "conn1",
                  closable: true,
                  schema: "public",
                  table: "users",
                  subView: "records",
                },
              ],
              activeTabId: "t-legacy-no-db",
              closedTabHistory: [
                {
                  type: "table",
                  id: "t-closed-no-db",
                  title: "orders",
                  connectionId: "conn1",
                  closable: true,
                  schema: "public",
                  table: "orders",
                  subView: "records",
                },
              ],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      }),
    );

    useWorkspaceStore.getState().loadPersistedWorkspaces();

    const ws = useWorkspaceStore.getState().workspaces.conn1?.dbA;
    expect(ws?.tabs[0]).toMatchObject({ type: "table", database: "dbA" });
    expect(ws?.closedTabHistory[0]).toMatchObject({
      type: "table",
      database: "dbA",
    });
  });
});

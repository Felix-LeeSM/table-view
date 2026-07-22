/**
 * `workspaceStore` persistence axis. Sprint 262 (ADR 0027) TDD slice.
 *
 * Behaviors (updated 2026-05-16, sprint-358):
 *   - LS write 사이트는 W1 시작 시점부터 0 (codex 6차 #5). 본 store 의 mutation
 *     은 더 이상 `table-view-workspaces` 키에 write 하지 않는다 — backend
 *     `persist_workspace` IPC 의 SQLite UPSERT 가 SOT.
 *   - `loadPersistedWorkspaces()` 는 legacy LS read 만 유지 (boot 시 import
 *     fallback) — 본 테스트는 그 read path 를 seed 된 LS entry 로부터 검증.
 *
 * Author intent (2026-05-12): vertical-slice persistence smoke. Sprint 358
 * 에서 write path 를 read-only-from-legacy 로 좁힘.
 *
 * 2026-07-22 (issue #1631 test-audit Wave 2) — "store mutation 이 LS 에
 * 안 쓴다"는 no-LS-write invariant 는 workspaceStore/persistence.no-ls-write.test.ts
 * 를 단일 SOT 로 삼는다. 본 파일의 중복 재검증은 제거하고, 여기서는 legacy
 * LS seed 로부터의 read/rehydrate 경로만 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useWorkspaceStore } from "./workspaceStore";
import {
  installFakeLocalStorage,
  restoreLocalStorage,
} from "./__tests__/workspaceStoreTestHelpers";

describe("workspaceStore — persistence", () => {
  beforeEach(() => {
    installFakeLocalStorage();
    useWorkspaceStore.setState({ workspaces: {} });
  });

  afterEach(() => {
    restoreLocalStorage();
  });

  // no-LS-write invariant (store mutation → LS write 0) 는
  // workspaceStore/persistence.no-ls-write.test.ts 가 단일 SOT — issue #1631
  // (2026-07-22). 여기서의 중복 재검증은 제거.

  it("loadPersistedWorkspaces still rehydrates from legacy LS seed (boot import fallback)", () => {
    // Pre-seed LS as if a previous app version had written it. boot 시점의
    // import path 가 본 entry 를 read 해서 hydration 한다.
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
    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws).toBeDefined();
    expect(ws!.tabs).toHaveLength(1);
    expect((ws!.tabs[0] as { table?: string }).table).toBe("users");
  });

  it("[RISK-039] legacy RDB table tabs without database inherit the workspace db on rehydrate", () => {
    // Older persisted table tabs were keyed under workspaces[connId][db] but
    // did not always carry `tab.database`. Sprint 433 needs that identity for
    // pending edit keys and RDB commit `expectedDatabase`.
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

    const ws = useWorkspaceStore.getState().workspaces["conn1"]?.["dbA"];
    expect(ws?.tabs[0]).toMatchObject({ type: "table", database: "dbA" });
    expect(ws?.closedTabHistory[0]).toMatchObject({
      type: "table",
      database: "dbA",
    });
  });
});

// TabDbChip — Mongo query tab의 tab-local database selector.
//
// 2026-05-15 — Sprint 329 의 display-only chip 을 interactive selector 로
// 교체. 사용자가 "database 선택도 못 한다 친구야" 로 lock 해제 요구해서
// chip 동작이 완전히 바뀌었다. 본 suite 는 새 contract 를 guard:
//
//   1. database label 이 chip 텍스트로 노출.
//   2. database === "" 일 때도 affordance 가 사라지지 않고 "(select
//      database)" 로 self-rendering (옛 self-hide 동작 폐기 — 그게 바로
//      사용자가 "선택 못 한다" 라고 한 정확한 증상).
//   3. 클릭 → popover 열림 → `listDatabases(connectionId)` 호출.
//   4. 항목 선택 → `setQueryTabDatabase(connId, db, tabId, target)` 호출.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import {
  setFakeWindowConnectionId,
  resetFakeWindowConnectionId,
} from "@stores/__tests__/fakeWindowConnectionId";
import TabDbChip from "./TabDbChip";

vi.mock("@/lib/api/listDatabases", () => ({
  listDatabases: vi.fn(async () => [{ name: "admin" }, { name: "analytics" }]),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { listDatabases } from "@/lib/api/listDatabases";

describe("TabDbChip — interactive database selector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      focusedConnId: "conn-mongo",
      activeStatuses: {
        "conn-mongo": { type: "connected", activeDb: "analytics" },
      },
    });
    useWorkspaceStore.setState({ workspaces: {} });
    // sprint-366 (2026-05-16) — TabDbChip uses `useCurrentWorkspaceKey()`
    // which now resolves `connId` from the Tauri window label. Stub the
    // label so the chip can write to the (`conn-mongo`, `analytics`)
    // workspace slot under test.
    setFakeWindowConnectionId("conn-mongo");
  });

  afterEach(() => {
    resetFakeWindowConnectionId();
    cleanup();
  });

  it("renders the database label as the chip text", () => {
    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );
    expect(
      screen.getByRole("button", { name: /current database: analytics/i }),
    ).toHaveTextContent("analytics");
  });

  it("renders an actionable placeholder when the database is empty", () => {
    // The display-only Sprint 329 chip self-hid when database was "". That
    // produced the exact symptom the user complained about: "데이터베이스
    // 선택도 못 한다." The new contract keeps the affordance visible so
    // the user always has a clickable surface to set a database.
    //
    // Sprint 381 (2026-05-17) — Mongo db-contract α: label changes from
    // "(select database)" → "(no database)" so the chip reflects the
    // *binding* (none), not a nag-CTA. Admin commands run without one;
    // collection commands surface a separate error.
    render(<TabDbChip tabId="query-1" database="" connectionId="conn-mongo" />);
    const trigger = screen.getByRole("button", {
      name: /no database bound/i,
    });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent(/no database/i);
  });

  it("fetches the database list on click and renders the entries", async () => {
    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /current database: analytics/i }),
    );

    await waitFor(() => {
      expect(listDatabases).toHaveBeenCalledWith("conn-mongo");
    });
    expect(await screen.findByRole("option", { name: "admin" })).toBeVisible();
    expect(screen.getByRole("option", { name: "analytics" })).toBeVisible();
  });

  it("selecting an entry dispatches setQueryTabDatabase against the current workspace", async () => {
    // Seed the workspace at (conn-mongo, analytics) so the action has
    // something to patch. `useCurrentWorkspaceKey()` will resolve this
    // pair from the connectionStore seeding in beforeEach.
    useWorkspaceStore.setState({
      workspaces: {
        "conn-mongo": {
          analytics: {
            tabs: [
              {
                type: "query",
                id: "query-1",
                title: "Query 1",
                connectionId: "conn-mongo",
                closable: true,
                sql: "",
                queryState: { status: "idle" },
                paradigm: "document",
                database: "analytics",
              },
            ],
            activeTabId: "query-1",
            closedTabHistory: [],
            dirtyTabIds: [],
            sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
          },
        },
      },
    });

    render(
      <TabDbChip
        tabId="query-1"
        database="analytics"
        connectionId="conn-mongo"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /current database: analytics/i }),
    );
    fireEvent.click(await screen.findByRole("option", { name: "admin" }));

    await waitFor(() => {
      const tab =
        useWorkspaceStore.getState().workspaces["conn-mongo"]?.analytics
          ?.tabs[0];
      expect(tab && tab.type === "query" && tab.database).toBe("admin");
    });
  });
});

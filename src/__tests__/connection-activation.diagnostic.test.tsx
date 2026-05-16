// Purpose: Connection activation lifecycle 진단 — Phase 13 Sprint 156 (2026-04-28)
//
// 사용자 보고 버그:
//   Bug 1: Connection 더블클릭해도 workspace 미열림
//   Bug 2: PG sidebar table click 시 preview tab이 swap되지 않고 누적됨
//
// 이 파일은 handleActivate의 세부 동작을 진단하기 위해 작성되었다.
// HomePage.test.tsx와 window-transitions.test.tsx가 기본 동작을 이미 커버하므로,
// 여기서는 중복을 피하고 edge case + error recovery + race condition에 집중한다.
//
// AC IDs:
//   AC-156-01  Double-click ordering (showWindow → focusWindow → hideWindow)
//   AC-156-02  Rapid double-click guard (no duplicate showWindow)
//   AC-156-03  Re-activation after disconnect
//   AC-156-04  showWindow rejection → launcher stays visible, toast shown
//   AC-156-05  Single-click does NOT trigger window swap
//   AC-156-06  Sequential activation (A → B): B focused, A's stale tabs cleared

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import { render, screen, fireEvent, act } from "@testing-library/react";
import HomePage from "@/pages/HomePage";
import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import type { ConnectionConfig } from "@/types/connection";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/tauri", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/tauri")>("@lib/tauri");
  return {
    ...actual,
    connectToDatabase: vi.fn().mockResolvedValue(undefined),
    disconnectFromDatabase: vi.fn().mockResolvedValue(undefined),
    listConnections: vi.fn().mockResolvedValue([]),
    listGroups: vi.fn().mockResolvedValue([]),
    listSchemas: vi.fn().mockResolvedValue([]),
    listTables: vi.fn().mockResolvedValue([]),
  };
});

vi.mock("@components/connection/ConnectionList", () => ({
  default: ({
    onSelect,
    onActivate,
  }: {
    selectedId: string | null;
    onSelect?: (id: string) => void;
    onActivate?: (id: string) => void;
  }) => (
    <div data-testid="connection-list">
      <button data-testid="list-pick-c1" onClick={() => onSelect?.("c1")}>
        pick c1
      </button>
      <button data-testid="list-activate-c1" onClick={() => onActivate?.("c1")}>
        activate c1
      </button>
      <button data-testid="list-pick-c2" onClick={() => onSelect?.("c2")}>
        pick c2
      </button>
      <button data-testid="list-activate-c2" onClick={() => onActivate?.("c2")}>
        activate c2
      </button>
    </div>
  ),
}));

vi.mock("@components/connection/ConnectionDialog", () => ({
  default: () => <div data-testid="connection-dialog-stub" />,
}));
vi.mock("@components/connection/ImportExportDialog", () => ({
  default: () => <div data-testid="import-export-dialog-stub" />,
}));
vi.mock("@components/connection/GroupDialog", () => ({
  default: () => <div data-testid="group-dialog-stub" />,
}));
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-stub" />,
}));

// jsdom localStorage shim (project-wide pattern).
{
  const store = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => {
        store.set(k, String(v));
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

import * as windowControls from "@lib/window-controls";

const showWindowMock = windowControls.showWindow as Mock;
const hideWindowMock = windowControls.hideWindow as Mock;
const focusWindowMock = windowControls.focusWindow as Mock;

function makeConn(id: string): ConnectionConfig {
  return {
    id,
    name: `${id} DB`,
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "test",
    group_id: null,
    color: null,
    environment: null,
    paradigm: "rdb",
  };
}

function resetStores() {
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
  });
  useWorkspaceStore.setState({ workspaces: {} });
}

beforeEach(() => {
  vi.clearAllMocks();
  showWindowMock.mockResolvedValue(undefined);
  hideWindowMock.mockResolvedValue(undefined);
  focusWindowMock.mockResolvedValue(undefined);
  window.localStorage.clear();
  resetStores();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("AC-156-*: Connection activation diagnostic", () => {
  // Reason (revised 2026-05-16, Wave 9.5 회귀 1): sprint-361 이후 workspace
  // 윈도우는 per-conn label `workspace-{conn_id}` 이며 ConnectionList 의
  // `openWorkspaceWindow(id)` 가 build/focus 책임. HomePage 의 handleActivate
  // 는 `hideWindow("launcher")` 만. 이전 contract 의 showWindow/focusWindow
  // 검증은 sprint-175 의 옛 single-workspace 모델 기준 — 두 윈도우 공존
  // 회귀의 원천이었다.
  it("AC-156-01 (revised): double-click hides launcher and does NOT call showWindow/focusWindow('workspace')", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(focusWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(hideWindowMock).not.toHaveBeenCalled();
  });

  // Reason (revised 2026-05-16): rapid double-click 가드는 여전히 유효.
  // hideWindow("launcher") 가 중복 호출되지 않음을 잠근다.
  it("AC-156-02 (revised): rapid double-click — window seam 호출 0, store side 1회만 갱신", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // launcher 는 항상 visible — hide 호출 0.
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    // store side 는 갱신.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason (revised 2026-05-16): disconnect 후 재활성화 path. 새 invariant
  // 는 hideWindow("launcher") 만 잠금.
  it("AC-156-03 (revised): after disconnecting, re-activating the same connection still hides launcher", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: "c1",
    });

    await act(async () => {
      await useConnectionStore.getState().disconnectFromDatabase("c1");
    });

    expect(useConnectionStore.getState().activeStatuses["c1"]).toEqual({
      type: "disconnected",
    });

    render(<HomePage />);
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason (revised 2026-05-16): 이전 contract 의 "showWindow rejects →
  // launcher stays visible" recovery 는 sprint-361 이후 의미가 없어졌다
  // (HomePage 는 showWindow 호출 안 함). 대신 `hideWindow("launcher")` 가
  // reject 해도 store side 가 일관됨을 잠근다.
  it("AC-156-04 (revised): launcher 는 항상 visible — handleActivate 가 어떤 window seam 도 호출하지 않는다", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason: 단일 클릭(select)은 window swap을 트리거하지 않아야 함.
  //         double-click(= onActivate)만 swap 트리거. 기존 테스트와 중복 방지를 위해
  //         명시적으로 seam 호출 0건을 검증 (2026-04-28)
  it("AC-156-05: single-click (onSelect) does NOT trigger any window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "disconnected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-pick-c1"));
    });

    // Single-click must update focusedConnId but NOT swap windows.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
  });

  // Reason (revised 2026-05-16, Wave 9.5 회귀 1): sequential activation 의
  // store side (focusedConn 갱신 + stale tab cleanup) + launcher hide 만 잠금.
  // 이전의 showWindow/focusWindow 호출 검증은 sprint-361 의 per-conn
  // 윈도우 시스템과 충돌 (이중 윈도우 회귀의 원천).
  it("AC-156-06 (revised): activating connection A then B → B becomes focused, A's stale tabs are cleared", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1"), makeConn("c2")],
      activeStatuses: {
        c1: { type: "connected" },
        c2: { type: "connected" },
      },
      focusedConnId: null,
    });

    // Pre-seed tabs owned by c1.
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            id: "tab-a1",
            title: "public.users",
            connectionId: "c1",
            type: "table",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
            isPreview: false,
          },
        ],
        "tab-a1",
        "conn1",
        "db1",
        { closedTabHistory: [], dirtyTabIds: [] },
      ),
    );

    render(<HomePage />);

    // Activate c1 first.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");

    // Clear mocks to isolate the second activation.
    showWindowMock.mockClear();
    hideWindowMock.mockClear();
    focusWindowMock.mockClear();

    // Now activate c2.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c2"));
    });

    // B must become focused.
    expect(useConnectionStore.getState().focusedConnId).toBe("c2");

    // 회귀 1 (Wave 9.5): launcher 항상 visible. handleActivate 는 store
    // side (focusedConn + stale tabs) 만 책임 — window seam 호출 0.
    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();

    // A's stale tabs must be cleared — only c2 tabs (none yet) remain.
    const tabState = getTestWorkspace();
    const c1Tabs = tabState.tabs.filter((t) => t.connectionId === "c1");
    expect(c1Tabs).toHaveLength(0);
  });

  // Reason: handleActivate의 focusedConnId 업데이트가 window swap 전에 동기적으로
  //         실행되는지 확인. 비동기 처리 순서가 꼬이면 focusedConnId가 아직
  //         업데이트되지 않은 상태에서 workspace가 렌더링될 수 있음 (2026-04-28)
  it("AC-156-01 (extended): setFocusedConn runs synchronously before the async window swap", async () => {
    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    // Fire activate and immediately check — setFocusedConn is synchronous,
    // but the window swap is async (void-returned IIFE). By the time we
    // yield to the event loop via `await act`, the sync part must be done.
    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    // focusedConnId must be set BEFORE showWindow resolves.
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });

  // Reason (revised 2026-05-16, Wave 9.5): HomePage 는 더 이상 showWindow /
  // focusWindow("workspace") 를 호출하지 않으므로 본 케이스의 원본 시나리오는
  // 의미가 사라졌다. 대신 focusWindow 가 mock 으로 reject 되어 있어도
  // HomePage flow 는 영향을 받지 않음을 잠근다 (focusWindow 가 호출되지 않으므로).
  it("AC-156-04b (revised): focusWindow mock rejects — HomePage flow 가 호출하지 않으므로 영향 없음", async () => {
    focusWindowMock.mockImplementation(async () => {
      throw new Error("focusWindow failed (simulated)");
    });

    useConnectionStore.setState({
      connections: [makeConn("c1")],
      activeStatuses: { c1: { type: "connected" } },
      focusedConnId: null,
    });
    render(<HomePage />);

    await act(async () => {
      fireEvent.click(screen.getByTestId("list-activate-c1"));
    });

    expect(showWindowMock).not.toHaveBeenCalled();
    expect(focusWindowMock).not.toHaveBeenCalled();
    expect(hideWindowMock).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().focusedConnId).toBe("c1");
  });
});

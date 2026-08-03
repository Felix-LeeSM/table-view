import { hydrateConnectionSession } from "@lib/runtime/connection/hydrateConnectionSession";
import * as windowControls from "@lib/window-controls";
import { useLayoutStore } from "@stores/layoutStore";
import { useThemeStore } from "@stores/themeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTestWorkspace,
  seedWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";
import type { ConnectionId, TabId } from "@/types/branded";
import WorkspacePage from "./WorkspacePage";

// Wrap the runtime implementation in a spy so the workspace's mount + focus
// call counts can still be asserted while preserving store behavior.
vi.mock("@lib/runtime/connection/hydrateConnectionSession", async () => {
  const actual = await vi.importActual<
    typeof import("@lib/runtime/connection/hydrateConnectionSession")
  >("@lib/runtime/connection/hydrateConnectionSession");
  return {
    ...actual,
    hydrateConnectionSession: vi.fn(actual.hydrateConnectionSession),
  };
});

// #1734 — the stub carries a focusable control so the collapse cases can
// assert the hidden column leaves the accessibility tree and the tab order,
// not just that it stopped painting.
vi.mock("@components/layout/Sidebar", () => ({
  default: () => (
    <div data-testid="sidebar-mock">
      <button type="button">Sidebar stub control</button>
    </div>
  ),
}));

vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-mock" />,
}));

// Sprint 161 — isolate from the full ThemePicker rendering (72 cards + radix
// portals) so we can assert the trigger contract without visual noise.
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

// #1738 (2026-07-25) — 테마/언어를 사이드바 상단 단일 영역(theme 팝오버)으로
// 통합. LanguageSwitcher 도 같은 방식으로 격리해 상단 배치만 검증한다.
vi.mock("@components/theme/LanguageSwitcher", () => ({
  default: () => <div data-testid="language-switcher-mock" />,
}));

// Sprint 154 — `WorkspacePage` registers a `tauri://close-requested`
// listener at mount and routes Back through the `@lib/window-controls`
// seam. Stub the seam so the assertions can observe call shape directly
// (no real Tauri runtime under jsdom).
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

function resetStores() {
  useWorkspaceStore.setState({ workspaces: {} });
  useThemeStore.setState({
    themeId: "slate",
    mode: "dark",
    resolvedMode: "dark",
  });
  // #1734 — `layoutStore` is reset by the global `beforeEach` in
  // `src/test-setup.ts` (`__resetLayoutStoreForTests`), not here.
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    vi.mocked(windowControls.showWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.hideWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.onCloseRequested).mockResolvedValue(() => {});
  });

  it("renders Sidebar and MainArea", () => {
    render(<WorkspacePage />);
    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
    expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
  });

  // #1734 owner decision 1 — the Layout cluster's left-panel toggle drives
  // this. Collapsing hides the schema-tree column but must keep the header
  // rail, which owns the only route back to the launcher and the only
  // theme / language control (#1738) — otherwise a collapsed user is
  // stranded with neither.
  describe("collapsed left panel (#1734)", () => {
    it("hides the sidebar while keeping back-to-connections and the theme control", () => {
      useLayoutStore.setState({ sidebarCollapsed: true });
      render(<WorkspacePage />);

      expect(screen.getByTestId("sidebar-mock")).not.toBeVisible();
      expect(
        screen.getByRole("button", { name: /back to connections/i }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /theme|테마/i }),
      ).toBeInTheDocument();
      expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
    });

    // The regression this pins: an earlier revision gated the column with
    // `{!sidebarCollapsed && <Sidebar/>}`, so every collapse threw the
    // subtree away. Node identity is the proof — React destroys and
    // recreates the DOM node on unmount, so a surviving node means every
    // piece of React state inside survived too (the dragged width, the
    // schema-tree filter text, the Redis SCAN cursor, an open dialog).
    it("keeps the same sidebar DOM node across a collapse → expand cycle (no unmount)", () => {
      render(<WorkspacePage />);
      const beforeCollapse = screen.getByTestId("sidebar-mock");
      expect(beforeCollapse).toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });
      expect(screen.getByTestId("sidebar-mock")).toBe(beforeCollapse);
      expect(beforeCollapse).not.toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: false });
      });
      expect(screen.getByTestId("sidebar-mock")).toBe(beforeCollapse);
      expect(beforeCollapse).toBeVisible();
    });

    // The hidden column must also leave the accessibility tree and the tab
    // order — otherwise "collapsed" is only a visual claim and a screen
    // reader still walks a panel the user closed.
    it("drops the hidden column out of the accessibility tree", () => {
      render(<WorkspacePage />);
      // The mock stands in for the real sidebar's focusable controls.
      expect(
        screen.getByRole("button", { name: /sidebar stub/i }),
      ).toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });

      expect(
        screen.queryByRole("button", { name: /sidebar stub/i }),
      ).toBeNull();
    });

    // The rail drops the button's text but not its accessible name, so the
    // route back to the launcher stays reachable by name and by voice.
    it("narrows the back button to an icon rail without losing its name", () => {
      render(<WorkspacePage />);
      expect(screen.getByText("Connections")).toBeInTheDocument();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });

      expect(screen.queryByText("Connections")).toBeNull();
      expect(
        screen.getByRole("button", { name: /back to connections/i }),
      ).toBeInTheDocument();
    });
  });

  it("renders the [← Connections] back button with the contract aria-label", () => {
    render(<WorkspacePage />);
    expect(
      screen.getByRole("button", { name: /back to connections/i }),
    ).toBeInTheDocument();
  });

  it("does NOT render the SidebarModeToggle (sprint 125 contract AC-04)", () => {
    render(<WorkspacePage />);
    expect(
      screen.queryByRole("radio", { name: /connections mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: /schemas mode/i })).toBeNull();
  });

  it("clicking [← Connections] focuses launcher then closes the current workspace window (Wave 9.5, 2026-05-16)", async () => {
    render(<WorkspacePage />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /back to connections/i }),
      );
    });

    // 사용자 desired UX: launcher 는 항상 visible — focus 만 주고 현재
    // workspace 윈도우는 close.
    expect(windowControls.focusWindow).toHaveBeenCalledWith("launcher");
    expect(windowControls.destroyCurrentWindow).toHaveBeenCalled();
  });

  // Wave 9.5 회귀 4 (2026-05-16) — `close-requested` listener trap.
  //
  // 회귀 증상: Back 클릭 시 launcher focus 는 가지만 workspace 창이 닫히지 않음.
  //
  // 근본 원인: WorkspacePage 가 `onCurrentWindowCloseRequested` 리스너를
  // 등록 + 그 안에서 `preventDefault()` + `handleBackToConnections()` 호출
  // 했다. 회귀 시점의 Back 핸들러가 `closeCurrentWindow()` (= `win.close()`)
  // 를 부르면 Tauri 가 `tauri://close-requested` 이벤트를 다시 발사 → 같은
  // 리스너가 `preventDefault()` → 재호출 → **무한 루프 + window destroy 안 됨**.
  // 현재 fix 는 (1) listener 제거 + (2) `destroyCurrentWindow()` 사용으로
  // close-requested 라이프사이클 자체 우회.
  //
  // 진짜 fix: 리스너 자체 제거. 이 리스너의 존재 이유는 sprint-154 의
  // launcher-hide UX (OS close 가 process kill 처럼 보이지 않게 가로채기)
  // 였는데, Wave 9.5 에서 desired UX 가 "launcher 항상 visible" 로 바뀌면서
  // OS-level close 는 default destroy 가 자연스럽다 (launcher 가 이미
  // visible 이므로 자동으로 활성). 리스너 = dead code.
  //
  // 본 테스트는 WorkspacePage 가 더 이상 close-requested 리스너를 등록하지
  // 않음을 lock — 다시 추가하면 같은 trap 이 부활.
  it("does NOT register a close-requested listener (Wave 9.5 회귀 4 — listener was the infinite loop trap)", () => {
    render(<WorkspacePage />);
    expect(windowControls.onCurrentWindowCloseRequested).not.toHaveBeenCalled();
  });

  it("clicking [← Connections] does NOT clear tabStore (tabs persist across screen swaps)", () => {
    useWorkspaceStore.setState(
      seedWorkspace(
        [
          {
            type: "table",
            id: "tab-1" as TabId,
            title: "users",
            connectionId: "c1" as ConnectionId,
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        "tab-1",
      ),
    );

    render(<WorkspacePage />);
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /back to connections/i }),
      );
    });

    // seedWorkspace auto-derives connId from `firstTab.connectionId` ("c1").
    const state = getTestWorkspace("c1", "db1");
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.id).toBe("tab-1");
    expect(state.activeTabId).toBe("tab-1");
  });

  // --- Sprint 161: ThemePicker in Workspace header ---

  // Reason: Phase 14 AC-161-01 — Workspace에 ThemePicker 마운트 검증 (2026-04-28)
  it("renders ThemePicker trigger button in workspace header", () => {
    render(<WorkspacePage />);
    // The trigger button has an aria-label containing "Workspace theme"
    expect(
      screen.getByRole("button", { name: /workspace theme/i }),
    ).toBeInTheDocument();
  });

  // Reason: Phase 14 AC-161-01 — ThemePicker 팝오버 열면 mock 렌더링 확인 (2026-04-28)
  it("opens ThemePicker popover on trigger click", async () => {
    render(<WorkspacePage />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /workspace theme/i }));
    });

    expect(screen.getByTestId("theme-picker-mock")).toBeInTheDocument();
  });

  // Reason: #1738 (2026-07-25) — 테마/언어 컨트롤을 사이드바 상단 단일
  // 영역(theme 팝오버)으로 통합. 상단 트리거를 열면 테마 + 언어 컨트롤이
  // 함께 노출되어야 한다 (하단 footer 의 중복 theme/language 제거의 대응).
  it("top theme popover also exposes the language switcher (#1738 상단 단일화)", async () => {
    render(<WorkspacePage />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /workspace theme/i }));
    });
    expect(screen.getByTestId("theme-picker-mock")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher-mock")).toBeInTheDocument();
  });

  // Reason: Phase 14 AC-161-02 — Workspace에서 theme mode 변경 시 store 업데이트 검증 (2026-04-28)
  it("theme trigger reflects current mode and theme from store", () => {
    useThemeStore.setState({
      themeId: "github",
      mode: "light",
      resolvedMode: "light",
    });

    render(<WorkspacePage />);
    const trigger = screen.getByRole("button", { name: /workspace theme/i });
    // aria-label should contain "light" and "GitHub"
    expect(trigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("light"),
    );
    expect(trigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("GitHub"),
    );
  });

  // Reason: Phase 14 AC-161-04 — 회귀 테스트: ThemePicker 추가 후에도 기존 기능 정상 동작 (2026-04-28)
  it("still renders Back button and Sidebar/MainArea after adding ThemePicker", () => {
    render(<WorkspacePage />);
    expect(
      screen.getByRole("button", { name: /back to connections/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
    expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
  });

  // -- Re-hydration from session storage on window focus --

  // Reason: verify that the workspace re-hydrates connection state from session
  // storage on mount and when the window gains focus. This fixes the cross-
  // window state sync race where the workspace's boot-time hydration reads
  // empty data because the launcher hasn't connected yet. (2026-04-29)
  it("calls hydrateFromSession on mount", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    spy.mockClear();
    render(<WorkspacePage />);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("calls hydrateFromSession when the window gains focus", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    render(<WorkspacePage />);
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // --- #1134: landmark + heading a11y (Sidebar/MainArea are mocked here, so
  // the <nav> + <h1> asserted below come from WorkspacePage's own shell) ---

  it("exposes the sidebar column as a <nav> landmark (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders a top-level <h1> heading for the workspace (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("moves focus to the workspace heading on mount (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });
});

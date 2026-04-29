import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import WorkspacePage from "./WorkspacePage";
import { useTabStore } from "@stores/tabStore";
import { useThemeStore } from "@stores/themeStore";
import { useConnectionStore } from "@stores/connectionStore";
import * as windowControls from "@lib/window-controls";

vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-mock" />,
}));

vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-mock" />,
}));

// Sprint 161 — isolate from the full ThemePicker rendering (72 cards + radix
// portals) so we can assert the trigger contract without visual noise.
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
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
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

function resetStores() {
  useTabStore.setState({ tabs: [], activeTabId: null });
  useThemeStore.setState({
    themeId: "slate",
    mode: "dark",
    resolvedMode: "dark",
  });
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

  it("clicking [← Connections] hides the workspace window and shows the launcher (Sprint 154)", async () => {
    render(<WorkspacePage />);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /back to connections/i }),
      );
    });

    expect(windowControls.hideWindow).toHaveBeenCalledWith("workspace");
    expect(windowControls.showWindow).toHaveBeenCalledWith("launcher");
  });

  it("clicking [← Connections] does NOT clear tabStore (tabs persist across screen swaps)", () => {
    useTabStore.setState({
      tabs: [
        {
          type: "table",
          id: "tab-1",
          title: "users",
          connectionId: "c1",
          closable: true,
          schema: "public",
          table: "users",
          subView: "records",
        },
      ],
      activeTabId: "tab-1",
    });

    render(<WorkspacePage />);
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /back to connections/i }),
      );
    });

    const state = useTabStore.getState();
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
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    render(<WorkspacePage />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls hydrateFromSession when the window gains focus", () => {
    const spy = vi.spyOn(useConnectionStore.getState(), "hydrateFromSession");
    render(<WorkspacePage />);
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

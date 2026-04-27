import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import WorkspacePage from "./WorkspacePage";
import { useTabStore } from "@stores/tabStore";
import * as windowControls from "@lib/window-controls";

vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-mock" />,
}));

vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-mock" />,
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
});

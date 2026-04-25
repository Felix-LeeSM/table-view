import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import WorkspacePage from "./WorkspacePage";
import { useAppShellStore } from "@stores/appShellStore";
import { useTabStore } from "@stores/tabStore";

vi.mock("@components/layout/Sidebar", () => ({
  default: () => <div data-testid="sidebar-mock" />,
}));

vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-mock" />,
}));

function resetStores() {
  useAppShellStore.setState({ screen: "workspace" });
  useTabStore.setState({ tabs: [], activeTabId: null });
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
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

  it("clicking [← Connections] flips the appShell screen to 'home'", () => {
    expect(useAppShellStore.getState().screen).toBe("workspace");
    render(<WorkspacePage />);

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: /back to connections/i }),
      );
    });

    expect(useAppShellStore.getState().screen).toBe("home");
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

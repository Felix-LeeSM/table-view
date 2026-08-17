import * as windowControls from "@lib/window-controls";
import { useConnectionStore } from "@stores/connectionStore";
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
import WorkspaceToolbar from "./WorkspaceToolbar";

/**
 * #2431 — the collapsed workspace no longer keeps a vertical rail beside the
 * hidden sidebar. That rail existed for exactly two controls: the only route
 * back to the launcher and the only theme / language control. Both now live in
 * this toolbar, which nothing about a collapse touches, so these cases assert
 * the reachability the rail used to buy.
 *
 * The `[collapsed-rail]` token in each name is the issue's acceptance marker.
 *
 * Own file rather than cases bolted onto `WorkspaceToolbar.test.tsx`: the
 * appearance popover needs the theme controls stubbed (the real `ThemePicker`
 * paints the whole `THEME_CATALOG`), and `vi.mock` is file-scoped — the
 * neighbouring toolbar specs should keep rendering the real tree.
 */

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

vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

vi.mock("@components/theme/LanguageSwitcher", () => ({
  default: () => <div data-testid="language-switcher-mock" />,
}));

describe("WorkspaceToolbar — controls the collapsed rail used to hold (#2431)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    useThemeStore.setState({
      themeId: "slate",
      mode: "dark",
      resolvedMode: "dark",
    });
    // The whole point of the issue: this is the state that used to grow a rail.
    useLayoutStore.setState({ sidebarCollapsed: true });
  });

  it("[collapsed-rail] keeps the route back to the launcher reachable while the sidebar is collapsed", async () => {
    render(<WorkspaceToolbar />);

    const back = screen.getByRole("button", {
      name: /^back to connections$/i,
    });
    expect(back).toBeVisible();

    await act(async () => {
      fireEvent.click(back);
    });

    // Back ≠ Disconnect: focus the launcher, then destroy this window. The
    // pool survives, so the assertion is on the window seam only.
    expect(windowControls.focusWindow).toHaveBeenCalledWith("launcher");
    expect(windowControls.destroyCurrentWindow).toHaveBeenCalled();
    const focusOrder = vi.mocked(windowControls.focusWindow).mock
      .invocationCallOrder[0]!;
    const destroyOrder = vi.mocked(windowControls.destroyCurrentWindow).mock
      .invocationCallOrder[0]!;
    expect(focusOrder).toBeLessThan(destroyOrder);
  });

  // Moved from `WorkspacePage.test.tsx` with the button (#2431). Back swaps
  // the screen; it must not take the user's open tabs with it.
  it("back to connections does NOT clear the workspace's tabs", async () => {
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

    render(<WorkspaceToolbar />);
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: /^back to connections$/i }),
      );
    });

    // seedWorkspace auto-derives connId from `firstTab.connectionId` ("c1").
    const state = getTestWorkspace("c1", "db1");
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.id).toBe("tab-1");
    expect(state.activeTabId).toBe("tab-1");
  });

  it("[collapsed-rail] keeps theme and language reachable while the sidebar is collapsed", async () => {
    render(<WorkspaceToolbar />);

    const trigger = screen.getByRole("button", { name: /workspace theme/i });
    expect(trigger).toBeVisible();

    await act(async () => {
      fireEvent.click(trigger);
    });

    expect(screen.getByTestId("theme-picker-mock")).toBeInTheDocument();
    expect(screen.getByTestId("language-switcher-mock")).toBeInTheDocument();
  });

  it("[collapsed-rail] both controls stay reachable when the sidebar is expanded too", () => {
    act(() => {
      useLayoutStore.setState({ sidebarCollapsed: false });
    });
    render(<WorkspaceToolbar />);

    expect(
      screen.getByRole("button", { name: /^back to connections$/i }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /workspace theme/i }),
    ).toBeVisible();
  });

  // The appearance trigger reports the active theme and mode, which is the
  // only reason it is not a bare icon like its neighbours.
  it("appearance trigger names the active theme and mode", () => {
    useThemeStore.setState({
      themeId: "github",
      mode: "light",
      resolvedMode: "light",
    });
    render(<WorkspaceToolbar />);

    const trigger = screen.getByRole("button", { name: /workspace theme/i });
    expect(trigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("light"),
    );
    expect(trigger).toHaveAttribute(
      "aria-label",
      expect.stringContaining("GitHub"),
    );
  });

  // Roving tabindex (#2431 decision): the two new controls are plain buttons,
  // so `useToolbarRoving` folds them into the single tab stop with no wiring.
  // A control that opted out — a non-button focusable, or a stray `tabIndex`
  // — would show up here as a second tab stop.
  it("[collapsed-rail] the new controls join the toolbar's single tab stop", () => {
    render(<WorkspaceToolbar />);

    const toolbar = screen.getByRole("toolbar", { name: /workspace toolbar/i });
    const enabled = Array.from(toolbar.querySelectorAll("button")).filter(
      (b) => !b.disabled,
    );
    const back = screen.getByRole("button", {
      name: /^back to connections$/i,
    });
    const appearance = screen.getByRole("button", {
      name: /workspace theme/i,
    });

    expect(enabled).toContain(back);
    expect(enabled).toContain(appearance);
    expect(enabled.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    expect(back).toHaveAttribute("tabindex", "-1");
    expect(appearance).toHaveAttribute("tabindex", "-1");
  });
});

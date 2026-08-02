import { useConnectionStore } from "@stores/connectionStore";
import { useLayoutStore } from "@stores/layoutStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import WorkspaceToolbar from "./WorkspaceToolbar";

/**
 * Issue #1734 owner decision 1 — the workspace toolbar's Layout cluster.
 *
 * Contract under test:
 *   - it is a `role="group"` with an accessible name,
 *   - it holds the panel toggles (left panel + the bottom flyouts),
 *   - every toggle exposes `aria-pressed` reflecting the live panel state,
 *   - the cluster is nested inside `role="toolbar"` without breaking the
 *     toolbar's single tab stop — the toggles stay keyboard reachable.
 *
 * With no active connection the DbSwitcher renders a read-only
 * `<span role="button">`, Disconnect is disabled, and `OperationsButton`
 * returns null (no `operations.*` capability), so the cluster's enabled
 * buttons are Sidebar + History.
 */
function cluster(): HTMLElement {
  return screen.getByRole("group", { name: /layout panels/i });
}

describe("WorkspaceToolbar — Layout cluster (#1734)", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
    useLayoutStore.setState({
      sidebarCollapsed: false,
      globalLogVisible: false,
      operationsVisible: false,
    });
  });

  it("renders a role=group cluster inside the toolbar", () => {
    render(<WorkspaceToolbar />);
    const toolbar = screen.getByRole("toolbar", {
      name: /workspace toolbar/i,
    });
    expect(toolbar).toContainElement(cluster());
  });

  it("holds the panel toggles — sidebar and the bottom query-log flyout", () => {
    render(<WorkspaceToolbar />);
    const group = cluster();
    expect(
      within(group).getByRole("button", { name: /toggle the sidebar panel/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: /toggle query history/i }),
    ).toBeInTheDocument();
  });

  it("sidebar toggle starts pressed (panel shown) and flips the store on click", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const toggle = screen.getByRole("button", {
      name: /toggle the sidebar panel/i,
    });

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);

    await user.click(toggle);

    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    await user.click(toggle);

    expect(useLayoutStore.getState().sidebarCollapsed).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("bottom-panel toggle reflects the flyout's open state via aria-pressed", () => {
    render(<WorkspaceToolbar />);
    const history = () =>
      screen.getByRole("button", { name: /toggle query history/i });
    expect(history()).toHaveAttribute("aria-pressed", "false");

    // The panel opens through the custom-event channel MainArea listens on;
    // the store is the state both ends share.
    act(() => {
      useLayoutStore.setState({ globalLogVisible: true });
    });

    expect(history()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the toolbar a single tab stop and reaches the cluster toggles by keyboard", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const toolbar = screen.getByRole("toolbar", {
      name: /workspace toolbar/i,
    });
    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => !b.disabled);
    const sidebarToggle = screen.getByRole<HTMLButtonElement>("button", {
      name: /toggle the sidebar panel/i,
    });

    // One Tab enters the toolbar; the cluster's nested buttons must not add
    // extra tab stops of their own.
    await user.tab();
    expect(buttons[0]).toHaveFocus();
    for (const b of buttons.slice(1)) {
      expect(b).toHaveAttribute("tabindex", "-1");
    }

    // Arrow keys walk into the cluster and can activate its toggle.
    const steps = buttons.indexOf(sidebarToggle);
    expect(steps).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < steps; i++) await user.keyboard("{ArrowRight}");
    expect(sidebarToggle).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
  });
});

import { useConnectionStore } from "@stores/connectionStore";
import { useLayoutStore } from "@stores/layoutStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import WorkspaceToolbar from "./WorkspaceToolbar";

/**
 * Issue #1734 owner decision 1 — the workspace toolbar's Layout cluster —
 * narrowed by #2426.
 *
 * Contract under test:
 *   - it is a `role="group"` with an accessible name,
 *   - it holds the two panel collapse toggles (left panel + bottom dock) and
 *     nothing else: #2426 took History and Operations out because those open
 *     views rather than collapse panels, and both are dock tabs now,
 *   - every toggle exposes `aria-pressed` reflecting the live panel state,
 *   - the cluster is nested inside `role="toolbar"` without breaking the
 *     toolbar's single tab stop — the toggles stay keyboard reachable.
 *
 * With no active connection the DbSwitcher renders a read-only
 * `<span role="button">` and Disconnect is disabled.
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
    // `layoutStore` itself is reset by the global `beforeEach` in
    // `src/test-setup.ts` (`__resetLayoutStoreForTests`).
  });

  it("renders a role=group cluster inside the toolbar", () => {
    render(<WorkspaceToolbar />);
    const toolbar = screen.getByRole("toolbar", {
      name: /workspace toolbar/i,
    });
    expect(toolbar).toContainElement(cluster());
  });

  it("[bottom-panel] holds exactly the two panel collapse toggles", () => {
    render(<WorkspaceToolbar />);
    const group = cluster();
    expect(
      within(group).getByRole("button", { name: /toggle the schema sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: /toggle the bottom panel/i }),
    ).toBeInTheDocument();
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });

  it("[bottom-panel] the toolbar no longer carries History or Operations buttons", () => {
    render(<WorkspaceToolbar />);
    // Both views moved into the dock's tab strip. Leaving a button here would
    // give the same view two entry points in two different models.
    expect(screen.queryByTestId("workspace-history-toggle")).toBeNull();
    expect(screen.queryByTestId("workspace-operations-toggle")).toBeNull();
    expect(screen.queryByRole("button", { name: /query history/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /server operations/i }),
    ).toBeNull();
  });

  it("[bottom-panel] the cluster leads the toolbar, ahead of the DB switcher", () => {
    render(<WorkspaceToolbar />);
    const toolbar = screen.getByRole("toolbar", {
      name: /workspace toolbar/i,
    });
    // Owner: the bottom toggle sits next to the sidebar toggle at the
    // toolbar's left. Both act on window chrome, so they lead the
    // connection-scoped controls instead of trailing them.
    expect(toolbar.firstElementChild).toBe(cluster());
  });

  it("sidebar toggle starts pressed (panel shown) and flips the store on click", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const toggle = screen.getByRole("button", {
      name: /toggle the schema sidebar/i,
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

  it("[bottom-panel] bottom toggle reflects the dock's collapsed state via aria-pressed", () => {
    render(<WorkspaceToolbar />);
    const toggle = () =>
      screen.getByRole("button", { name: /toggle the bottom panel/i });
    // Starts collapsed, so the toggle starts unpressed.
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    // The dock's own strip button writes the same field — this button has to
    // follow it without holding a copy.
    act(() => {
      useLayoutStore.getState().setBottomPanelCollapsed(false);
    });

    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the toolbar a single tab stop even though the cluster nests buttons", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const toolbar = screen.getByRole("toolbar", {
      name: /workspace toolbar/i,
    });
    const buttons = Array.from(
      toolbar.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((b) => !b.disabled);
    expect(buttons.length).toBeGreaterThan(2);

    await user.tab();
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  /**
   * The nesting hazard, pinned at concrete positions. `useToolbarRoving`
   * enumerates `<button>` **descendants** of the toolbar; if it ever stopped
   * descending into `role="group"`, the cluster's toggles would drop out of
   * the roving order entirely.
   *
   * The expected order is written out by accessible name instead of being
   * read back from the same `querySelectorAll("button")` the hook uses —
   * otherwise the implementation would be defining its own expectation and
   * any traversal order would pass.
   */
  it("[bottom-panel] puts the cluster's nested toggles at the head of the roving order", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const byName = (name: RegExp) =>
      screen.getByRole<HTMLButtonElement>("button", { name });
    const sidebarToggle = byName(/toggle the schema sidebar/i);
    const bottomToggle = byName(/toggle the bottom panel/i);
    const rowCap = byName(/query row cap/i);

    // Tab lands on the cluster's FIRST nested button — reachable only if the
    // hook descends past `role="group"`.
    await user.tab();
    expect(sidebarToggle).toHaveFocus();
    expect(sidebarToggle).toHaveAttribute("tabindex", "0");

    // One ArrowRight moves to the cluster's second nested button, a second
    // one leaves the cluster for the next toolbar control.
    await user.keyboard("{ArrowRight}");
    expect(bottomToggle).toHaveFocus();
    expect(sidebarToggle).toHaveAttribute("tabindex", "-1");

    // The DbSwitcher between the cluster and RowCapSetting is a read-only
    // `<span role="button">` without a connection, so the next real button
    // the roving order reaches is the row cap.
    await user.keyboard("{ArrowRight}");
    expect(rowCap).toHaveFocus();

    // Home walks back into the cluster and Enter activates the toggle.
    await user.keyboard("{Home}");
    expect(sidebarToggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
  });
});

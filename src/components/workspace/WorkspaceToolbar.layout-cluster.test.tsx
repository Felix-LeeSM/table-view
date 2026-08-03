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

  it("holds the panel toggles — sidebar and the bottom query-log flyout", () => {
    render(<WorkspaceToolbar />);
    const group = cluster();
    expect(
      within(group).getByRole("button", { name: /toggle the schema sidebar/i }),
    ).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: /toggle query history/i }),
    ).toBeInTheDocument();
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
  it("puts the cluster's nested toggles at the head of the roving order", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const byName = (name: RegExp) =>
      screen.getByRole<HTMLButtonElement>("button", { name });
    const sidebarToggle = byName(/toggle the schema sidebar/i);
    const historyToggle = byName(/toggle query history/i);
    const rowCap = byName(/query row cap/i);

    // Tab lands on the cluster's FIRST nested button — reachable only if the
    // hook descends past `role="group"`.
    await user.tab();
    expect(sidebarToggle).toHaveFocus();
    expect(sidebarToggle).toHaveAttribute("tabindex", "0");

    // One ArrowRight moves to the cluster's second nested button, a second
    // one leaves the cluster for the next toolbar control.
    await user.keyboard("{ArrowRight}");
    expect(historyToggle).toHaveFocus();
    expect(sidebarToggle).toHaveAttribute("tabindex", "-1");

    await user.keyboard("{ArrowRight}");
    expect(rowCap).toHaveFocus();

    // Home walks back into the cluster and Enter activates the toggle.
    await user.keyboard("{Home}");
    expect(sidebarToggle).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(useLayoutStore.getState().sidebarCollapsed).toBe(true);
  });
});

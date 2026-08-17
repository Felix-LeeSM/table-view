import { useConnectionStore } from "@stores/connectionStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import WorkspaceToolbar from "./WorkspaceToolbar";

// Enabled `<button>` controls of the toolbar, in DOM order. With no active
// connection the DbSwitcher renders a read-only `<span role="button">` (not a
// real button) and Disconnect is disabled, so the roving set is the always-on
// ones: the Layout cluster's two panel toggles (#1734, first in DOM order),
// then RowCap, SafeMode, Appearance and Back (#2431). `useToolbarRoving`
// reaches the cluster's pair through its `role="group"` wrapper — the
// concrete traversal positions are pinned in
// `WorkspaceToolbar.layout-cluster.test.tsx`, and the two #2431 controls are
// pinned in `WorkspaceToolbar.collapsed-rail.test.tsx`.
//
// The cases below read the set at runtime rather than hard-coding it, so a
// control joining or leaving the toolbar does not need this list edited —
// the list is here to say what the wrapping cases are actually wrapping over.
function toolbarButtons(): HTMLButtonElement[] {
  const toolbar = screen.getByRole("toolbar", { name: /workspace toolbar/i });
  return Array.from(toolbar.querySelectorAll("button")).filter(
    (b) => !b.disabled,
  );
}

describe("WorkspaceToolbar roving tabindex", () => {
  beforeEach(() => {
    useWorkspaceStore.setState({ workspaces: {} });
    useConnectionStore.setState({
      connections: [],
      activeStatuses: {},
      focusedConnId: null,
    });
  });

  it("keeps a single tab stop — only the first control is tabbable", () => {
    render(<WorkspaceToolbar />);
    const [first, ...rest] = toolbarButtons();
    expect(first).toHaveAttribute("tabindex", "0");
    for (const b of rest) expect(b).toHaveAttribute("tabindex", "-1");
  });

  it("Tab lands on the first control, not every button", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const [first] = toolbarButtons();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("ArrowRight / ArrowLeft move focus across controls and wrap", async () => {
    const user = userEvent.setup();
    render(<WorkspaceToolbar />);
    const buttons = toolbarButtons();
    const last = buttons.length - 1;

    await user.tab();
    expect(buttons[0]).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(buttons[1]).toHaveFocus();
    expect(buttons[1]).toHaveAttribute("tabindex", "0");
    expect(buttons[0]).toHaveAttribute("tabindex", "-1");

    // Wrap forward from the last control back to the first.
    await user.keyboard("{End}");
    expect(buttons[last]).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(buttons[0]).toHaveFocus();

    // Wrap backward from the first control to the last.
    await user.keyboard("{ArrowLeft}");
    expect(buttons[last]).toHaveFocus();

    await user.keyboard("{Home}");
    expect(buttons[0]).toHaveFocus();
  });
});

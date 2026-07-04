import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import BsonTreeViewer from "./BsonTreeViewer";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for the recursive BSON
 * document viewer (#1128). One treeitem holds `tabIndex=0`; arrow keys drive
 * focus and expand/collapse. Mirrors DocumentDatabaseTree.roving.test.tsx.
 */

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

// Default expansion: containers at depth <= 1 are expanded, depth >= 2
// collapsed. For `{ user: { name, roles: [..] } }`: `$` (d0) and `user` (d1)
// are open, so `name` and `roles` render; `roles` (d2 container) stays closed.
function renderTree() {
  render(<BsonTreeViewer value={{ user: { name: "x", roles: ["a"] } }} />);
  return screen.getByRole("tree", { name: "BSON document tree" });
}

describe("BsonTreeViewer roving tabindex", () => {
  it("puts exactly one treeitem in the tab order initially (root)", () => {
    const tree = renderTree();
    const items = within(tree).getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAttribute("aria-label", "$ node");
  });

  it("ArrowDown moves focus + tabIndex to the next row", async () => {
    const tree = renderTree();
    const root = screen.getByRole("treeitem", { name: "$ node" });
    act(() => root.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    const user = screen.getByRole("treeitem", { name: "user node" });
    expect(user).toHaveAttribute("tabindex", "0");
    expect(root).toHaveAttribute("tabindex", "-1");
    expect(user).toHaveFocus();
  });

  it("ArrowRight expands a collapsed row, ArrowLeft collapses it", async () => {
    const tree = renderTree();
    const roles = screen.getByRole("treeitem", { name: "roles node" });
    act(() => roles.focus());
    expect(roles).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await flushRaf();
    expect(roles).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("treeitem", { name: "[0] node" }),
    ).toBeInTheDocument();

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    await flushRaf();
    expect(roles).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("treeitem", { name: "[0] node" }),
    ).not.toBeInTheDocument();
  });

  it("ArrowRight steps into the first child of an expanded row", async () => {
    const tree = renderTree();
    const user = screen.getByRole("treeitem", { name: "user node" });
    act(() => user.focus());
    expect(user).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await flushRaf();

    const name = screen.getByRole("treeitem", { name: "name node" });
    expect(name).toHaveAttribute("tabindex", "0");
    expect(name).toHaveFocus();
  });

  it("Home / End jump to the first / last visible treeitem", async () => {
    const tree = renderTree();
    const root = screen.getByRole("treeitem", { name: "$ node" });
    act(() => root.focus());

    fireEvent.keyDown(tree, { key: "End" });
    await flushRaf();
    const roles = screen.getByRole("treeitem", { name: "roles node" });
    expect(roles).toHaveFocus();

    fireEvent.keyDown(tree, { key: "Home" });
    await flushRaf();
    expect(root).toHaveFocus();
  });
});

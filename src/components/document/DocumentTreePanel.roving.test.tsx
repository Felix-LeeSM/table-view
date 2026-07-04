import { describe, it, expect } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { DocumentTreePanel } from "./DocumentTreePanel";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation for the inline JSON
 * detail panel (#1128). One visible row holds `tabIndex=0`; arrow keys move
 * focus and expand/collapse. Enter opens a leaf's inline editor. The roving
 * handler ignores INPUT/TEXTAREA targets so editing keystrokes are never
 * hijacked. Mirrors DocumentDatabaseTree.roving.test.tsx.
 */

const VALUE = {
  glossary: {
    title: "example",
    GlossDiv: {
      title: "S",
    },
  },
};

function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

function renderPanel() {
  render(<DocumentTreePanel value={VALUE} fieldName="profile" />);
  return screen.getByTestId("document-tree-list");
}

describe("DocumentTreePanel roving tabindex", () => {
  it("marks the list as role=tree and puts exactly one row in the tab order", () => {
    const tree = renderPanel();
    expect(tree).toHaveAttribute("role", "tree");
    const items = screen.getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toBe(screen.getByTestId("tree-node-__root"));
  });

  it("ArrowDown moves focus + tabIndex to the next visible row", async () => {
    const tree = renderPanel();
    const root = screen.getByTestId("tree-node-__root");
    act(() => root.focus());

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    const glossary = screen.getByTestId("tree-node-glossary");
    expect(glossary).toHaveAttribute("tabindex", "0");
    expect(root).toHaveAttribute("tabindex", "-1");
    expect(glossary).toHaveFocus();
  });

  it("ArrowLeft collapses an expanded container, ArrowRight re-expands", async () => {
    const tree = renderPanel();
    const glossary = screen.getByTestId("tree-node-glossary");
    act(() => glossary.focus());
    expect(glossary).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv"),
    ).toBeInTheDocument();

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    await flushRaf();
    expect(glossary).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("tree-node-glossary.GlossDiv"),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(tree, { key: "ArrowRight" });
    await flushRaf();
    expect(glossary).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv"),
    ).toBeInTheDocument();
  });

  it("Enter on a leaf row opens its inline editor", async () => {
    renderPanel();
    const leaf = screen.getByTestId("tree-node-glossary.title");
    act(() => leaf.focus());

    fireEvent.keyDown(leaf, { key: "Enter" });
    await flushRaf();

    expect(screen.getByTestId("tree-edit-glossary.title")).toBeInTheDocument();
  });
});

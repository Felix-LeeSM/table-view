// Sprint 341 (2026-05-15) — DocumentTreePanel V1.
// Locks the public contract NestedExpandPopover used to satisfy so the
// grid-level commit flow keeps working unchanged: value / fieldName /
// pendingByPath / onCommitEdit. Plus the new toggles + search + edit
// behavior that the inline tree introduces.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { DocumentTreePanel } from "./DocumentTreePanel";

const VALUE = {
  glossary: {
    title: "example",
    GlossDiv: {
      title: "S",
      GlossList: {
        GlossEntry: {
          ID: "SGML",
          GlossDef: {
            GlossSeeAlso: ["GML", "XML"],
          },
        },
      },
    },
  },
};

describe("DocumentTreePanel", () => {
  it("renders stats and a collapsible root node", () => {
    render(<DocumentTreePanel value={VALUE} fieldName="profile" />);
    const stats = screen.getByTestId("document-tree-stats");
    expect(stats.textContent).toMatch(/NODES/);
    expect(within(stats).getByText("12")).toBeInTheDocument(); // total nodes
    expect(screen.getByTestId("tree-node-__root")).toBeInTheDocument();
    expect(screen.getByTestId("tree-node-glossary")).toBeInTheDocument();
  });

  it("hides descendants when an ancestor is collapsed", async () => {
    const user = userEvent.setup();
    render(<DocumentTreePanel value={VALUE} fieldName="profile" />);
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv"),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId("tree-twist-glossary"));
    expect(
      screen.queryByTestId("tree-node-glossary.GlossDiv"),
    ).not.toBeInTheDocument();
  });

  it("filters by leaf value substring and keeps ancestors visible", async () => {
    const user = userEvent.setup();
    render(<DocumentTreePanel value={VALUE} fieldName="profile" />);
    await user.type(screen.getByTestId("document-tree-search"), "SGML");
    // ancestor chain must remain — root, glossary, GlossDiv, GlossList,
    // GlossEntry, ID — so the editor can locate the match in context.
    expect(screen.getByTestId("tree-node-__root")).toBeInTheDocument();
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv.GlossList.GlossEntry.ID"),
    ).toBeInTheDocument();
    // unrelated leaf (the "example" title) should be filtered out.
    expect(
      screen.queryByTestId("tree-node-glossary.title"),
    ).not.toBeInTheDocument();
  });

  it("commits a leaf edit through onCommitEdit (strings without quotes)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(
      screen.getByTestId("tree-leaf-glossary.GlossDiv.GlossList.GlossEntry.ID"),
    );
    const input = screen.getByTestId(
      "tree-edit-glossary.GlossDiv.GlossList.GlossEntry.ID",
    );
    await user.clear(input);
    await user.type(input, '"SGML-v2"');
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith(
      "glossary.GlossDiv.GlossList.GlossEntry.ID",
      "SGML-v2",
    );
  });

  it("shows the pending pill + amber leaf when pendingByPath has matching entry", () => {
    const pending = new Map<string, string>([
      ["glossary.GlossDiv.GlossList.GlossEntry.ID", "SGML-v2"],
    ]);
    render(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        pendingByPath={pending}
      />,
    );
    expect(
      screen.getByTestId("document-tree-pending-pill").textContent,
    ).toMatch(/1 unsaved edit/);
    const leaf = screen.getByTestId(
      "tree-leaf-glossary.GlossDiv.GlossList.GlossEntry.ID",
    );
    expect(leaf.textContent).toBe("SGML-v2");
  });

  // Sprint 341 feedback (1) — Enter on an unchanged value must NOT fire
  // onCommitEdit, otherwise a stray click+blur on a leaf creates a
  // phantom pendingEdit. 작성 이유 (2026-05-15): 사용자가 클릭만 하고
  // 같은 값으로 Enter 했을 때 mqlGenerator 가 빈 $set 을 만들어 update
  // 가 silently 실행되던 회귀.
  it("no-op commit (draft equals rendered value) skips onCommitEdit", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(
      screen.getByTestId("tree-leaf-glossary.GlossDiv.GlossList.GlossEntry.ID"),
    );
    // input already contains "SGML" (with quotes — the rendered form).
    // Pressing Enter without editing should commit nothing.
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
  });

  it("escape cancels the edit without committing", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(
      screen.getByTestId("tree-leaf-glossary.GlossDiv.GlossList.GlossEntry.ID"),
    );
    await user.keyboard("nope{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(
        "tree-edit-glossary.GlossDiv.GlossList.GlossEntry.ID",
      ),
    ).not.toBeInTheDocument();
  });

  it("BSON wrapper leaves are read-only (no edit input)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ _id: '__bson__:{"$oid":"6679abcdcdef012345678901"}' }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    const btn = screen.getByTestId("tree-leaf-_id");
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(screen.queryByTestId("tree-edit-_id")).not.toBeInTheDocument();
  });

  it("close button fires onClose", async () => {
    const user = userEvent.setup();
    const close = vi.fn();
    render(
      <DocumentTreePanel value={VALUE} fieldName="profile" onClose={close} />,
    );
    await user.click(screen.getByTestId("document-tree-close"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

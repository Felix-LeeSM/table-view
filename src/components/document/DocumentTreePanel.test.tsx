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

  // Sprint 342 V2 (2026-05-15) — BSON wrappers now open the type-aware
  // BsonTypeEditor instead of being read-only. Commits are normalized
  // back to a __bson__: wrapper at the grid layer (tagBsonWrapper round-
  // trip) so pendingEdits Map shape doesn't change. 작성 이유: Sprint 341
  // V1 은 BSON 을 잠금 처리해서 ObjectId/Date 등을 inline 수정하지 못했고,
  // 사용자가 별도 cell 단위 BSON editor 로 돌아가야 했다.
  it("BSON wrapper leaves open BsonTypeEditor and commit EJSON wrappers", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ _id: '__bson__:{"$oid":"6679abcdcdef012345678901"}' }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-leaf-_id"));
    expect(screen.getByTestId("tree-edit-bson-_id")).toBeInTheDocument();
    const input = screen.getByLabelText(/Editing _id \(objectId\)/);
    await user.clear(input);
    await user.type(input, "6679abcdcdef012345678902");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("_id", {
      $oid: "6679abcdcdef012345678902",
    });
  });

  // Sprint 342 V2 (2026-05-15) — structural edit: leaf delete. Trash icon
  // commits a `__op__:unset` sentinel against the leaf path; the grid-
  // level commit bar then routes it through mqlGenerator into a `$unset`
  // operator. 작성 이유: 사용자가 legacy field 를 별도 dialog 로 가지 않고
  // tree 안에서 바로 mark-for-delete 할 수 있어야 했다.
  it("trash icon commits __op__:unset and renders strike + 'will delete' badge", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    const pending = new Map<string, string>([
      ["glossary.title", "__op__:unset"],
    ]);
    const { rerender } = render(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    // pre-click: trash exists, no strike marker.
    expect(
      screen.queryByTestId("tree-unset-glossary.title"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByTestId("tree-delete-glossary.title"));
    expect(commit).toHaveBeenCalledWith("glossary.title", "__op__:unset");

    // Re-render with the pending map populated — the leaf must switch
    // to the strike-through display.
    rerender(
      <DocumentTreePanel
        value={VALUE}
        fieldName="profile"
        onCommitEdit={commit}
        pendingByPath={pending}
      />,
    );
    expect(screen.getByTestId("tree-unset-glossary.title")).toBeInTheDocument();
    expect(screen.getByText(/will delete/)).toBeInTheDocument();
    // Trash button disappears once the leaf is already marked.
    expect(
      screen.queryByTestId("tree-delete-glossary.title"),
    ).not.toBeInTheDocument();
  });

  // Sprint 342 V2 (2026-05-15) — `_id` MUST NOT have a trash button.
  // MongoDB rejects $unset on _id and mqlGenerator's id-in-patch guard
  // would drop the whole row; surfacing a non-functional trash icon would
  // be a UX trap.
  it("does not render trash for _id leaves", () => {
    render(
      <DocumentTreePanel
        value={{ _id: "abc", name: "Felix" }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("tree-delete-_id")).not.toBeInTheDocument();
    // sanity: non-_id leaves still get the trash.
    expect(screen.getByTestId("tree-delete-name")).toBeInTheDocument();
  });

  // Sprint 342 V2 (2026-05-15) — regex toggle promotes the search box to
  // JS-regex mode. Locking the wire-up so a future refactor of the
  // visiblePaths memo can't silently drop the option.
  it("regex toggle switches the search to JS regex matching", async () => {
    const user = userEvent.setup();
    render(<DocumentTreePanel value={VALUE} fieldName="profile" />);
    await user.click(screen.getByTestId("document-tree-regex-toggle"));
    await user.type(
      screen.getByTestId("document-tree-search"),
      "^Gloss(List|Entry)$",
    );
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv.GlossList"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("tree-node-glossary.GlossDiv.GlossList.GlossEntry"),
    ).toBeInTheDocument();
    // `title` should NOT match the regex.
    expect(
      screen.queryByTestId("tree-node-glossary.title"),
    ).not.toBeInTheDocument();
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

// Sprint 341 (2026-05-15) — DocumentTreePanel V1.
// Locks the public contract NestedExpandPopover used to satisfy so the
// grid-level commit flow keeps working unchanged: value / fieldName /
// pendingByPath / onCommitEdit. Plus the new toggles + search + edit
// behavior that the inline tree introduces.

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
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

  // #1445 / #1448 — hostile/deeply-nested + oversized server data is capped in
  // jsonTree (depth 200 / 50k nodes) and, above the virtualization threshold,
  // windowed by the panel so a huge cell never mounts every row. Both the
  // windowing and the "…truncated" marker are covered in
  // DocumentTreePanel.virtualization.test.tsx (jsdom needs a viewport mock for
  // the virtualizer to mount any rows).

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

  // Sprint 344 Slice A (2026-05-15) — ghost rendering: a path that
  // exists only in `pendingByPath` must render as a visible leaf with
  // a "NEW" badge that is distinct from the existing "● edited" badge.
  // Without this, the `+ key` / `+ item` affordances arriving in Slices
  // B/C have no on-screen feedback — committed adds would silently
  // vanish until Save.
  it("renders a root-level ghost path with a NEW badge", () => {
    const pending = new Map<string, string>([["tag", "alpha"]]);
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        pendingByPath={pending}
        onCommitEdit={vi.fn()}
      />,
    );
    // both existing key and ghost key visible.
    expect(screen.getByTestId("tree-node-name")).toBeInTheDocument();
    const ghost = screen.getByTestId("tree-node-tag");
    expect(ghost).toBeInTheDocument();
    expect(within(ghost).getByText("NEW")).toBeInTheDocument();
    // the "● edited" badge MUST NOT appear on a ghost (it's an add,
    // not an edit). Locks the visual distinction users rely on.
    expect(within(ghost).queryByText(/edited/)).not.toBeInTheDocument();
  });

  // Sprint 344 Slice A (2026-05-15) — edit + add coexist on the same
  // parent. A pending entry on an existing path renders the amber edit
  // badge; a pending entry on a new path renders the NEW badge. No
  // de-duplication mistake collapses them.
  it("renders both an edit on existing-key and a NEW ghost together", () => {
    const pending = new Map<string, string>([
      ["name", "Bob"],
      ["tag", "alpha"],
    ]);
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        pendingByPath={pending}
        onCommitEdit={vi.fn()}
      />,
    );
    const edit = screen.getByTestId("tree-node-name");
    expect(within(edit).getByText(/edited/)).toBeInTheDocument();
    expect(within(edit).queryByText("NEW")).not.toBeInTheDocument();
    const ghost = screen.getByTestId("tree-node-tag");
    expect(within(ghost).getByText("NEW")).toBeInTheDocument();
  });

  // Sprint 344 Slice A (2026-05-15) — nested JSON-parseable ghost value
  // expands into a visible subtree. Locks the integration between the
  // panel and `buildTreeNodesWithGhosts` for the expand branch.
  it("expands a JSON-parseable ghost into nested ghost rows", () => {
    const pending = new Map<string, string>([["meta", '{"role":"owner"}']]);
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        pendingByPath={pending}
        onCommitEdit={vi.fn()}
      />,
    );
    expect(screen.getByTestId("tree-node-meta")).toBeInTheDocument();
    const inner = screen.getByTestId("tree-node-meta.role");
    expect(inner).toBeInTheDocument();
    expect(within(inner).getByText("NEW")).toBeInTheDocument();
    // The inner leaf renders the parsed value ("owner"), not the raw
    // JSON string. Without this the panel would treat the ghost as a
    // plain string leaf.
    expect(inner.textContent).toMatch(/owner/);
  });

  // Sprint 344 Slice A (2026-05-15) — parse-fail fallback: the ghost
  // stays a single string leaf, no nested children. No crash.
  it("renders a non-JSON ghost value as a plain string leaf", () => {
    const pending = new Map<string, string>([["raw", "not-json {"]]);
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        pendingByPath={pending}
        onCommitEdit={vi.fn()}
      />,
    );
    const raw = screen.getByTestId("tree-node-raw");
    expect(raw).toBeInTheDocument();
    expect(within(raw).getByText("NEW")).toBeInTheDocument();
    expect(raw.textContent).toMatch(/not-json/);
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

  // -----------------------------------------------------------------
  // Sprint 344 Slice B — `+ key` inline pair input on object nodes.
  // AC-344-B-01 ~ 11. Each new test below carries its reason + the
  // sprint date `2026-05-15` per the team convention.
  // -----------------------------------------------------------------

  // AC-344-B-01 (2026-05-15) — the `+ key` affordance must appear on
  // every object node (root + nested) only when `onCommitEdit` is
  // provided. Without onCommitEdit the panel is effectively read-only
  // and the affordance must NOT render.
  it("AC-344-B-01: renders `+ key` affordance on object nodes only when onCommitEdit is provided", () => {
    const { rerender } = render(
      <DocumentTreePanel
        value={{ a: 1, nested: { b: 2 } }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    // Root object → button targets the root (empty path → "__root").
    expect(screen.getByTestId("tree-add-key-__root")).toBeInTheDocument();
    // Nested object also gets one.
    expect(screen.getByTestId("tree-add-key-nested")).toBeInTheDocument();

    // Read-only mode (no onCommitEdit) → affordance hidden.
    rerender(
      <DocumentTreePanel
        value={{ a: 1, nested: { b: 2 } }}
        fieldName="profile"
      />,
    );
    expect(screen.queryByTestId("tree-add-key-__root")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tree-add-key-nested")).not.toBeInTheDocument();
  });

  // AC-344-B-02 (2026-05-15) — clicking `+ key` reveals the paired
  // inputs and the key input must be focused first so the user can
  // start typing immediately.
  it("AC-344-B-02: clicking `+ key` reveals key + value inputs, key focused", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    const valueInput = screen.getByTestId("tree-add-value-input-__root");
    expect(keyInput).toBeInTheDocument();
    expect(valueInput).toBeInTheDocument();
    expect(keyInput).toHaveFocus();
    expect((keyInput as HTMLInputElement).placeholder).toMatch(/key/i);
    expect((valueInput as HTMLInputElement).placeholder).toMatch(/value/i);
  });

  // AC-344-B-03 (2026-05-15) — Tab from key input moves focus to value
  // input; Shift+Tab from value input goes back. Locks the keyboard
  // flow so the user never has to grab the mouse to commit a pair.
  it("AC-344-B-03: Tab moves key→value, Shift+Tab moves value→key", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    const valueInput = screen.getByTestId("tree-add-value-input-__root");
    expect(keyInput).toHaveFocus();
    await user.tab();
    expect(valueInput).toHaveFocus();
    await user.tab({ shift: true });
    expect(keyInput).toHaveFocus();
  });

  // AC-344-B-04 (2026-05-15) — Enter from key OR value input commits
  // exactly once. Path = parentPath joined with the typed key (root =
  // bare key). Value = the Slice D coerced JSON value.
  it("AC-344-B-04: Enter from key or value input commits exactly once with coerced value", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "age");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "42");
    await user.keyboard("{Enter}");
    // path = bare key (root parent), value = coerced number 42.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("age", 42);
  });

  // AC-344-B-05 (2026-05-15) — Esc closes the input pair and does NOT
  // commit. After Esc the `+ key` affordance is visible again so the
  // user can retry.
  it("AC-344-B-05: Esc closes the inputs without committing", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(
      screen.getByTestId("tree-add-key-input-__root"),
      "discarded",
    );
    await user.keyboard("{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("tree-add-key-input-__root"),
    ).not.toBeInTheDocument();
    // `+ key` affordance re-renders.
    expect(screen.getByTestId("tree-add-key-__root")).toBeInTheDocument();
  });

  // AC-344-B-06 (2026-05-15) — empty key + Enter must NOT commit. The
  // inputs surface `aria-invalid` and an inline validation message
  // (aria-live polite for screen readers).
  it("AC-344-B-06: empty key + Enter blocks commit and surfaces aria-invalid", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    // Empty key, even with a value typed → reject.
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "x");
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/key required/i)).toBeInTheDocument();
  });

  // AC-344-B-07 (2026-05-15) — duplicate key collision against `value`
  // OR `pendingByPath` blocks commit. The hint message must say "key
  // already exists" so the user knows why the commit didn't fire.
  it("AC-344-B-07a: duplicate key against existing value blocks commit", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "name");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "Bob");
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/key already exists/i)).toBeInTheDocument();
  });

  // AC-344-B-07b (2026-05-15) — duplicate against a path that is only
  // in `pendingByPath` (not yet in `value`) also rejects. Without this
  // the user could fire two `+ key` commits with the same key and the
  // second would silently overwrite the first.
  it("AC-344-B-07b: duplicate key against pendingByPath ghost blocks commit", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    const pending = new Map<string, string>([["tag", "alpha"]]);
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        pendingByPath={pending}
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "tag");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "beta");
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText(/key already exists/i)).toBeInTheDocument();
  });

  // AC-344-B-08 (2026-05-15) — empty VALUE with a non-empty key IS
  // allowed; the user is explicitly adding a key with an empty-string
  // value. Slice D's coerceTreeAddValue returns "" for empty input.
  it("AC-344-B-08: empty value + non-empty key commits with empty string", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "note");
    // value input left empty.
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("note", "");
  });

  // AC-344-B-09 (2026-05-15) — after a successful commit the input
  // pair disappears and the `+ key` affordance re-renders so the user
  // can immediately add another key.
  it("AC-344-B-09: commit closes the inputs and re-renders `+ key`", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "k");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "v");
    await user.keyboard("{Enter}");
    expect(
      screen.queryByTestId("tree-add-key-input-__root"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tree-add-key-__root")).toBeInTheDocument();
  });

  // AC-344-B-10 (2026-05-15) — nested objects get the same affordance.
  // Path is parent-joined (`nested.newKey`).
  it("AC-344-B-10: nested object `+ key` commits the joined path", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ nested: { existing: 1 } }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-nested"));
    await user.type(screen.getByTestId("tree-add-key-input-nested"), "fresh");
    await user.type(screen.getByTestId("tree-add-value-input-nested"), "true");
    await user.keyboard("{Enter}");
    // path = nested.fresh ; value = coerced boolean true.
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("nested.fresh", true);
  });

  // AC-344-B-11 (2026-05-15) — coerce outer-quotes rule. `42` (no
  // quotes) commits as the number 42; `"42"` (with quotes) commits as
  // the string "42". Slice D's `coerceTreeAddValue` is the authority —
  // this test pins the helper's wire-up at the panel boundary.
  it("AC-344-B-11a: bare numeric value commits as number (coerce)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "n");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "42");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("n", 42);
    expect(typeof (commit.mock.calls[0]?.[1] as unknown)).toBe("number");
  });

  it("AC-344-B-11b: quoted numeric value commits as string (coerce)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "s");
    // user.type interprets {} and [] specially — wrap in [[ to escape.
    await user.type(screen.getByTestId("tree-add-value-input-__root"), '"42"');
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("s", "42");
    expect(typeof (commit.mock.calls[0]?.[1] as unknown)).toBe("string");
  });

  // Edge (2026-05-15) — whitespace-only key is rejected (contract
  // treats it as empty). Without trimming, " " would pass as a valid
  // path component and produce un-clickable rows in the tree.
  it("AC-344-B-06 edge: whitespace-only key is treated as empty and rejected", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "   ");
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByText(/key required/i)).toBeInTheDocument();
  });

  // Edge (2026-05-15) — Enter while focused in the VALUE input also
  // commits (mirrors leaf-edit UX where Enter wherever you are inside
  // the editor fires the same commit). Locked separately from AC-04
  // because that case fires Enter via the global keyboard helper,
  // which can fail to specify which input is focused.
  it("AC-344-B-04 edge: Enter from value input also commits", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "foo");
    const valueInput = screen.getByTestId("tree-add-value-input-__root");
    await user.click(valueInput);
    await user.type(valueInput, "bar");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("foo", "bar");
  });

  // Edge (2026-05-15) — unicode + special-char key names. Slice B must
  // not strip or normalise the key beyond a trim; `joinPath` preserves
  // the full UTF-8 string. Spec edge list explicitly calls this out.
  it("AC-344-B-04 edge: unicode key commits intact", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "한국어");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), "value");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("한국어", "value");
  });

  // Edge (2026-05-15) — typing keeps the input pair open and clears
  // the previous validation error so the user can recover from an
  // empty/duplicate reject in the same session.
  it("AC-344-B-06 edge: re-typing after empty-key reject clears the error", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{}}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.keyboard("{Enter}");
    expect(screen.getByText(/key required/i)).toBeInTheDocument();
    // type a key — error message should disappear (aria-invalid lifts).
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "ok");
    expect(screen.queryByText(/key required/i)).not.toBeInTheDocument();
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    expect(keyInput).not.toHaveAttribute("aria-invalid", "true");
  });

  // -----------------------------------------------------------------
  // Sprint 344 Slice C — `+ item` inline value input on array nodes.
  // AC-344-C-01 ~ 10. Each new test below carries its reason + the
  // sprint date `2026-05-15` per the team convention.
  // -----------------------------------------------------------------

  // AC-344-C-01 (2026-05-15) — the `+ item` affordance must appear on
  // every array node only when `onCommitEdit` is provided. Without
  // onCommitEdit the panel is read-only and the affordance must NOT
  // render, mirroring Slice B's `+ key` discipline.
  it("AC-344-C-01: renders `+ item` affordance on array nodes only when onCommitEdit is provided", () => {
    const { rerender } = render(
      <DocumentTreePanel
        value={{ tags: ["a", "b"], meta: { nums: [1, 2, 3] } }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    // Top-level array → button keyed by the array's path ("tags").
    expect(screen.getByTestId("tree-add-item-tags")).toBeInTheDocument();
    // Nested array also gets one.
    expect(screen.getByTestId("tree-add-item-meta.nums")).toBeInTheDocument();
    // Read-only mode → no affordance.
    rerender(
      <DocumentTreePanel
        value={{ tags: ["a", "b"], meta: { nums: [1, 2, 3] } }}
        fieldName="profile"
      />,
    );
    expect(screen.queryByTestId("tree-add-item-tags")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("tree-add-item-meta.nums"),
    ).not.toBeInTheDocument();
  });

  // AC-344-C-02 (2026-05-15) — clicking `+ item` reveals a single value
  // input and an index label `[N]` where N = current array length. The
  // value input is auto-focused so the user can start typing
  // immediately.
  it("AC-344-C-02: clicking `+ item` reveals `[N]` label + value input (auto-focused)", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreePanel
        value={{ tags: ["a", "b"] }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    const valueInput = screen.getByTestId("tree-add-item-input-tags");
    expect(valueInput).toBeInTheDocument();
    expect(valueInput).toHaveFocus();
    // Index label = `[2]` (length=2, next index is 2). The label sits
    // next to the input as a read-only span (see AC-344-C-08).
    const indexLabel = screen.getByTestId("tree-add-item-index-tags");
    expect(indexLabel.textContent).toBe("[2]");
  });

  // AC-344-C-03 (2026-05-15) — Enter commits exactly once. Path uses
  // bracket notation (`tags[2]`), value is Slice D coerced (number `42`
  // not string).
  it("AC-344-C-03: Enter commits exactly once with bracket path and coerced value", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: ["a", "b"] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "42");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("tags[2]", 42);
    expect(typeof (commit.mock.calls[0]?.[1] as unknown)).toBe("number");
  });

  // AC-344-C-04 (2026-05-15) — Esc closes the input and does NOT
  // commit. After Esc the `+ item` affordance is visible again.
  it("AC-344-C-04: Esc closes the input without committing", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: ["a"] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "discard");
    await user.keyboard("{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("tree-add-item-input-tags"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("tree-add-item-tags")).toBeInTheDocument();
  });

  // AC-344-C-05 (2026-05-15) — empty value + Enter IS allowed (user
  // wants to append the string `""`). Slice D's coerceTreeAddValue
  // returns `""` for empty input.
  it("AC-344-C-05: empty value + Enter commits empty string", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: ["a"] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("tags[1]", "");
  });

  // AC-344-C-06 (2026-05-15) — two consecutive `+ item` commits without
  // a save in between produce `[N]` and `[N+1]`. The second click must
  // see the pending append already accounted for so the label advances
  // and both rows render as separate ghosts (Slice A integration).
  it("AC-344-C-06: two consecutive `+ item` commits use sequential indexes", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    // Wrap in a stateful host so pendingByPath updates between the two
    // add cycles — without it the second click would re-derive [1]
    // again (length still 1, no pending appends visible).
    function Host() {
      const [pending, setPending] = useState<Map<string, string>>(
        () => new Map(),
      );
      return (
        <DocumentTreePanel
          value={{ tags: ["a"] }}
          fieldName="profile"
          pendingByPath={pending}
          onCommitEdit={(path, value) => {
            commit(path, value);
            setPending((prev) => {
              const next = new Map(prev);
              next.set(path, typeof value === "string" ? value : "");
              return next;
            });
          }}
        />
      );
    }
    render(<Host />);
    // First add → index [1] (length=1, no prior pending).
    await user.click(screen.getByTestId("tree-add-item-tags"));
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "b");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenNthCalledWith(1, "tags[1]", "b");
    // Second add — affordance back. Index label must now be [2] since
    // the previous pending append at [1] occupies that slot.
    await user.click(screen.getByTestId("tree-add-item-tags"));
    const label = screen.getByTestId("tree-add-item-index-tags");
    expect(label.textContent).toBe("[2]");
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "c");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenNthCalledWith(2, "tags[2]", "c");
    expect(commit).toHaveBeenCalledTimes(2);
  });

  // AC-344-C-07 (2026-05-15) — nested arrays (an array inside an
  // object) get the same affordance and the joined bracket path
  // (`meta.tags[N]`).
  it("AC-344-C-07: nested array `+ item` commits the joined bracket path", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ meta: { tags: ["x"] } }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-meta.tags"));
    await user.type(screen.getByTestId("tree-add-item-input-meta.tags"), "y");
    await user.keyboard("{Enter}");
    // Path = meta.tags[1]. Value = "y" (raw string, not JSON-typed).
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("meta.tags[1]", "y");
  });

  // AC-344-C-08 (2026-05-15) — the index label is a read-only span,
  // NOT an input. Verify it carries no value/onChange surface (text
  // content only) and is not focusable, so accidental clicks or
  // keystrokes inside it cannot mutate the auto-derived index.
  it("AC-344-C-08: index label is a read-only span, not an input", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreePanel
        value={{ tags: ["a", "b"] }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    const label = screen.getByTestId("tree-add-item-index-tags");
    // The label must be a SPAN element — not an INPUT. If a future
    // refactor accidentally swaps it to <input>, this lock catches it.
    expect(label.tagName).toBe("SPAN");
    // Clicking the label MUST NOT steal focus from the value input.
    const valueInput = screen.getByTestId("tree-add-item-input-tags");
    expect(valueInput).toHaveFocus();
    await user.click(label);
    expect(valueInput).toHaveFocus();
  });

  // AC-344-C-09 (2026-05-15) — coerce outer-quotes rule for array
  // values. `42` → number 42; `[1,2]` → array (Slice A then expands
  // the nested ghost subtree). This pins the Slice D wire at the
  // panel boundary just like AC-344-B-11 does for `+ key`.
  it("AC-344-C-09a: bare numeric value commits as number (coerce)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: [] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "42");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("tags[0]", 42);
    expect(typeof (commit.mock.calls[0]?.[1] as unknown)).toBe("number");
  });

  it("AC-344-C-09b: JSON-array value commits as array (coerce)", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: [] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    // userEvent treats `[` as a key-reference opener; doubling it
    // (`[[`) types a literal `[`. `]` alone is not special, so the
    // closing bracket types as-is. The resulting input value is
    // `[1,2]`, which `coerceTreeAddValue` parses as a JSON array.
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "[[1,2]");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    const arg = commit.mock.calls[0]?.[1] as unknown;
    expect(Array.isArray(arg)).toBe(true);
    expect(arg).toEqual([1, 2]);
  });

  // AC-344-C-10 (2026-05-15) — first add on an empty array yields
  // index `[0]`. The current array length is 0, no prior pending
  // appends, so the auto-derived index naturally lands at 0.
  it("AC-344-C-10: first add on an empty array uses index [0]", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ tags: [] }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    const label = screen.getByTestId("tree-add-item-index-tags");
    expect(label.textContent).toBe("[0]");
    await user.type(screen.getByTestId("tree-add-item-input-tags"), "first");
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledWith("tags[0]", "first");
  });

  // Edge (2026-05-15) — opening `+ item` does NOT show a key input
  // (only `+ key` on object nodes shows the key input). Guards
  // against an accidental shared-state bug where the array-add UI
  // accidentally reveals the object-add inputs.
  it("AC-344-C-02 edge: opening `+ item` does not render the key input", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreePanel
        value={{ tags: ["a"] }}
        fieldName="profile"
        onCommitEdit={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId("tree-add-item-tags"));
    // The `+ key` input pair for the root object should NOT appear
    // alongside the `+ item` input.
    expect(
      screen.queryByTestId("tree-add-key-input-__root"),
    ).not.toBeInTheDocument();
    // The `+ item` value input IS present.
    expect(screen.getByTestId("tree-add-item-input-tags")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // Sprint 344 Slice F — paradigm-agnostic `forbiddenRootKeys` guard.
  // The Mongo grid wires `Set(["_id"])`; the RDB grid omits the prop.
  // The panel stays paradigm-agnostic — its only job is to reject the
  // root-level add for keys in the supplied set.
  // -----------------------------------------------------------------

  // AC-344-F-04 (2026-05-15) — without `forbiddenRootKeys`, a root
  // `_id` add commits (paradigm-agnostic default = no reserved keys).
  // Guards against an accidental "always-on" `_id` block bleeding into
  // the RDB grid where `_id` is a legitimate column name.
  it("AC-344-F-04 default: `_id` at root commits when forbiddenRootKeys is absent", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        onCommitEdit={commit}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "_id");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), '"x"');
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("_id", "x");
  });

  // AC-344-F-04 (2026-05-15) — when `forbiddenRootKeys` contains
  // `_id`, a root `_id` add is rejected with aria-invalid + inline
  // message; `onCommitEdit` MUST NOT fire. Mongo grid uses this to
  // prevent `_id` mutations the backend would reject anyway.
  it("AC-344-F-04 reject: root `_id` add is blocked when forbiddenRootKeys contains it", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ name: "Felix" }}
        fieldName="profile"
        onCommitEdit={commit}
        forbiddenRootKeys={new Set(["_id"])}
      />,
    );
    await user.click(screen.getByTestId("tree-add-key-__root"));
    await user.type(screen.getByTestId("tree-add-key-input-__root"), "_id");
    await user.type(screen.getByTestId("tree-add-value-input-__root"), '"x"');
    await user.keyboard("{Enter}");
    expect(commit).not.toHaveBeenCalled();
    const keyInput = screen.getByTestId("tree-add-key-input-__root");
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText(/cannot be added to the document root/i),
    ).toBeInTheDocument();
  });

  // AC-344-F-04 (2026-05-15) — the guard only fires at the document
  // root. A literal `_id` field inside a nested object stays legal
  // because Mongo permits arbitrary keys below the root, and the
  // generator's id-in-patch check only inspects the top-level `_id`.
  // Without this nested escape hatch, `meta._id` would be unreachable
  // through the inline tree.
  it("AC-344-F-04 nested: `_id` inside a nested object commits even when forbiddenRootKeys includes it", async () => {
    const user = userEvent.setup();
    const commit = vi.fn();
    render(
      <DocumentTreePanel
        value={{ meta: { existing: 1 } }}
        fieldName="profile"
        onCommitEdit={commit}
        forbiddenRootKeys={new Set(["_id"])}
      />,
    );
    // Open `+ key` on the nested object, not the root.
    await user.click(screen.getByTestId("tree-add-key-meta"));
    await user.type(screen.getByTestId("tree-add-key-input-meta"), "_id");
    await user.type(screen.getByTestId("tree-add-value-input-meta"), '"abc"');
    await user.keyboard("{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("meta._id", "abc");
  });
});

// Sprint 310 (2026-05-14) — Phase 28 Slice A4 popover behaviour lock.
//
// 검증 대상:
// - 4 section group (Query / Mutation / Operators / Stages) 정확한 순서
//   + aria-label.
// - 항목 클릭 시 snippet engine (mocked) 이 EditorView ref + template
//   으로 호출됨 + popover close + editor focus.
// - 키보드 네비: ArrowDown/ArrowUp (within section), Enter (activate),
//   Esc (close).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";

// Mock the snippet engine so we can spy on insertion without spinning up
// a CodeMirror view inside this RTL suite. Engine itself has its own
// unit-test suite (snippetEngine.test.ts) — here we lock the menu's
// contract with the engine. `vi.hoisted` is required because `vi.mock`
// is hoisted above top-level statements and would otherwise dereference
// the mock before it exists.
const { insertMongoshSnippetMock } = vi.hoisted(() => ({
  insertMongoshSnippetMock: vi.fn(),
}));
vi.mock("@/lib/mongo/snippetEngine", () => ({
  insertMongoshSnippet: insertMongoshSnippetMock,
}));

import InsertSnippetMenu from "./InsertSnippetMenu";
import { ALL_MONGOSH_SNIPPETS } from "@/lib/mongo/mongoshSnippets";
import type { EditorView } from "@codemirror/view";

const mockEditorViewFocus = vi.fn();
const fakeEditorView = {
  focus: mockEditorViewFocus,
} as unknown as EditorView;

function renderMenu() {
  const ref: React.RefObject<EditorView | null> = {
    current: fakeEditorView,
  };
  return render(<InsertSnippetMenu editorRef={ref} />);
}

describe("InsertSnippetMenu — button visibility & open/close", () => {
  beforeEach(() => {
    insertMongoshSnippetMock.mockReset();
    mockEditorViewFocus.mockReset();
  });

  it("renders a `+ Insert ▾` trigger button with the spec aria-label", () => {
    renderMenu();
    const btn = screen.getByRole("button", {
      name: /insert mongosh snippet/i,
    });
    expect(btn).toBeInTheDocument();
  });

  it("opens the popover on click and surfaces 4 section groups in spec order", async () => {
    const user = userEvent.setup();
    renderMenu();
    const btn = screen.getByRole("button", {
      name: /insert mongosh snippet/i,
    });
    await user.click(btn);

    const groups = await screen.findAllByRole("group");
    expect(groups).toHaveLength(4);

    expect(groups[0]).toHaveAttribute("aria-label", "Query methods");
    expect(groups[1]).toHaveAttribute("aria-label", "Mutation methods");
    expect(groups[2]).toHaveAttribute("aria-label", "Operators");
    expect(groups[3]).toHaveAttribute("aria-label", "Stages");
  });

  it("renders every snippet entry as a focusable menuitem button", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );

    const queryGroup = screen.getByRole("group", { name: "Query methods" });
    expect(
      within(queryGroup).getByRole("menuitem", { name: "find" }),
    ).toBeInTheDocument();
    expect(
      within(queryGroup).getByRole("menuitem", { name: "findOne" }),
    ).toBeInTheDocument();
    expect(
      within(queryGroup).getByRole("menuitem", {
        name: "estimatedDocumentCount",
      }),
    ).toBeInTheDocument();

    const mutationGroup = screen.getByRole("group", {
      name: "Mutation methods",
    });
    expect(
      within(mutationGroup).getByRole("menuitem", { name: "bulkWrite" }),
    ).toBeInTheDocument();

    const operatorGroup = screen.getByRole("group", { name: "Operators" });
    // 13 operator entries — Q7 order.
    const operatorEntries = within(operatorGroup).getAllByRole("menuitem");
    expect(operatorEntries.map((e) => e.textContent)).toEqual([
      "$eq",
      "$ne",
      "$gt",
      "$gte",
      "$lt",
      "$lte",
      "$in",
      "$nin",
      "$exists",
      "$regex",
      "$or",
      "$and",
      "$not",
    ]);

    const stagesGroup = screen.getByRole("group", { name: "Stages" });
    const stageEntries = within(stagesGroup).getAllByRole("menuitem");
    expect(stageEntries.length).toBeGreaterThanOrEqual(14);
    const stageLabels = stageEntries.map((e) => e.textContent);
    for (const required of [
      "$match",
      "$project",
      "$group",
      "$sort",
      "$out",
      "$merge",
    ]) {
      expect(stageLabels).toContain(required);
    }
  });
});

describe("InsertSnippetMenu — entry activation", () => {
  beforeEach(() => {
    insertMongoshSnippetMock.mockReset();
    mockEditorViewFocus.mockReset();
  });

  it("clicking an entry calls insertMongoshSnippet with the template + closes popover + refocuses editor", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );

    const findItem = screen.getByRole("menuitem", { name: "find" });
    await user.click(findItem);

    expect(insertMongoshSnippetMock).toHaveBeenCalledTimes(1);
    const querySection = ALL_MONGOSH_SNIPPETS[0];
    if (!querySection) throw new Error("query section missing");
    const findEntry = querySection.entries.find((s) => s.label === "find");
    if (!findEntry) throw new Error("find snippet missing");
    expect(insertMongoshSnippetMock).toHaveBeenCalledWith(
      fakeEditorView,
      findEntry.insertText,
    );

    // Popover closed — no more groups in the DOM.
    expect(screen.queryByRole("group", { name: "Query methods" })).toBeNull();

    // Editor view focused.
    expect(mockEditorViewFocus).toHaveBeenCalledTimes(1);
  });

  it("does not invoke the engine if the editor ref is null (best-effort no-op)", async () => {
    const user = userEvent.setup();
    const ref: React.RefObject<EditorView | null> = { current: null };
    render(<InsertSnippetMenu editorRef={ref} />);

    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );
    const findItem = screen.getByRole("menuitem", { name: "find" });
    await user.click(findItem);

    expect(insertMongoshSnippetMock).not.toHaveBeenCalled();
  });
});

describe("InsertSnippetMenu — keyboard navigation", () => {
  beforeEach(() => {
    insertMongoshSnippetMock.mockReset();
    mockEditorViewFocus.mockReset();
  });

  it("ArrowDown moves focus down within a section, ArrowUp moves up", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );

    const queryGroup = screen.getByRole("group", { name: "Query methods" });
    const items = within(queryGroup).getAllByRole("menuitem");
    const item0 = items[0];
    const item1 = items[1];
    const item2 = items[2];
    if (!item0 || !item1 || !item2) throw new Error("expected ≥3 query items");

    item0.focus();
    expect(document.activeElement).toBe(item0);

    fireEvent.keyDown(item0, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item1);

    fireEvent.keyDown(item1, { key: "ArrowDown" });
    expect(document.activeElement).toBe(item2);

    fireEvent.keyDown(item2, { key: "ArrowUp" });
    expect(document.activeElement).toBe(item1);
  });

  it("Enter on a focused entry activates it (same as click)", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );

    const findItem = screen.getByRole("menuitem", { name: "find" });
    findItem.focus();
    fireEvent.keyDown(findItem, { key: "Enter" });

    expect(insertMongoshSnippetMock).toHaveBeenCalledTimes(1);
    expect(insertMongoshSnippetMock).toHaveBeenCalledWith(
      fakeEditorView,
      expect.stringContaining("db.<collection>.find("),
    );
  });

  it("Escape closes the popover", async () => {
    const user = userEvent.setup();
    renderMenu();
    await user.click(
      screen.getByRole("button", { name: /insert mongosh snippet/i }),
    );

    expect(
      screen.getByRole("group", { name: "Query methods" }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Query methods" })).toBeNull();
  });
});

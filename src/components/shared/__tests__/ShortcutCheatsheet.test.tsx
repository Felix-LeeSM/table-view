import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ShortcutCheatsheet from "../ShortcutCheatsheet";

function fireGlobalKey(
  key: string,
  init: Partial<KeyboardEventInit> = {},
  target: Element | Document = document.body,
) {
  act(() => {
    fireEvent(
      target,
      new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      }),
    );
  });
}

describe("ShortcutCheatsheet", () => {
  beforeEach(() => {
    render(<ShortcutCheatsheet />);
  });

  afterEach(() => {
    cleanup();
  });

  it("opens when `?` is pressed outside an editable target", () => {
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    fireGlobalKey("?");

    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("ignores `?` when focus is inside an INPUT", () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireGlobalKey("?", {}, input);

    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    document.body.removeChild(input);
  });

  it("opens on Cmd+/", () => {
    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    fireGlobalKey("/", { metaKey: true });

    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  it("opens on Ctrl+/ as well as Cmd+/", () => {
    fireGlobalKey("/", { ctrlKey: true });

    expect(screen.getByText("Keyboard shortcuts")).toBeInTheDocument();
  });

  // Reason: #1224 — user report: in the RAW query window Cmd+/ toggles a
  // comment, but CodeMirror only calls preventDefault, not stopPropagation, so
  // the keydown bubbles up to document and the shortcut cheatsheet opens too.
  // The Cmd+/ branch must also be suppressed by the editable
  // (contentEditable = CodeMirror `.cm-content`) guard.
  it("ignores Cmd+/ when focus is inside a contentEditable editor (#1224)", () => {
    const editor = document.createElement("div");
    editor.className = "cm-content";
    // jsdom does not compute `isContentEditable` from the contenteditable
    // attribute, so expose the property production code reads directly (same
    // pattern as the `isEditableTarget` tests).
    Object.defineProperty(editor, "isContentEditable", {
      configurable: true,
      get: () => true,
    });
    document.body.appendChild(editor);

    fireGlobalKey("/", { metaKey: true }, editor);

    expect(screen.queryByText("Keyboard shortcuts")).toBeNull();

    document.body.removeChild(editor);
  });

  it("renders every group label when the search box is empty", () => {
    fireGlobalKey("?");

    for (const label of ["Tabs", "Editing", "Navigation", "Panels", "Misc"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("filters down to a single matching row when searching for 'format'", () => {
    fireGlobalKey("?");

    const search = screen.getByRole("textbox", { name: "Search shortcuts" });
    act(() => {
      fireEvent.change(search, { target: { value: "format" } });
    });

    expect(screen.getByText("Format SQL")).toBeInTheDocument();
    // Other actions across groups should be hidden by the filter.
    expect(screen.queryByText("Close tab")).toBeNull();
    expect(screen.queryByText("Quick open")).toBeNull();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByText("Uglify SQL")).toBeNull();
  });

  it("shows the 'No shortcuts match' empty state when no rows match", () => {
    fireGlobalKey("?");

    const search = screen.getByRole("textbox", { name: "Search shortcuts" });
    act(() => {
      fireEvent.change(search, { target: { value: "zzz-no-match-zzz" } });
    });

    expect(screen.getByText("No shortcuts match")).toBeInTheDocument();
    // None of the group labels should remain rendered when nothing matches.
    expect(screen.queryByText("Tabs")).toBeNull();
    expect(screen.queryByText("Editing")).toBeNull();
  });

  it("matches against the key combination text as well as the label", () => {
    fireGlobalKey("?");

    const search = screen.getByRole("textbox", { name: "Search shortcuts" });
    act(() => {
      fireEvent.change(search, { target: { value: "F5" } });
    });

    // Refresh is the only action with `F5` as one of its keys.
    expect(screen.getByText("Refresh")).toBeInTheDocument();
    expect(screen.queryByText("Close tab")).toBeNull();
  });

  // ── New shortcut labels surfaced in the cheatsheet ──

  it("renders the Toggle Home/Workspace label (Cmd+,)", () => {
    fireGlobalKey("?");

    expect(screen.getByText("Toggle Home/Workspace")).toBeInTheDocument();
    // Sanity — the legacy "Settings" label must no longer appear.
    expect(screen.queryByText("Settings")).toBeNull();
  });

  it("renders the Switch to tab 1–9 label (Cmd+1..9)", () => {
    fireGlobalKey("?");

    expect(screen.getByText("Switch to tab 1–9")).toBeInTheDocument();
  });

  // #2428 — the layout cluster's two toggles are icon-only buttons, so this
  // list is the only surface that spells their combos out. If it drifts the
  // shortcuts become undiscoverable rather than broken, which no other test
  // would catch.
  it("[hotkey] renders Cmd+B and Cmd+J with their panel labels", () => {
    fireGlobalKey("?");

    expect(screen.getByText("Toggle schema sidebar")).toBeInTheDocument();
    expect(screen.getByText("Cmd+B")).toBeInTheDocument();
    expect(screen.getByText("Toggle bottom panel")).toBeInTheDocument();
    expect(screen.getByText("Cmd+J")).toBeInTheDocument();
  });

  // `Open connection switcher` (Cmd+K) was removed from the cheatsheet
  // alongside the deletion of `<ConnectionSwitcher>`. Guard against a
  // regression by asserting the label is gone.
  it("does NOT render the deprecated Open connection switcher label", () => {
    fireGlobalKey("?");

    expect(screen.queryByText("Open connection switcher")).toBeNull();
    // The Cmd+K key text alone shouldn't appear either.
    expect(screen.queryByText("Cmd+K")).toBeNull();
  });
});

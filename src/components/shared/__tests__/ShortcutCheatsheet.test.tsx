import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
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
});

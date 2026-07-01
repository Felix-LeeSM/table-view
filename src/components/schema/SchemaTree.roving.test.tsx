import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";
import SchemaTree from "./SchemaTree";
import {
  __test,
  useTreeRoving,
  type TreeRoving,
} from "./SchemaTree/useTreeRoving";
import type { VisibleRow } from "./SchemaTree/treeRows";
import {
  mockLoadSchemas,
  mockLoadTables,
  resetStores,
  setSchemaStoreState,
} from "./__tests__/schemaTreeTestHelpers";

/**
 * WAI-ARIA tree roving-tabindex + arrow-key navigation (#3). Asserts the
 * roving model directly — only one treeitem is in the tab order at a time,
 * and ArrowDown/Up/Right/Left move focus + the `tabIndex=0` anchor. These
 * supersede the implicit "every node is a tab stop" assumption the older
 * smoke tests never asserted (they checked roles/levels only).
 */

// rAF flush — `useTreeRoving.focusByKey` defers `.focus()` one frame so a
// freshly-expanded row is in the DOM first.
function flushRaf() {
  return act(async () => {
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  });
}

describe("SchemaTree roving tabindex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadSchemas.mockResolvedValue(undefined);
    mockLoadTables.mockResolvedValue(undefined);
    resetStores();
  });

  async function renderTree() {
    setSchemaStoreState({
      schemas: { conn1: [{ name: "public" }] },
      tables: {
        "conn1:public": [
          { name: "users", schema: "public", row_count: null },
          { name: "orders", schema: "public", row_count: null },
        ],
      },
    });
    await act(async () => {
      render(<SchemaTree connectionId="conn1" />);
    });
    return screen.getByRole("tree", { name: "conn1 schema tree" });
  }

  it("puts exactly one treeitem in the tab order initially (first row)", async () => {
    const tree = await renderTree();
    const items = within(tree).getAllByRole("treeitem");
    const tabbable = items.filter((el) => el.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    // First focusable row is the schema row.
    expect(tabbable[0]).toHaveAttribute("aria-label", "public schema");
  });

  it("ArrowDown moves focus + tabIndex=0 to the next treeitem", async () => {
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    schema.focus();

    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();

    const tables = within(tree).getByRole("treeitem", {
      name: "Tables in public",
    });
    expect(tables).toHaveAttribute("tabindex", "0");
    expect(schema).toHaveAttribute("tabindex", "-1");
    expect(tables).toHaveFocus();
  });

  it("ArrowUp moves focus back to the previous treeitem", async () => {
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    schema.focus();
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    await flushRaf();
    fireEvent.keyDown(tree, { key: "ArrowUp" });
    await flushRaf();

    expect(schema).toHaveAttribute("tabindex", "0");
    expect(schema).toHaveFocus();
  });

  it("ArrowLeft on an expanded schema collapses it in place", async () => {
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    schema.focus();
    expect(schema).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    await flushRaf();

    expect(schema).toHaveAttribute("aria-expanded", "false");
    // Children gone after collapse.
    expect(
      within(tree).queryByRole("treeitem", { name: "users table" }),
    ).toBeNull();
  });

  it("ArrowRight on a collapsed schema expands it in place", async () => {
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    schema.focus();
    fireEvent.keyDown(tree, { key: "ArrowLeft" }); // collapse
    await flushRaf();
    expect(schema).toHaveAttribute("aria-expanded", "false");

    fireEvent.keyDown(tree, { key: "ArrowRight" }); // expand
    await flushRaf();
    expect(schema).toHaveAttribute("aria-expanded", "true");
  });

  it("End jumps to the last visible treeitem, Home back to the first", async () => {
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    schema.focus();

    fireEvent.keyDown(tree, { key: "End" });
    await flushRaf();
    const items = within(tree).getAllByRole("treeitem");
    const last = items[items.length - 1]!;
    expect(last).toHaveAttribute("tabindex", "0");
    expect(last).toHaveFocus();

    fireEvent.keyDown(tree, { key: "Home" });
    await flushRaf();
    expect(schema).toHaveAttribute("tabindex", "0");
    expect(schema).toHaveFocus();
  });

  it("mouse-focusing a row does not steal focus back on the next frame", async () => {
    // Regression: `onFocus` used to route through the keyboard `focusByKey`,
    // which scheduled a rAF `.focus()`. After the user clicked a treeitem then
    // moved to another control (e.g. the query editor), that stale rAF yanked
    // focus back to the tree and dropped their keystrokes — the mariadb E2E
    // "SQL Query Editor did not receive the exact query text" failure.
    const tree = await renderTree();
    const schema = within(tree).getByRole("treeitem", {
      name: "public schema",
    });
    const external = document.createElement("input");
    document.body.appendChild(external);

    act(() => {
      schema.focus(); // fires onFocus → roving anchor sync (state only)
    });
    act(() => {
      external.focus(); // user moves to the editor
    });
    await flushRaf(); // a stale rAF must NOT re-focus the tree

    expect(external).toHaveFocus();
    expect(schema).not.toHaveFocus();
    external.remove();
  });
});

describe("useTreeRoving.findParent", () => {
  const r = (kind: VisibleRow["kind"], key: string) =>
    ({ kind, key }) as unknown as Parameters<
      typeof __test.findParent
    >[0][number];

  it("returns the nearest shallower-depth earlier row", () => {
    // schema(0) → category(1) → item(2): item's parent is category,
    // category's parent is schema.
    const rows = [r("schema", "s"), r("category", "c"), r("item", "i")];
    expect(__test.findParent(rows, 2)?.key).toBe("c");
    expect(__test.findParent(rows, 1)?.key).toBe("s");
    expect(__test.findParent(rows, 0)).toBeUndefined();
  });
});

// Virtualized trees only mount the windowed rows, so a Home/End jump to a row
// outside the window would `.focus()` a node that isn't in the DOM. The hook
// must ask the injected virtualizer to scroll the target's *full-list* index
// into view before focusing. jsdom won't reliably propagate the programmatic
// scroll into a new render, so this pins the contract at the hook boundary
// (scrollToIndex is called with the right index) rather than the pixels.
describe("useTreeRoving virtualized scroll-into-view", () => {
  const row = (kind: VisibleRow["kind"], key: string) =>
    ({ kind, key }) as unknown as VisibleRow;
  const rows = [row("schema", "s"), row("category", "c"), row("item", "i")];
  const noopActions = { onToggleSchema: () => {}, onToggleCategory: () => {} };

  type KeydownArg = Parameters<TreeRoving["onKeyDown"]>[0];
  const keydown = (key: string): KeydownArg =>
    ({
      key,
      target: document.createElement("div"),
      preventDefault: () => {},
    }) as unknown as KeydownArg;

  it("End scrolls the last row's index into view before focusing", () => {
    const container = { current: document.createElement("div") };
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useTreeRoving(rows, noopActions, container, scrollToIndex),
    );
    act(() => result.current.onKeyDown(keydown("End")));
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });

  it("Home scrolls the first row's index into view", () => {
    const container = { current: document.createElement("div") };
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useTreeRoving(rows, noopActions, container, scrollToIndex),
    );
    act(() => result.current.onKeyDown(keydown("End")));
    scrollToIndex.mockClear();
    act(() => result.current.onKeyDown(keydown("Home")));
    expect(scrollToIndex).toHaveBeenCalledWith(0);
  });

  it("navigates without throwing when no virtualizer callback is supplied", () => {
    const container = { current: document.createElement("div") };
    const { result } = renderHook(() =>
      useTreeRoving(rows, noopActions, container),
    );
    expect(() =>
      act(() => result.current.onKeyDown(keydown("End"))),
    ).not.toThrow();
  });
});

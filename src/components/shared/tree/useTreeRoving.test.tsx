import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  findParent,
  useTreeRoving,
  type TreeRoving,
  type TreeRovingRow,
} from "./useTreeRoving";

/**
 * Unit contract for the shared WAI-ARIA tree roving hook. Every sidebar tree
 * feeds it a flat visible-order row list; these assertions pin the keymap +
 * focus-split model that all of them inherit (rather than re-testing it in
 * each tree's component test).
 */

const row = (
  key: string,
  depth: number,
  expanded: boolean | null,
  focusable = true,
): TreeRovingRow => ({ key, depth, expanded, focusable });

type KeydownArg = Parameters<TreeRoving["onKeyDown"]>[0];
const keydown = (key: string): KeydownArg =>
  ({
    key,
    target: document.createElement("div"),
    preventDefault: () => {},
  }) as unknown as KeydownArg;

describe("useTreeRoving keymap", () => {
  const container = () => ({ current: document.createElement("div") });

  it("ArrowDown advances the anchor to the next focusable row", () => {
    const rows = [row("a", 0, false), row("b", 0, false), row("c", 0, false)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container()),
    );
    act(() => result.current.onKeyDown(keydown("Home"))); // anchor at "a"
    expect(result.current.focusKey).toBe("a");
    act(() => result.current.onKeyDown(keydown("ArrowDown")));
    expect(result.current.focusKey).toBe("b");
  });

  it("ArrowUp stops at the first row, ArrowDown at the last", () => {
    const rows = [row("a", 0, null), row("b", 0, null)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container()),
    );
    act(() => result.current.onKeyDown(keydown("End")));
    expect(result.current.focusKey).toBe("b");
    act(() => result.current.onKeyDown(keydown("ArrowDown")));
    expect(result.current.focusKey).toBe("b"); // clamped
    act(() => result.current.onKeyDown(keydown("Home")));
    expect(result.current.focusKey).toBe("a");
    act(() => result.current.onKeyDown(keydown("ArrowUp")));
    expect(result.current.focusKey).toBe("a"); // clamped
  });

  it("ArrowRight toggles a collapsed row in place", () => {
    const onToggle = vi.fn();
    const rows = [row("a", 0, false)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, onToggle, container()),
    );
    act(() => result.current.onKeyDown(keydown("Home"))); // anchor at "a"
    act(() => result.current.onKeyDown(keydown("ArrowRight")));
    expect(onToggle).toHaveBeenCalledWith("a");
    expect(result.current.focusKey).toBe("a"); // stayed put
  });

  it("ArrowRight on an expanded row steps into the first child", () => {
    const onToggle = vi.fn();
    const rows = [row("a", 0, true), row("a.child", 1, null)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, onToggle, container()),
    );
    act(() => result.current.onKeyDown(keydown("ArrowRight")));
    expect(onToggle).not.toHaveBeenCalled();
    expect(result.current.focusKey).toBe("a.child");
  });

  it("ArrowLeft collapses an expanded row, else hops to the parent", () => {
    const onToggle = vi.fn();
    const rows = [row("a", 0, true), row("a.child", 1, null)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, onToggle, container()),
    );
    // On the parent (expanded) → collapse in place.
    act(() => result.current.onKeyDown(keydown("ArrowRight"))); // → child
    act(() => result.current.onKeyDown(keydown("ArrowLeft"))); // child leaf → parent
    expect(result.current.focusKey).toBe("a");
    act(() => result.current.onKeyDown(keydown("ArrowLeft"))); // parent expanded → collapse
    expect(onToggle).toHaveBeenCalledWith("a");
  });

  it("skips non-focusable affordance rows during navigation", () => {
    const rows = [
      row("a", 0, null),
      row("sep", 0, null, false),
      row("b", 0, null),
    ];
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container()),
    );
    act(() => result.current.onKeyDown(keydown("ArrowDown"))); // → a
    act(() => result.current.onKeyDown(keydown("ArrowDown"))); // skips sep → b
    expect(result.current.focusKey).toBe("b");
  });

  it("ignores keys targeting a nested input", () => {
    const rows = [row("a", 0, null)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container()),
    );
    const input = document.createElement("input");
    act(() =>
      result.current.onKeyDown({
        key: "ArrowDown",
        target: input,
        preventDefault: () => {},
      } as unknown as KeydownArg),
    );
    expect(result.current.focusKey).toBeNull();
  });

  it("setFocusKey syncs the anchor without focusing (mouse path)", () => {
    const rows = [row("a", 0, null), row("b", 0, null)];
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container()),
    );
    act(() => result.current.setFocusKey("b"));
    expect(result.current.focusKey).toBe("b");
  });

  it("scrollToIndex receives the full-list index before focusing", () => {
    const rows = [
      row("a", 0, null),
      row("sep", 0, null, false),
      row("b", 0, null),
    ];
    const scrollToIndex = vi.fn();
    const { result } = renderHook(() =>
      useTreeRoving(rows, () => {}, container(), scrollToIndex),
    );
    act(() => result.current.onKeyDown(keydown("End")));
    // Last focusable is "b" at full-list index 2 (past the separator).
    expect(scrollToIndex).toHaveBeenCalledWith(2);
  });
});

describe("findParent", () => {
  it("returns the nearest shallower earlier row", () => {
    const rows = [row("s", 0, true), row("c", 1, true), row("i", 2, null)];
    expect(findParent(rows, 2)?.key).toBe("c");
    expect(findParent(rows, 1)?.key).toBe("s");
    expect(findParent(rows, 0)).toBeUndefined();
  });
});

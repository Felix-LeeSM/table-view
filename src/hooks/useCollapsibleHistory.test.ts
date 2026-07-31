import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  HISTORY_DEFAULT_VISIBLE,
  useCollapsibleHistory,
} from "./useCollapsibleHistory";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("useCollapsibleHistory (#1309)", () => {
  it("shows every item and disables the toggle when at or below the cap", () => {
    const items = range(HISTORY_DEFAULT_VISIBLE);
    const { result } = renderHook(() => useCollapsibleHistory(items));

    expect(result.current.visible).toEqual(items);
    expect(result.current.canToggle).toBe(false);
    expect(result.current.hiddenCount).toBe(0);
    expect(result.current.expanded).toBe(false);
  });

  it("caps to the first N and reports the hidden remainder above the cap", () => {
    const items = range(HISTORY_DEFAULT_VISIBLE + 3);
    const { result } = renderHook(() => useCollapsibleHistory(items));

    expect(result.current.visible).toHaveLength(HISTORY_DEFAULT_VISIBLE);
    expect(result.current.visible).toEqual(range(HISTORY_DEFAULT_VISIBLE));
    expect(result.current.canToggle).toBe(true);
    expect(result.current.hiddenCount).toBe(3);
  });

  it("toggle expands to the full list, then collapses back", () => {
    const items = range(8);
    const { result } = renderHook(() => useCollapsibleHistory(items));

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(result.current.visible).toEqual(items);
    expect(result.current.hiddenCount).toBe(0);

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
    expect(result.current.visible).toHaveLength(HISTORY_DEFAULT_VISIBLE);
    expect(result.current.hiddenCount).toBe(3);
  });

  it("honours a custom defaultVisible", () => {
    const items = range(10);
    const { result } = renderHook(() => useCollapsibleHistory(items, 2));

    expect(result.current.visible).toHaveLength(2);
    expect(result.current.hiddenCount).toBe(8);
  });
});

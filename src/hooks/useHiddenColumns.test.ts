// Sprint 317 (2026-05-15) — Slice D.1: hide column state hook.
//
// 작성 이유: per-collection persist 규약 (`hidden-columns:<key>`) 의
// load/save/clear + hide/show/toggle/clear 동작이 useColumnWidths 의
// 패턴과 정합한지, 그리고 quota/disabled localStorage 시 silent
// fall-back 회귀를 lock.

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHiddenColumns } from "./useHiddenColumns";

beforeEach(() => {
  window.localStorage.clear();
});

describe("useHiddenColumns", () => {
  it("starts empty when there is no persisted state and no key", () => {
    const { result } = renderHook(() => useHiddenColumns());
    expect(result.current.hidden.size).toBe(0);
    expect(result.current.isHidden("foo")).toBe(false);
  });

  it("hides a column and reflects it through isHidden", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("foo");
    });
    expect(result.current.hidden.has("foo")).toBe(true);
    expect(result.current.isHidden("foo")).toBe(true);
  });

  it("show() removes a column, clear() wipes all", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.hide("a");
      result.current.hide("b");
      result.current.show("a");
    });
    expect(result.current.hidden.has("a")).toBe(false);
    expect(result.current.hidden.has("b")).toBe(true);

    act(() => {
      result.current.clear();
    });
    expect(result.current.hidden.size).toBe(0);
  });

  it("toggle() flips state both directions", () => {
    const { result } = renderHook(() => useHiddenColumns());
    act(() => {
      result.current.toggle("x");
    });
    expect(result.current.isHidden("x")).toBe(true);
    act(() => {
      result.current.toggle("x");
    });
    expect(result.current.isHidden("x")).toBe(false);
  });

  it("persists to localStorage under hidden-columns:<key> when a key is given", () => {
    const { result } = renderHook(() => useHiddenColumns("document:db:coll"));
    act(() => {
      result.current.hide("email");
      result.current.hide("password");
    });
    const raw = window.localStorage.getItem("hidden-columns:document:db:coll");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as string[];
    expect(new Set(parsed)).toEqual(new Set(["email", "password"]));
  });

  it("loads persisted state on mount when the key is provided", () => {
    window.localStorage.setItem(
      "hidden-columns:document:db:coll",
      JSON.stringify(["legacy"]),
    );
    const { result } = renderHook(() => useHiddenColumns("document:db:coll"));
    expect(result.current.isHidden("legacy")).toBe(true);
  });

  it("clears localStorage when hidden becomes empty (clear or last show)", () => {
    window.localStorage.setItem(
      "hidden-columns:document:db:coll",
      JSON.stringify(["one"]),
    );
    const { result } = renderHook(() => useHiddenColumns("document:db:coll"));
    act(() => {
      result.current.show("one");
    });
    expect(
      window.localStorage.getItem("hidden-columns:document:db:coll"),
    ).toBeNull();
  });

  it("ignores corrupt persisted blob silently", () => {
    window.localStorage.setItem("hidden-columns:bad", "not-json");
    const { result } = renderHook(() => useHiddenColumns("bad"));
    expect(result.current.hidden.size).toBe(0);
  });

  it("swaps state when the persistenceKey changes", () => {
    window.localStorage.setItem(
      "hidden-columns:document:a:1",
      JSON.stringify(["alpha"]),
    );
    window.localStorage.setItem(
      "hidden-columns:document:b:2",
      JSON.stringify(["beta"]),
    );
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useHiddenColumns(key),
      { initialProps: { key: "document:a:1" } },
    );
    expect(result.current.isHidden("alpha")).toBe(true);
    rerender({ key: "document:b:2" });
    expect(result.current.isHidden("alpha")).toBe(false);
    expect(result.current.isHidden("beta")).toBe(true);
  });
});

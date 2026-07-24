/**
 * #1370 — the cancel-safe teardown extracted from App.tsx / QuickOpen.tsx.
 * The load-bearing case (#1261): unmount BEFORE the async `listen()` resolves
 * must still unlisten the moment it does, never leak a listener onto a
 * torn-down webview.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useTauriListener } from "./useTauriListener";

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("useTauriListener", () => {
  it("unlistens on unmount after the listener has resolved", async () => {
    const unlisten = vi.fn();
    const { unmount } = renderHook(() =>
      useTauriListener(() => Promise.resolve(unlisten as UnlistenFn), []),
    );
    await flush();
    expect(unlisten).not.toHaveBeenCalled();
    unmount();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("unlistens immediately when the listen resolves after unmount", async () => {
    const unlisten = vi.fn();
    const { unmount } = renderHook(() =>
      useTauriListener(() => Promise.resolve(unlisten as UnlistenFn), []),
    );
    unmount(); // teardown before the promise resolves
    expect(unlisten).not.toHaveBeenCalled();
    await flush();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("swallows setup rejection (no Tauri runtime)", async () => {
    const { unmount } = renderHook(() =>
      useTauriListener(() => Promise.reject(new Error("no runtime")), []),
    );
    await flush();
    expect(() => unmount()).not.toThrow();
  });

  // Purpose: deps-change re-subscription path — App.tsx / QuickOpen.tsx
  // rely on it when the event name or a captured handler value changes.
  // Issue #1630 (2026-07-24) — 2026-07-17 test audit residual (P4).
  describe("re-subscription on deps change (issue #1630)", () => {
    // Reason: a dep change tears down the previous listener (old
    // unlisten runs) and registers a fresh subscribe (new listen), then
    // unmount tears down only the current listener. Issue #1630
    // (2026-07-24).
    it("runs old unlisten + registers new listen when deps change", async () => {
      const unlistenA = vi.fn();
      const unlistenB = vi.fn();
      const subscribe = vi
        .fn()
        .mockResolvedValueOnce(unlistenA as UnlistenFn)
        .mockResolvedValueOnce(unlistenB as UnlistenFn);
      const { rerender, unmount } = renderHook(
        ({ dep }: { dep: number }) => useTauriListener(subscribe, [dep]),
        { initialProps: { dep: 1 } },
      );
      await flush();
      expect(subscribe).toHaveBeenCalledTimes(1);
      expect(unlistenA).not.toHaveBeenCalled();

      rerender({ dep: 2 });
      // Old effect cleanup ran synchronously on the dep change.
      expect(unlistenA).toHaveBeenCalledTimes(1);
      await flush();
      // New effect re-subscribed with the same factory.
      expect(subscribe).toHaveBeenCalledTimes(2);
      expect(unlistenB).not.toHaveBeenCalled();

      unmount();
      // Only the current listener is torn down; the old one is not
      // called a second time.
      expect(unlistenB).toHaveBeenCalledTimes(1);
      expect(unlistenA).toHaveBeenCalledTimes(1);
    });
  });
});

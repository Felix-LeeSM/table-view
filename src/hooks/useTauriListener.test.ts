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
});

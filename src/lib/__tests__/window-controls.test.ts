/**
 * window-controls.ts — showWindow workspace_ensure fallback tests.
 *
 * Reason: the workspace window can be destroyed at runtime (e.g. OS closed it
 * before the `onCloseRequested` listener was registered). When `getByLabel`
 * returns null, `showWindow("workspace")` must invoke the Rust-side
 * `workspace_ensure` command to recreate it from config, then retry the show.
 * These tests lock that recovery path. (2026-04-28)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tauri APIs before importing the module under test.
const mockGetByLabel = vi.fn();
const mockInvoke = vi.fn();
const mockShow = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {
    getByLabel: (...args: unknown[]) => mockGetByLabel(...args),
  },
  getCurrentWebviewWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  // UnlistenFn type stub
}));

describe("showWindow workspace_ensure fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  // Reason: the normal case — workspace window exists, showWindow just shows
  // it without invoking workspace_ensure. (2026-04-28)
  it("does NOT invoke workspace_ensure when workspace window exists", async () => {
    mockGetByLabel.mockResolvedValue({ show: mockShow });
    mockShow.mockResolvedValue(undefined);

    const { showWindow } = await import("@lib/window-controls");
    await showWindow("workspace");

    expect(mockShow).toHaveBeenCalledTimes(1);
    expect(mockInvoke).not.toHaveBeenCalledWith("workspace_ensure");
  });

  // Reason: the critical recovery path — workspace was destroyed, getByLabel
  // returns null. showWindow must invoke workspace_ensure to recreate it,
  // then resolve the window again and call show(). (2026-04-28)
  it("invokes workspace_ensure then retries when workspace getByLabel returns null", async () => {
    // First getByLabel returns null (window missing), second returns the
    // recreated window.
    const recreatedWin = { show: mockShow };
    mockShow.mockResolvedValue(undefined);
    mockGetByLabel
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(recreatedWin);

    const { showWindow } = await import("@lib/window-controls");
    await showWindow("workspace");

    // workspace_ensure must have been invoked to recreate the window.
    expect(mockInvoke).toHaveBeenCalledWith("workspace_ensure");
    // After recreation, getByLabel was called again and show was called.
    expect(mockGetByLabel).toHaveBeenCalledTimes(2);
    expect(mockShow).toHaveBeenCalledTimes(1);
  });

  // Reason: workspace_ensure is workspace-specific. The launcher window must
  // never trigger the recreate fallback — it should throw immediately. (2026-04-28)
  it("does NOT invoke workspace_ensure for launcher window when getByLabel returns null", async () => {
    mockGetByLabel.mockResolvedValue(null);

    const { showWindow } = await import("@lib/window-controls");
    await expect(showWindow("launcher")).rejects.toThrow(/window not found/);

    expect(mockInvoke).not.toHaveBeenCalledWith("workspace_ensure");
  });

  // Reason: if workspace_ensure runs but the window STILL can't be resolved
  // (e.g. the Rust command failed silently or returned before the window was
  // fully created), showWindow must throw rather than silently returning.
  // (2026-04-28)
  it("throws when workspace_ensure runs but window still not found on retry", async () => {
    mockGetByLabel.mockResolvedValue(null);

    const { showWindow } = await import("@lib/window-controls");
    await expect(showWindow("workspace")).rejects.toThrow(/window not found/);

    // workspace_ensure was attempted but didn't help.
    expect(mockInvoke).toHaveBeenCalledWith("workspace_ensure");
    expect(mockGetByLabel).toHaveBeenCalledTimes(2);
  });
});

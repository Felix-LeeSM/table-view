/**
 * window-controls.ts — Rust command routing tests.
 *
 * Reason: showWindow/hideWindow/focusWindow now route through Rust-side
 * commands (`workspace_show`, `launcher_hide`, etc.) instead of the JS
 * `getByLabel` API which proved unreliable. These tests lock the Rust
 * command invocation + workspace_ensure fallback behavior. (2026-04-28)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInvoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: {},
  getCurrentWebviewWindow: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({}));

describe("showWindow — Rust command routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  // Reason: the normal case — workspace window exists, workspace_show
  // succeeds on the first try without needing workspace_ensure. (2026-04-28)
  it("invokes workspace_show directly when window exists", async () => {
    const { showWindow } = await import("@lib/window-controls");
    await showWindow("workspace");

    expect(mockInvoke).toHaveBeenCalledWith("workspace_show");
    expect(mockInvoke).not.toHaveBeenCalledWith("workspace_ensure");
  });

  // Reason: the critical recovery path — workspace_show fails (window
  // destroyed), then workspace_ensure recreates it, then workspace_show
  // retries. This is the fix for the "창이 안 열려" bug. (2026-04-28)
  it("invokes workspace_ensure then retries workspace_show when workspace_show fails", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("window 'workspace' not found"))
      .mockResolvedValueOnce(undefined) // workspace_ensure succeeds
      .mockResolvedValueOnce(undefined); // workspace_show retry succeeds

    const { showWindow } = await import("@lib/window-controls");
    await showWindow("workspace");

    // First workspace_show → fails, then ensure, then retry.
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    expect(mockInvoke).toHaveBeenNthCalledWith(1, "workspace_show");
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "workspace_ensure");
    expect(mockInvoke).toHaveBeenNthCalledWith(3, "workspace_show");
  });

  // Reason: workspace_ensure is workspace-specific. The launcher must never
  // trigger the recreate fallback — its error propagates directly. (2026-04-28)
  it("propagates error for launcher without trying workspace_ensure", async () => {
    mockInvoke.mockRejectedValue(new Error("window 'launcher' not found"));

    const { showWindow } = await import("@lib/window-controls");
    await expect(showWindow("launcher")).rejects.toThrow(/launcher/);

    expect(mockInvoke).toHaveBeenCalledWith("launcher_show");
    expect(mockInvoke).not.toHaveBeenCalledWith("workspace_ensure");
  });

  // Reason: if workspace_ensure also fails, the error from the retry
  // workspace_show propagates to the caller. (2026-04-28)
  it("propagates error when workspace_ensure + retry both fail", async () => {
    mockInvoke
      .mockRejectedValueOnce(new Error("window 'workspace' not found"))
      .mockRejectedValueOnce(new Error("config not found"))
      .mockRejectedValueOnce(new Error("window 'workspace' not found"));

    const { showWindow } = await import("@lib/window-controls");
    await expect(showWindow("workspace")).rejects.toThrow();
  });
});

describe("hideWindow / focusWindow — Rust command routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue(undefined);
  });

  // Reason: hideWindow must call the Rust command, not getByLabel.
  // (2026-04-28)
  it("hideWindow invokes launcher_hide via Rust command", async () => {
    const { hideWindow } = await import("@lib/window-controls");
    await hideWindow("launcher");
    expect(mockInvoke).toHaveBeenCalledWith("launcher_hide");
  });

  // Reason: hideWindow swallows errors (best-effort). (2026-04-28)
  it("hideWindow swallows errors silently", async () => {
    mockInvoke.mockRejectedValue(new Error("window gone"));
    const { hideWindow } = await import("@lib/window-controls");
    // Should not throw
    await hideWindow("workspace");
  });

  // Reason: focusWindow must call the Rust command. (2026-04-28)
  it("focusWindow invokes workspace_focus via Rust command", async () => {
    const { focusWindow } = await import("@lib/window-controls");
    await focusWindow("workspace");
    expect(mockInvoke).toHaveBeenCalledWith("workspace_focus");
  });

  // Reason: focusWindow swallows errors (best-effort). (2026-04-28)
  it("focusWindow swallows errors silently", async () => {
    mockInvoke.mockRejectedValue(new Error("window gone"));
    const { focusWindow } = await import("@lib/window-controls");
    await focusWindow("workspace");
  });
});

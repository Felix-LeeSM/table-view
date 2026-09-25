// Written 2026-05-16
//
// Reason: following state-management-strategy Q3 / line 776, launcher close
// changes meaning from **exit → hide**. `registerLauncherCloseHandler` must
// fire the same lifecycle signal (`hideWindow('launcher')`) in both jsdom and
// runtime, after the backend has already blocked the OS-level close with
// `api.prevent_close()` and performed the hide. workspace-{conn} windows are
// independent of the launcher close, so hideWindow must not be called with
// 'workspace' or any per-conn label.
//
// AC matrix:
//   - AC-363-04-FE-01 close-requested → hideWindow('launcher') called once.
//   - AC-363-04-FE-02 close-requested → exitApp() called zero times
//     (regression guard against the old exit-on-close behavior).
//   - AC-363-04-FE-03 close-requested → zero hide/show calls with a
//     workspace label.
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const hideWindowMock = vi.fn((label: string) => {
  void label;
  return Promise.resolve();
});
const showWindowMock = vi.fn((label: string) => {
  void label;
  return Promise.resolve();
});
const exitAppMock = vi.fn(() => Promise.resolve());
const onCloseRequestedMock = vi.fn(
  (label: string, handler: () => void | Promise<void>) => {
    void label;
    void handler;
    return Promise.resolve(() => {});
  },
);

vi.mock("@lib/window-controls", () => ({
  showWindow: (label: string) => showWindowMock(label),
  hideWindow: (label: string) => hideWindowMock(label),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  exitApp: () => exitAppMock(),
  onCloseRequested: (label: string, handler: () => void | Promise<void>) =>
    onCloseRequestedMock(label, handler),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: vi.fn(() => "launcher"),
}));

describe("registerLauncherCloseHandler — sprint-363 close → hide", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hideWindowMock.mockResolvedValue(undefined);
    showWindowMock.mockResolvedValue(undefined);
    exitAppMock.mockResolvedValue(undefined);
    onCloseRequestedMock.mockResolvedValue(() => {});
  });

  // AC-363-04-FE-01 + FE-02: close path hides launcher; never exits.
  it("AC-363-04-FE-01: close-requested handler calls hideWindow('launcher') and NOT exitApp()", async () => {
    let captured: (() => void | Promise<void>) | null = null;
    (onCloseRequestedMock as Mock).mockImplementation(
      async (label: string, handler: () => void | Promise<void>) => {
        if (label === "launcher") {
          captured = handler;
        }
        return () => {};
      },
    );

    const { registerLauncherCloseHandler } = await import(
      "@lib/window-lifecycle-boot"
    );
    await registerLauncherCloseHandler();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
    expect(captured).toBeTruthy();

    await captured!();

    expect(hideWindowMock).toHaveBeenCalledWith("launcher");
    expect(hideWindowMock).toHaveBeenCalledTimes(1);
    expect(exitAppMock).not.toHaveBeenCalled();
  });

  // AC-363-04-FE-03: workspace windows untouched on launcher close.
  it("AC-363-04-FE-03: close-requested does NOT call hideWindow/showWindow with any workspace label", async () => {
    let captured: (() => void | Promise<void>) | null = null;
    (onCloseRequestedMock as Mock).mockImplementation(
      async (label: string, handler: () => void | Promise<void>) => {
        if (label === "launcher") captured = handler;
        return () => {};
      },
    );

    const { registerLauncherCloseHandler } = await import(
      "@lib/window-lifecycle-boot"
    );
    await registerLauncherCloseHandler();
    await captured!();

    expect(hideWindowMock).not.toHaveBeenCalledWith("workspace");
    expect(showWindowMock).not.toHaveBeenCalled();
  });

  // bootWindowLifecycle — only launcher window triggers the registration.
  it("bootWindowLifecycle registers the close handler only when current label === 'launcher'", async () => {
    const { bootWindowLifecycle } = await import("@lib/window-lifecycle-boot");
    await bootWindowLifecycle();

    expect(onCloseRequestedMock).toHaveBeenCalledWith(
      "launcher",
      expect.any(Function),
    );
  });
});

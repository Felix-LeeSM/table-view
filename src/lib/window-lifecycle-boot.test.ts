// 작성 2026-05-16 (Phase 3 sprint-363)
//
// 사유: sprint-363 (Q13 / strategy line 773) 으로 launcher close 의 의미가
// **exit → hide** 로 바뀐다. `registerLauncherCloseHandler` 는 backend 가
// 이미 `api.prevent_close()` 로 OS-level close 를 차단하고 hide 를 수행한
// 상태에서 jsdom / runtime 모두에서 동일한 lifecycle 신호 (`hideWindow('launcher')`)
// 를 발사해야 한다. workspace-{conn} window 는 launcher close 와 독립이므로
// hideWindow 가 'workspace' 또는 그 어떤 per-conn label 로도 호출되면 안 된다.
//
// AC 매트릭스:
//   - AC-363-04-FE-01 close-requested → hideWindow('launcher') 호출 1회.
//   - AC-363-04-FE-02 close-requested → exitApp() 호출 0회 (pre-sprint-363 회귀 가드).
//   - AC-363-04-FE-03 close-requested → workspace 라벨 hide/show 호출 0회.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

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

    const { registerLauncherCloseHandler } =
      await import("@lib/window-lifecycle-boot");
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

    const { registerLauncherCloseHandler } =
      await import("@lib/window-lifecycle-boot");
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

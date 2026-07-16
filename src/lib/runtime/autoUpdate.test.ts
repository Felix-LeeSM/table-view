import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { checkForUpdatesOnLaunch } from "./autoUpdate";

const isTauri = vi.fn(() => true);
const invoke = vi.fn(() => Promise.resolve(true));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauri(),
  invoke: (...args: unknown[]) => invoke(...(args as [])),
}));

const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

const relaunch = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

const toastInfo = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@lib/runtime/toast", () => ({
  toast: {
    info: (...a: unknown[]) => toastInfo(...(a as [])),
    error: (...a: unknown[]) => toastError(...(a as [])),
    success: (...a: unknown[]) => toastSuccess(...(a as [])),
  },
}));

function fakeUpdate(
  downloadAndInstall: (
    onEvent?: (e: DownloadEvent) => void,
  ) => Promise<void> = vi.fn(() => Promise.resolve()),
) {
  return { available: true, version: "9.9.9", downloadAndInstall };
}

describe("checkForUpdatesOnLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauri.mockReturnValue(true);
    invoke.mockResolvedValue(true);
  });

  it("no-ops outside the Tauri runtime", async () => {
    isTauri.mockReturnValue(false);
    const confirm = vi.fn();
    await checkForUpdatesOnLaunch(confirm);
    expect(check).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("does nothing when no update is available", async () => {
    check.mockResolvedValue(null);
    const confirm = vi.fn();
    await checkForUpdatesOnLaunch(confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("installs and relaunches when the user confirms (self-install capable)", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    await checkForUpdatesOnLaunch(vi.fn(() => Promise.resolve(true)));
    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
    expect(relaunch).toHaveBeenCalledOnce();
  });

  it("does not install when the user declines", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    await checkForUpdatesOnLaunch(vi.fn(() => Promise.resolve(false)));
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("swallows check failures without throwing OR toasting (silent background)", async () => {
    check.mockRejectedValue(new Error("offline"));
    await expect(checkForUpdatesOnLaunch(vi.fn())).resolves.toBeUndefined();
    expect(toastError).not.toHaveBeenCalled();
  });

  // P2-4 (#1437) — Linux deb/rpm can't self-update. The updater's
  // downloadAndInstall is a silent no-op there, so re-prompting every boot is
  // pointless. Suppress the prompt and show a package-manager hint instead.
  it("suppresses the install prompt and shows a manual-update hint when self-install is unavailable", async () => {
    const update = fakeUpdate();
    check.mockResolvedValue(update);
    invoke.mockResolvedValue(false); // updater_can_self_install => false
    const confirm = vi.fn(() => Promise.resolve(true));
    await checkForUpdatesOnLaunch(confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(toastInfo).toHaveBeenCalledOnce();
  });

  // P2-8 (#1437) — pass a progress callback and surface download progress.
  it("subscribes to download progress events", async () => {
    let captured: ((e: DownloadEvent) => void) | undefined;
    const dl = vi.fn((onEvent?: (e: DownloadEvent) => void) => {
      captured = onEvent;
      return Promise.resolve();
    });
    check.mockResolvedValue(fakeUpdate(dl));
    await checkForUpdatesOnLaunch(vi.fn(() => Promise.resolve(true)));
    expect(dl).toHaveBeenCalledOnce();
    expect(captured).toBeTypeOf("function");
    // Simulating updater events must not throw and must surface a toast.
    captured?.({ event: "Started", data: { contentLength: 100 } });
    captured?.({ event: "Progress", data: { chunkLength: 50 } });
    captured?.({ event: "Finished" });
    expect(toastInfo).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  // P2-8 (#1437) — a mid-download failure after the user confirmed must be
  // visible (explicit toast), not a silent hang.
  it("shows an error toast when the download fails after confirmation", async () => {
    const dl = vi.fn(() => Promise.reject(new Error("network dropped")));
    check.mockResolvedValue(fakeUpdate(dl));
    await expect(
      checkForUpdatesOnLaunch(vi.fn(() => Promise.resolve(true))),
    ).resolves.toBeUndefined();
    expect(dl).toHaveBeenCalledOnce();
    expect(relaunch).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledOnce();
  });
});

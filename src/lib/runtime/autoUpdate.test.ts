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
  version = "9.9.9",
) {
  return { available: true, version, downloadAndInstall };
}

// #1439 P3-10 — must match UPDATE_DECLINE_KEY in autoUpdate.ts.
const DECLINE_KEY = "table-view:update-declined";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("checkForUpdatesOnLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
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

  // #1439 P3-10 — re-prompt throttle. Declining "Later" every boot re-opened
  // the same modal on the next launch; record the declined version + time and
  // stay silent for the same version within the throttle window.
  it("records the declined version + timestamp when the user picks Later", async () => {
    check.mockResolvedValue(fakeUpdate(undefined, "9.9.9"));
    await checkForUpdatesOnLaunch(vi.fn(() => Promise.resolve(false)));
    const raw = window.localStorage.getItem(DECLINE_KEY);
    expect(raw).toBeTruthy();
    const rec = JSON.parse(raw as string);
    expect(rec.version).toBe("9.9.9");
    expect(typeof rec.declinedAt).toBe("number");
  });

  it("does not re-prompt the same version within the throttle window", async () => {
    window.localStorage.setItem(
      DECLINE_KEY,
      JSON.stringify({ version: "9.9.9", declinedAt: Date.now() }),
    );
    check.mockResolvedValue(fakeUpdate(undefined, "9.9.9"));
    const confirm = vi.fn(() => Promise.resolve(true));
    await checkForUpdatesOnLaunch(confirm);
    expect(confirm).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it("re-prompts the same version once the throttle window has passed", async () => {
    window.localStorage.setItem(
      DECLINE_KEY,
      JSON.stringify({ version: "9.9.9", declinedAt: Date.now() - DAY_MS - 1 }),
    );
    check.mockResolvedValue(fakeUpdate(undefined, "9.9.9"));
    const confirm = vi.fn(() => Promise.resolve(true));
    await checkForUpdatesOnLaunch(confirm);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it("re-prompts immediately for a newer version despite a recent decline", async () => {
    window.localStorage.setItem(
      DECLINE_KEY,
      JSON.stringify({ version: "9.9.8", declinedAt: Date.now() }),
    );
    check.mockResolvedValue(fakeUpdate(undefined, "9.9.9"));
    const confirm = vi.fn(() => Promise.resolve(true));
    await checkForUpdatesOnLaunch(confirm);
    expect(confirm).toHaveBeenCalledOnce();
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

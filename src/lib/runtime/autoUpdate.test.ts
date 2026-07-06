import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkForUpdatesOnLaunch } from "./autoUpdate";

const isTauri = vi.fn(() => true);
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => isTauri() }));

const check = vi.fn();
vi.mock("@tauri-apps/plugin-updater", () => ({ check: () => check() }));

const relaunch = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: () => relaunch() }));

function fakeUpdate() {
  return {
    available: true,
    version: "9.9.9",
    downloadAndInstall: vi.fn(() => Promise.resolve()),
  };
}

describe("checkForUpdatesOnLaunch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauri.mockReturnValue(true);
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

  it("installs and relaunches when the user confirms", async () => {
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

  it("swallows check failures without throwing", async () => {
    check.mockRejectedValue(new Error("offline"));
    await expect(checkForUpdatesOnLaunch(vi.fn())).resolves.toBeUndefined();
  });
});

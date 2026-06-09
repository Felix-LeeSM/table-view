import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  getSetting,
  persistSetting,
  persistSettingValue,
  resetSetting,
} from "./settings";

const invokeMock = vi.mocked(invoke);

describe("settings Tauri wrapper", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("persists the backend request shape unchanged", async () => {
    await persistSetting({ key: "theme", valueJson: '{"mode":"dark"}' });

    expect(invokeMock).toHaveBeenCalledWith("persist_setting", {
      req: { key: "theme", valueJson: '{"mode":"dark"}' },
    });
  });

  it("serializes setting values before persistence", async () => {
    await persistSettingValue("safe_mode", "warn");

    expect(invokeMock).toHaveBeenCalledWith("persist_setting", {
      req: { key: "safe_mode", valueJson: '"warn"' },
    });
  });

  it("reads settings by key without changing the IPC DTO", async () => {
    invokeMock.mockResolvedValueOnce('"off"');

    await expect(getSetting("safe_mode")).resolves.toBe('"off"');
    expect(invokeMock).toHaveBeenCalledWith("get_setting", {
      key: "safe_mode",
    });
  });

  it("resets settings by key without wrapping the DTO", async () => {
    await resetSetting("sidebar_width");

    expect(invokeMock).toHaveBeenCalledWith("reset_setting", {
      key: "sidebar_width",
    });
  });
});

// `getInitialAppState` wrapper unit tests. Verifies only the backend IPC
// call contract (command name, return shape, error propagation) — actual
// SQLite reads and atomicity guarantees are the Rust integration tests'
// responsibility.
//
// F.2 wire shape (line 911–998):
//   { schemaVersion: 1, snapshotVersion: number, generatedAt: number,
//     partial: boolean, stores: { connections, workspaces, mru, theme, safeMode },
//     runtime: { activeStatuses } }

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { getInitialAppState, type InitialAppState } from "./snapshot";

const sampleSnapshot: InitialAppState = {
  schemaVersion: 1,
  snapshotVersion: 1,
  generatedAt: 1_700_000_000_000,
  partial: false,
  recovered: false,
  connectionsRestoredFromBackup: false,
  stores: {
    connections: { items: [], groups: [] },
    workspaces: { byConnectionId: {} },
    mru: { recentConnections: [], lastUsedConnectionId: null },
    theme: { themeId: "default", mode: "system" },
    safeMode: { mode: "off" },
  },
  runtime: {
    activeStatuses: {},
  },
};

describe("getInitialAppState (Phase 1 sprint-357)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the get_initial_app_state command with no arguments", async () => {
    invokeMock.mockResolvedValueOnce(sampleSnapshot);

    const snap = await getInitialAppState();

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_initial_app_state");
    expect(snap).toEqual(sampleSnapshot);
  });

  it("propagates backend rejection (e.g. corrupt DB on boot)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db corrupt"));
    await expect(getInitialAppState()).rejects.toThrow(/db corrupt/);
  });
});

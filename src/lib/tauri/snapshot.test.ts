// 작성 2026-05-16 (Phase 1 sprint-357) — `getInitialAppState` wrapper 단위
// 검증. backend IPC 호출 contract (command 이름, return shape, error
// propagation) 만 확인 — 실제 SQLite read 와 atomic guarantee 는 Rust 통합
// 테스트 책임.
//
// F.2 wire shape (line 911–998):
//   { schemaVersion: 1, snapshotVersion: number, generatedAt: number,
//     partial: boolean, stores: { connections, workspaces, mru, theme, safeMode },
//     runtime: { activeStatuses } }

import { describe, it, expect, vi, beforeEach } from "vitest";

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

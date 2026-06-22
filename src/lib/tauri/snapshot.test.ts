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

  it("returns the snapshot shape with schemaVersion=1 + 5 stores + runtime.activeStatuses", async () => {
    invokeMock.mockResolvedValueOnce(sampleSnapshot);
    const snap = await getInitialAppState();

    expect(snap.schemaVersion).toBe(1);
    expect(snap.stores).toHaveProperty("connections");
    expect(snap.stores).toHaveProperty("workspaces");
    expect(snap.stores).toHaveProperty("mru");
    expect(snap.stores).toHaveProperty("theme");
    expect(snap.stores).toHaveProperty("safeMode");
    expect(snap.runtime).toHaveProperty("activeStatuses");
  });

  it("propagates backend rejection (e.g. corrupt DB on boot)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db corrupt"));
    await expect(getInitialAppState()).rejects.toThrow(/db corrupt/);
  });

  it("accepts partial=true with per-store error slots (AC-357-07)", async () => {
    const partial: InitialAppState = {
      ...sampleSnapshot,
      partial: true,
      stores: {
        ...sampleSnapshot.stores,
        mru: { error: "read mru: no such table: mru" },
      },
    };
    invokeMock.mockResolvedValueOnce(partial);

    const snap = await getInitialAppState();
    expect(snap.partial).toBe(true);
    // Frontend 가 dev mode banner 를 띄울 수 있게 per-store error slot 노출.
    expect("error" in snap.stores.mru).toBe(true);
  });

  it("treats runtime.activeStatuses as a Record<string, ConnectionStatus>", async () => {
    const withStatuses: InitialAppState = {
      ...sampleSnapshot,
      runtime: {
        activeStatuses: {
          "conn-1": { type: "connected" },
          "conn-2": { type: "disconnected" },
          "conn-3": { type: "error", message: "timeout" },
        },
      },
    };
    invokeMock.mockResolvedValueOnce(withStatuses);
    const snap = await getInitialAppState();
    expect(snap.runtime.activeStatuses["conn-1"]).toEqual({
      type: "connected",
    });
    expect(snap.runtime.activeStatuses["conn-3"]).toEqual({
      type: "error",
      message: "timeout",
    });
  });
});

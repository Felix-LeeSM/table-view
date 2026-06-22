// 작성 2026-06-23 (v0.3.1) — boot 자동 복구 발생 시 frontend toast 검증.
//
// backend 가 `InitialAppState.recovered=true` 로 반환하면 (boot 중 state.db
// body 손상 감지 → quarantine + fresh DB 복구), `loadAllFromSnapshot` 은
// warning toast 로 사용자에게 알린다. `recovered=false` 면 미발화 — 정상 boot
// 에서는 조용해야 한다.

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";
import { useToastStore } from "@stores/toastStore";
import type { InitialAppState } from "@lib/tauri/snapshot";

function makeSnapshot(
  overrides: Partial<InitialAppState> = {},
): InitialAppState {
  return {
    schemaVersion: 1,
    snapshotVersion: 1,
    generatedAt: 1_700_000_000_000,
    partial: false,
    recovered: false,
    stores: {
      connections: { items: [], groups: [] },
      workspaces: { byConnectionId: {} },
      mru: { recentConnections: [], lastUsedConnectionId: null },
      theme: { themeId: "slate", mode: "system" },
      safeMode: { mode: "off" },
    },
    runtime: { activeStatuses: {} },
    ...overrides,
  };
}

describe("v0.3.1 boot recovery toast", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
    resetSnapshotBufferForTests();
  });

  it("pushes a warning toast when recovered=true", async () => {
    invokeMock.mockResolvedValueOnce(makeSnapshot({ recovered: true }));

    await loadAllFromSnapshot();

    const toasts = useToastStore.getState().toasts;
    const warning = toasts.find((t) => t.variant === "warning");
    expect(warning, "recovery must push a warning toast").toBeTruthy();
    expect(warning?.message).toContain("백업");
  });

  it("does not push a recovery toast when recovered=false", async () => {
    invokeMock.mockResolvedValueOnce(makeSnapshot({ recovered: false }));

    await loadAllFromSnapshot();

    const toasts = useToastStore.getState().toasts;
    const warning = toasts.find((t) => t.variant === "warning");
    expect(warning, "no recovery toast on a normal boot").toBeUndefined();
  });
});

// 작성 2026-06-23 (v0.3.1) — boot 자동 복구 발생 시 frontend toast 검증.
//
// backend 가 `InitialAppState.recovered=true` 로 반환하면 (boot 중 state.db
// body 손상 감지 → quarantine + fresh DB 복구), `loadAllFromSnapshot` 은
// warning toast 로 사용자에게 알린다. `recovered=false` 면 미발화 — 정상 boot
// 에서는 조용해야 한다.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import type { InitialAppState } from "@lib/tauri/snapshot";
import { useToastStore } from "@stores/toastStore";
import { loadAllFromSnapshot, resetSnapshotBufferForTests } from "./loadAll";

function makeSnapshot(
  overrides: Partial<InitialAppState> = {},
): InitialAppState {
  return {
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

// #2183 — connections.json 이 사라졌다가 옆의 백업에서 돌아온 사건. 위의
// `recovered` 와 같은 배선(boot flag → snapshot → toast)을 타지만 키가 따로다.
describe("#2183 connections restored from backup toast", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
    resetSnapshotBufferForTests();
  });

  it("pushes a sticky warning naming the connections backup", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshot({ connectionsRestoredFromBackup: true }),
    );

    await loadAllFromSnapshot();

    const warning = useToastStore
      .getState()
      .toasts.find((t) => t.variant === "warning");
    expect(warning, "a restore must be reported to the user").toBeTruthy();
    expect(
      warning?.message,
      "the user has to be told which file to look at, and it is not the state.db one",
    ).toContain("connections.json.bak");
    expect(warning?.message).not.toContain("state.db.bak");
    expect(
      warning?.durationMs,
      "a boot-time data-loss notice must not time out — going unnoticed is the #2183 failure",
    ).toBeNull();
  });

  it("stays silent when nothing was restored", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshot({ connectionsRestoredFromBackup: false }),
    );

    await loadAllFromSnapshot();

    expect(
      useToastStore.getState().toasts.find((t) => t.variant === "warning"),
      "a first run has nothing to report — warning on every launch would be a new defect",
    ).toBeUndefined();
  });
});

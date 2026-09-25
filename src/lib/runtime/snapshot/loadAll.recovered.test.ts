// Written 2026-06-23 (v0.3.1) — verifies the frontend toast when boot
// auto-recovery runs.
//
// When the backend returns `InitialAppState.recovered=true` (state.db body
// corruption detected during boot → quarantine + recovery onto a fresh DB),
// `loadAllFromSnapshot` tells the user with a warning toast. With
// `recovered=false` nothing fires — a normal boot must stay quiet.

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

// #2183 — connections.json went missing and came back from the backup beside
// it. Same wiring as `recovered` above (boot flag → snapshot → toast), but a
// separate key.
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
    expect(
      warning,
      "the flag says the backup put something back, so the user has to be told",
    ).toBeTruthy();
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

  it("stays silent when the flag says nothing came back", async () => {
    invokeMock.mockResolvedValueOnce(
      makeSnapshot({ connectionsRestoredFromBackup: false }),
    );

    await loadAllFromSnapshot();

    expect(
      useToastStore.getState().toasts.find((t) => t.variant === "warning"),
      "the flag down covers a first run and a backup that held nothing, and neither has anything to report — warning on every launch would be a new defect",
    ).toBeUndefined();
  });
});

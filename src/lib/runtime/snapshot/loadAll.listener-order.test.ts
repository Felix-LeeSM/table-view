// Written 2026-05-16 — verifies AC-367-03 + AC-367-04.
//
// AC-367-03 (static): in the boot sequence code, the
// `listen("state-changed", …)` registration line must sit above the
// `getInitialAppState(` call line. Strict order — the listener has to be
// registered before the IPC so that a backend emit fired just before the
// snapshot applies is caught in the buffer too. Compares line numbers with
// a code grep.
//
// AC-367-04 (behavior): with the state-changed listener registered before
// the snapshot IPC, call `loadAllFromSnapshot` → if a fake `state-changed`
// event fires before the IPC responds, that event is dispatched only once
// after the snapshot applies (dedup by snapshotVersion).
//
// Both scenarios are core invariants of the boot orchestrator — with the
// listener alive, the race window while the snapshot is in flight must be
// buffered safely.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  resetStateChangedRegistryForTests,
  type StateChangedPayload,
  setStateChangedHandlers,
} from "@lib/events/stateChanged";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __pushFakeBufferedEvent,
  resetSnapshotBufferForTests,
} from "./loadAll";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("AC-367-03 listener pre-register (static grep)", () => {
  it("listener registration line precedes getInitialAppState call line in loadAll.ts", () => {
    // Read the boot orchestrator source directly and compare lines — the aim
    // is to guard the ordering enforced in the code itself, not a runtime
    // trace. Both lines are read from one file on purpose, so only that
    // module's sequence is checked (a cross-module split would be stricter,
    // but AC-367-03 asks for strict order within one boot path).
    const source = readFileSync(resolve(__dirname, "loadAll.ts"), "utf8");
    const lines = source.split("\n");
    // Find the first line containing the `listen("state-changed"` substring.
    const listenLine = lines.findIndex((l) =>
      l.includes('listen("state-changed"'),
    );
    const ipcLine = lines.findIndex((l) => l.includes("getInitialAppState("));
    expect(listenLine).toBeGreaterThanOrEqual(0);
    expect(ipcLine).toBeGreaterThanOrEqual(0);
    expect(listenLine).toBeLessThan(ipcLine);
  });
});

describe("AC-367-04 listener buffer drain (race window)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
    resetSnapshotBufferForTests();
  });

  afterEach(() => {
    resetSnapshotBufferForTests();
  });

  it("dispatches a buffered event exactly once after snapshot applies (newer snapshotVersion)", async () => {
    // Scenario:
    //   1. The boot orchestrator registers the listener (buffer mode ON).
    //   2. The IPC call goes out.
    //   3. Just before the response, the backend emits `state-changed`
    //      (snapshotVersion=2) → the listener buffers it.
    //   4. After the snapshot (snapshotVersion=1) applies, the buffer drains
    //      — the event is dispatched to the domain handler exactly once.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged },
    });

    const { loadAllFromSnapshot } = await import("./loadAll");

    invokeMock.mockImplementationOnce(async (cmd: string) => {
      expect(cmd).toBe("get_initial_app_state");
      // Simulate the backend emitting a newer event while the IPC is in
      // flight. The listener must buffer it.
      const newerPayload: StateChangedPayload = {
        domain: "connection",
        op: "update",
        entityId: "conn-2",
        version: 1,
        snapshotVersion: 2,
        originWindow: "launcher",
        emittedAt: 1_700_000_001_000,
      };
      __pushFakeBufferedEvent(newerPayload);
      return {
        schemaVersion: 1,
        snapshotVersion: 1,
        generatedAt: 1_700_000_000_000,
        partial: false,
        recovered: false,
        connectionsRestoredFromBackup: false,
        stores: {
          connections: {
            items: [
              {
                id: "conn-2",
                name: "Existing",
                dbType: "postgresql",
                host: "localhost",
                port: 5432,
                user: "u",
                database: "d",
                groupId: null,
                color: null,
                hasPassword: false,
                paradigm: "rdb",
              },
            ],
            groups: [],
          },
          workspaces: { byConnectionId: {} },
          mru: { recentConnections: [], lastUsedConnectionId: null },
          theme: { themeId: "default", mode: "system" },
          safeMode: { mode: "off" },
        },
        runtime: { activeStatuses: {} },
      };
    });

    await loadAllFromSnapshot();

    // Newer snapshotVersion, so it must dispatch once the snapshot applies.
    expect(onCrudChanged).toHaveBeenCalledTimes(1);
    expect(onCrudChanged).toHaveBeenCalledWith(
      "conn-2",
      expect.objectContaining({
        domain: "connection",
        op: "update",
        snapshotVersion: 2,
      }),
    );
  });

  it("drops a buffered event whose snapshotVersion is <= applied snapshot (already included)", async () => {
    // Edge case — when a buffered event is older than the applied snapshot
    // (snapshotVersion <= snap.snapshotVersion), the snapshot is already the
    // truth, so the event is dropped. Prevents double dispatch.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ connection: { onCrudChanged } });

    const { loadAllFromSnapshot } = await import("./loadAll");

    invokeMock.mockImplementationOnce(async () => {
      const stale: StateChangedPayload = {
        domain: "connection",
        op: "update",
        entityId: "conn-X",
        version: 1,
        snapshotVersion: 1, // same snapshot — already applied.
        originWindow: "launcher",
        emittedAt: 1_700_000_000_500,
      };
      __pushFakeBufferedEvent(stale);
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
          theme: { themeId: "default", mode: "system" },
          safeMode: { mode: "off" },
        },
        runtime: { activeStatuses: {} },
      };
    });

    await loadAllFromSnapshot();

    // The snapshot is already the truth — an event with the same
    // snapshotVersion is dropped.
    expect(onCrudChanged).not.toHaveBeenCalled();
  });
});

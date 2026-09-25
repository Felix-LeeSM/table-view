// Written 2026-05-16 — AC-367-05 snapshot fail path.
//
// On IPC reject:
//   1. Stores stay at their default (empty) state — no partial hydrate.
//   2. The user sees an error toast with a Retry action button.
//   3. The listener stays registered (events can apply after the next
//      retry).
//   4. The orchestrator re-throws the reject so the caller (main.tsx) sees
//      it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useConnectionStore } from "@stores/connectionStore";
import { useToastStore } from "@stores/toastStore";
import {
  isSnapshotBufferActive,
  loadAllFromSnapshot,
  resetSnapshotBufferForTests,
} from "./loadAll";

describe("AC-367-05 snapshot failure path", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
    useConnectionStore.setState({
      connections: [],
      groups: [],
      activeStatuses: {},
      focusedConnId: null,
      hasLoadedOnce: false,
      loading: false,
      error: null,
    });
    resetSnapshotBufferForTests();
  });

  it("propagates the IPC rejection so callers can fall back", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db locked"));

    await expect(loadAllFromSnapshot()).rejects.toThrow(/db locked/);
  });

  it("leaves boot-critical stores at their defaults (no partial hydrate)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db locked"));

    await loadAllFromSnapshot().catch(() => {
      /* expected — see test above */
    });

    const conn = useConnectionStore.getState();
    expect(conn.connections).toEqual([]);
    expect(conn.groups).toEqual([]);
    expect(conn.activeStatuses).toEqual({});
  });

  it("pushes an error toast with a Retry action so the user can recover", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db locked"));

    await loadAllFromSnapshot().catch(() => undefined);

    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    const t = toasts[0]!;
    expect(t.variant).toBe("error");
    // F.2 spec: the message is a user-readable sentence such as
    // "snapshot load failed".
    expect(t.message).toMatch(/snapshot|load failed|boot/i);
    expect(t.action).toBeDefined();
    expect(t.action?.label.toLowerCase()).toContain("retry");
    expect(typeof t.action?.onClick).toBe("function");
  });

  it("keeps the listener buffer enabled so a Retry can drain race-window events", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db locked"));

    expect(isSnapshotBufferActive()).toBe(false); // before call
    await loadAllFromSnapshot().catch(() => undefined);
    // On failure the buffer is ON again — when Retry runs, race-window
    // events must be caught again. The orchestrator re-activates the buffer
    // after a failure.
    expect(isSnapshotBufferActive()).toBe(true);
  });
});

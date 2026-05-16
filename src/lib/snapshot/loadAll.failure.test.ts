// 작성 2026-05-16 (Phase 4 sprint-367) — AC-367-05 snapshot fail path.
//
// IPC reject 시:
//   1. store 는 default (빈) 상태 유지 — partial hydrate 0.
//   2. 사용자에게 error toast 노출 + Retry action button.
//   3. listener 는 등록된 채로 유지 (다음 retry 후 적용 가능).
//   4. orchestrator 가 reject 를 throw 해서 caller (main.tsx) 가 인지.

import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  loadAllFromSnapshot,
  resetSnapshotBufferForTests,
  isSnapshotBufferActive,
} from "./loadAll";
import { useConnectionStore } from "@stores/connectionStore";
import { useToastStore } from "@lib/toast";

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
    // F.2 spec: message 는 "snapshot load failed" 같은 사용자-가독 문장.
    expect(t.message).toMatch(/snapshot|load failed|boot/i);
    expect(t.action).toBeDefined();
    expect(t.action?.label.toLowerCase()).toContain("retry");
    expect(typeof t.action?.onClick).toBe("function");
  });

  it("keeps the listener buffer enabled so a Retry can drain race-window events", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Storage error: db locked"));

    expect(isSnapshotBufferActive()).toBe(false); // before call
    await loadAllFromSnapshot().catch(() => undefined);
    // failure 시 buffer 는 다시 ON — Retry 가 호출되면 race-window event 가
    // 다시 잡혀야 함. orchestrator 는 fail 후 buffer 를 새로 활성화한다.
    expect(isSnapshotBufferActive()).toBe(true);
  });
});

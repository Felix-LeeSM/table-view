// 작성 2026-05-16 (Phase 4 sprint-367) — AC-367-03 + AC-367-04 검증.
//
// AC-367-03 (정적): boot 시퀀스 코드에서 `listen("state-changed", …)` 등록 line 이
// `getInitialAppState(` 호출 line 보다 위에 와야 한다. codex 2차 #12 의 strict
// 순서 — listener 가 IPC 이전에 등록되어야 snapshot 적용 직전에 발생한 backend
// emit 도 buffer 에 잡힌다. 코드 grep 으로 line 번호 비교.
//
// AC-367-04 (동작): state-changed listener 가 snapshot IPC 보다 먼저 등록된 상태에서
// `loadAllFromSnapshot` 호출 → IPC 응답 전에 fake `state-changed` event 가 발생하면
// snapshot 적용 후 그 event 가 한 번만 dispatch 된다 (snapshotVersion 기준 dedup).
//
// 두 시나리오 모두 boot orchestrator 의 핵심 invariant — listener 가 살아있는 채로
// snapshot 이 인-플라이트인 race window 를 안전하게 buffer 해야 한다.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  resetSnapshotBufferForTests,
  __pushFakeBufferedEvent,
} from "./loadAll";
import {
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
  type StateChangedPayload,
} from "@lib/events/stateChanged";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("AC-367-03 listener pre-register (static grep)", () => {
  it("listener registration line precedes getInitialAppState call line in loadAll.ts", () => {
    // boot orchestrator 의 source 를 직접 읽고 line 비교 — runtime 추적이 아니라
    // 코드 자체의 강제 ordering 을 회귀 방지. 의도적으로 한 파일에서 두
    // 라인을 모두 읽어 동일 모듈의 시퀀스만 검증한다 (cross-module 분리는
    // 더 엄격하지만 codex 권고는 한 boot path 내 strict 순서).
    const source = readFileSync(resolve(__dirname, "loadAll.ts"), "utf8");
    const lines = source.split("\n");
    // `listen("state-changed"` substring 이 등장하는 첫 줄을 찾는다.
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
    // 시나리오:
    //   1. boot orchestrator 가 listener 를 등록 (buffer 모드 ON).
    //   2. IPC 호출 → 50ms 후 resolve.
    //   3. 응답 직전 backend 가 `state-changed` (snapshotVersion=2) emit →
    //      listener 가 buffer 에 쌓음.
    //   4. snapshot (snapshotVersion=1) 적용 후 buffer drain — event 가
    //      domain handler 로 정확히 1회 dispatch.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged },
    });

    const { loadAllFromSnapshot } = await import("./loadAll");

    invokeMock.mockImplementationOnce(async (cmd: string) => {
      expect(cmd).toBe("get_initial_app_state");
      // IPC 가 in-flight 인 동안 backend 가 더 최신 event 를 emit 한 상황을
      // 시뮬레이트한다. listener 는 buffer 에 쌓아야 한다.
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

    // newer snapshotVersion 이므로 적용 후 dispatch 되어야 한다.
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
    // Edge case — buffer 에 쌓인 event 가 적용된 snapshot 보다 오래된 경우
    // (snapshotVersion <= snap.snapshotVersion) snapshot 이 이미 truth 이므로
    // 그 event 는 drop. 중복 dispatch 방지.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ connection: { onCrudChanged } });

    const { loadAllFromSnapshot } = await import("./loadAll");

    invokeMock.mockImplementationOnce(async () => {
      const stale: StateChangedPayload = {
        domain: "connection",
        op: "update",
        entityId: "conn-X",
        version: 1,
        snapshotVersion: 1, // 동일 snapshot — 이미 적용됨.
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

    // snapshot 이 이미 truth — 같은 snapshotVersion 의 event 는 drop.
    expect(onCrudChanged).not.toHaveBeenCalled();
  });
});

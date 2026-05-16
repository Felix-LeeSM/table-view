/**
 * 작성 2026-05-17 (Phase 5 sprint-372) — queryHistoryStore 의 thin-wrapper
 * 신규 field/action (`recentVisible`, `addOptimisticEntry`, `setRecentVisible`)
 * lock. 기존 `entries` / `globalLog` 는 sprint-373 가 retire 할 때까지
 * 변형 없이 유지된다 (Out of Scope).
 *
 * 사유: 본 sprint 의 store 는 backend single source 로 가는 전환 단계의
 * 얇은 wrapper — visible list 를 hook 이 fetch 해서 `setRecentVisible` 로
 * 넣고, write path 는 `addOptimisticEntry` 가 optimistic prepend + IPC
 * fire 한다. backend self-echo skip 은 sprint-365 dispatcher 책임이라
 * 본 store 는 두 번 prepend 하지 않는다 — 본 테스트는 그 두 action 의
 * shape 만 잠근다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useQueryHistoryStore } from "./queryHistoryStore";

describe("queryHistoryStore thin-wrapper (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useQueryHistoryStore.setState({
      entries: [],
      globalLog: [],
      searchFilter: "",
      connectionFilter: null,
      recentVisible: [],
    });
  });

  // recentVisible 초기 상태 — 외부 caller 가 본 slot 을 list IPC 결과로
  // 채우기 전에는 빈 배열이어야 한다 (UI 기본 표시 무영향).
  // 작성 2026-05-17. 사유: 신규 slot 의 default 가 store 단에서 깔끔하게
  // 비어 있어야 hook subscriber 의 mount 직후 렌더 cycle 이 안 깨진다.
  it("recentVisible defaults to an empty array", () => {
    expect(useQueryHistoryStore.getState().recentVisible).toEqual([]);
  });

  // setRecentVisible — list_history 응답을 store 에 그대로 받는 경로.
  // 작성 2026-05-17. 사유: hook 이 fetch 하면 store 에 publish, 다른
  // subscriber (예: badge 뱃지) 가 같은 truth 를 본다.
  it("setRecentVisible replaces the slot atomically", () => {
    const rows = [
      {
        id: 1,
        connectionId: "c-1",
        paradigm: "rdb" as const,
        queryMode: "sql",
        source: "raw",
        sqlRedacted: "SELECT ?",
        status: "success",
        durationMs: 5,
        executedAt: 1_700_000_000_000,
      },
    ];
    useQueryHistoryStore.getState().setRecentVisible(rows);
    expect(useQueryHistoryStore.getState().recentVisible).toEqual(rows);
    // 동일 length 의 다른 배열로 replace — atomicity 확인 (concat 이 아님).
    useQueryHistoryStore.getState().setRecentVisible([]);
    expect(useQueryHistoryStore.getState().recentVisible).toEqual([]);
  });

  // addOptimisticEntry — optimistic prepend + IPC fire path.
  // 작성 2026-05-17. 사유: backend round-trip 을 기다리지 않고 사용자가
  // 즉시 새 entry 를 보도록 한다. IPC 응답 후 temp id 가 진짜 id 로 교체.
  it("addOptimisticEntry prepends optimistically then patches id from IPC", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 42,
      executedAt: 1_700_000_000_000,
      sqlRedacted: "SELECT ?",
    });

    await useQueryHistoryStore.getState().addOptimisticEntry({
      connectionId: "c-1",
      paradigm: "rdb",
      queryMode: "sql",
      source: "raw",
      sql: "SELECT 1",
      status: "success",
      durationMs: 5,
      executedAt: 1_700_000_000_000,
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith(
      "add_history_entry",
      expect.objectContaining({
        req: expect.objectContaining({
          connectionId: "c-1",
          paradigm: "rdb",
          queryMode: "sql",
          sql: "SELECT 1",
        }),
      }),
    );

    const visible = useQueryHistoryStore.getState().recentVisible;
    expect(visible).toHaveLength(1);
    const first = visible[0]!;
    // 패치된 id 가 backend 가 준 id 와 일치.
    expect(first.id).toBe(42);
    // backend 가 redact 한 형태가 반영됨 (raw sql 이 redacted 로 덮어짐).
    expect(first.sqlRedacted).toBe("SELECT ?");
  });

  // IPC reject — best-effort. row 는 그대로 두고 다음 refetch 에 의존.
  // 작성 2026-05-17. 사유: backend Validation 에 의한 reject 시에도 UI 가
  // 깨지지 않고, 잠시 후 list refetch 가 truth 를 다시 잡는다.
  it("addOptimisticEntry tolerates backend rejection (rows untouched)", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Validation"));

    await useQueryHistoryStore.getState().addOptimisticEntry({
      connectionId: "c-1",
      paradigm: "rdb",
      queryMode: "sql",
      source: "raw",
      sql: "SELECT 1",
      status: "success",
      durationMs: 5,
      executedAt: 1_700_000_000_000,
    });

    // optimistic row 가 그대로 남아 있음 (다음 refetch 가 정정).
    const visible = useQueryHistoryStore.getState().recentVisible;
    expect(visible).toHaveLength(1);
    // 음수 temp id — backend 응답을 못 받았다는 marker.
    expect(visible[0]?.id).toBeLessThan(0);
  });

  // 기존 `entries` / `globalLog` 는 sprint-373 의 retire 책임 — 본 sprint
  // 에서 건드리지 않음. 회귀 가드로 한 케이스만 박는다.
  // 작성 2026-05-17. 사유: Out of Scope 위반 회귀 방지 (refactor 가
  // 의도치 않게 legacy field 를 함께 깨면 알람).
  it("legacy addHistoryEntry still pushes to entries + globalLog (sprint-373 retire)", () => {
    useQueryHistoryStore.getState().addHistoryEntry({
      sql: "SELECT 1",
      executedAt: 1,
      duration: 5,
      status: "success",
      connectionId: "c-1",
    });
    const state = useQueryHistoryStore.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.globalLog).toHaveLength(1);
    // recentVisible 은 legacy path 가 안 건드림 — backend 가 emit 한
    // history.create 가 dispatcher 를 거쳐 별도 refetch 트리거.
    expect(state.recentVisible).toEqual([]);
  });
});

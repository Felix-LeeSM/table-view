import { describe, it, expect, beforeEach, vi } from "vitest";

// 작성 2026-05-16 (Phase 4 W2→W3 sprint-370)
//
// 사유: mruStore 의 LS retire 이후 store 의 행동 contract 가
// "localStorage round-trip" 에서 "snapshot hydrate + IPC persist" 로 옮겨갔다.
// 본 파일은 Sprint 119/166/290 의 시나리오 의도 (recentConnections 의 head
// 이동 / cap 5 / removeRecentConnection / lastUsedConnectionId 재계산) 를
// 그대로 보존하면서, 영속 채널을 LS 가 아닌 `persist_mru` IPC 로 검사한다.
//
// loadPersistedMru 는 sprint-370 의 결정에 따라 no-op 으로 격하되었으므로
// 본 파일은 그 형태도 잠근다 — 호출 시 store 가 LS 를 만지지 않고 (legacy
// 인터페이스 호환만 유지).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { useMruStore, __resetMruStoreForTests, SYNCED_KEYS } from "./mruStore";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  __resetMruStoreForTests();
});

describe("mruStore", () => {
  it("starts with lastUsedConnectionId === null", () => {
    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("markConnectionUsed updates state and persists via persist_mru IPC", async () => {
    useMruStore.getState().markConnectionUsed("c1");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c1");

    // IPC fire-and-forget — flush microtasks.
    await Promise.resolve();
    const calls = invokeMock.mock.calls.filter((c) => c[0] === "persist_mru");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0]![1] as {
      entries: Array<{ connectionId: string; lastUsed: number }>;
    };
    expect(payload.entries).toHaveLength(1);
    expect(payload.entries[0]!.connectionId).toBe("c1");
    expect(typeof payload.entries[0]!.lastUsed).toBe("number");
  });

  it("markConnectionUsed overwrites previous value (most-recent wins)", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");

    expect(useMruStore.getState().lastUsedConnectionId).toBe("c2");
    const { recentConnections } = useMruStore.getState();
    expect(recentConnections[0]!.connectionId).toBe("c2");
    expect(recentConnections[1]!.connectionId).toBe("c1");
  });

  it("loadPersistedMru is a no-op after sprint-370 (snapshot SOT)", () => {
    // Sprint 370 — snapshot IPC is the sole hydration path. The function
    // survives as a no-op so existing boot effect call sites compile.
    const setItemSpy = vi.spyOn(window.localStorage, "setItem");
    const getItemSpy = vi.spyOn(window.localStorage, "getItem");

    useMruStore.getState().loadPersistedMru();

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(useMruStore.getState().recentConnections).toEqual([]);
    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
  });

  it("__resetMruStoreForTests clears in-memory state", () => {
    useMruStore.getState().markConnectionUsed("c-leak");

    __resetMruStoreForTests();

    expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
    expect(useMruStore.getState().recentConnections).toEqual([]);
  });

  // -- Sprint 153 (AC-153-06) — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys are broadcast on the
  // `mru-sync` channel. Adding a new key to `MruState` MUST be a deliberate
  // opt-in/opt-out decision — silently leaking a sensitive new field across
  // windows is the failure mode this regression guards against.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    // Reason: Sprint 166 added recentConnections to the sync allowlist (2026-04-28)
    it("exposes exactly the cross-window-synced keys", () => {
      expect([...SYNCED_KEYS]).toEqual([
        "lastUsedConnectionId",
        "recentConnections",
      ]);
    });
  });
});

// -- Sprint 166 — MRU list feature tests (Phase 16) --

describe("MRU list (Sprint 166)", () => {
  // Reason: Phase 16 AC-16-01 — markConnectionUsed adds entry to front of recentConnections (2026-04-28)
  it("adds entry to front of recentConnections", () => {
    useMruStore.getState().markConnectionUsed("c1");

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(1);
    expect(recentConnections[0]).toEqual({
      connectionId: "c1",
      lastUsed: expect.any(Number),
    });
  });

  // Reason: Phase 16 AC-16-02 — reusing an existing id moves it to front without duplicates (2026-04-28)
  it("moves existing entry to front on reuse (no duplicates)", () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");
    useMruStore.getState().markConnectionUsed("c3");

    // Reuse c1 — should move to front, not add a duplicate
    useMruStore.getState().markConnectionUsed("c1");

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(3);
    expect(recentConnections[0]!.connectionId).toBe("c1");
    expect(recentConnections[1]!.connectionId).toBe("c3");
    expect(recentConnections[2]!.connectionId).toBe("c2");

    // No duplicate ids
    const ids = recentConnections.map((e) => e.connectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Reason: Phase 16 AC-16-03 — list caps at 5 entries, oldest removed (2026-04-28)
  it("caps list at 5 entries, removing oldest", () => {
    for (let i = 1; i <= 7; i++) {
      useMruStore.getState().markConnectionUsed(`c${i}`);
    }

    const { recentConnections } = useMruStore.getState();
    expect(recentConnections).toHaveLength(5);
    // Most recent first: c7, c6, c5, c4, c3
    expect(recentConnections[0]!.connectionId).toBe("c7");
    expect(recentConnections[4]!.connectionId).toBe("c3");
    // c1 and c2 should have been evicted
    const ids = recentConnections.map((e) => e.connectionId);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("c2");
  });

  // Sprint 370 — IPC mirror replaces the old localStorage JSON.
  it("ships recentConnections to persist_mru IPC", async () => {
    useMruStore.getState().markConnectionUsed("c1");
    useMruStore.getState().markConnectionUsed("c2");
    await Promise.resolve();

    const calls = invokeMock.mock.calls.filter((c) => c[0] === "persist_mru");
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const lastPayload = calls[calls.length - 1]![1] as {
      entries: Array<{ connectionId: string; lastUsed: number }>;
    };
    expect(lastPayload.entries.map((e) => e.connectionId)).toEqual([
      "c2",
      "c1",
    ]);
  });

  // 작성 이유 (2026-05-13, Sprint 290): 사용자 요구 — recent 항목을 개별
  // 삭제할 수 있어야 함. mruStore.removeRecentConnection 액션을 추가했고,
  // 본 회귀 가드는 (a) 정상 제거 + 영속 IPC (b) 미존재 id 무변경
  // (c) lastUsedConnectionId 재계산 (d) 빈 리스트 → null 을 단언한다.
  describe("removeRecentConnection (Sprint 290)", () => {
    it("기존 항목을 제거하고 persist_mru IPC 에 반영한다", async () => {
      const store = useMruStore.getState();
      store.markConnectionUsed("c1");
      store.markConnectionUsed("c2");
      invokeMock.mockClear();

      useMruStore.getState().removeRecentConnection("c1");
      await Promise.resolve();

      const { recentConnections } = useMruStore.getState();
      expect(recentConnections.map((e) => e.connectionId)).toEqual(["c2"]);
      const calls = invokeMock.mock.calls.filter((c) => c[0] === "persist_mru");
      expect(calls.length).toBe(1);
      const payload = calls[0]![1] as {
        entries: Array<{ connectionId: string }>;
      };
      expect(payload.entries.map((e) => e.connectionId)).toEqual(["c2"]);
    });

    it("미존재 id 호출은 state 를 변경하지 않는다", () => {
      const store = useMruStore.getState();
      store.markConnectionUsed("c1");
      const before = useMruStore.getState().recentConnections;
      useMruStore.getState().removeRecentConnection("nope");
      const after = useMruStore.getState().recentConnections;
      expect(after).toBe(before);
    });

    it("head 항목 제거 시 lastUsedConnectionId 가 새 head 로 재계산된다", () => {
      const store = useMruStore.getState();
      store.markConnectionUsed("c1");
      store.markConnectionUsed("c2");
      useMruStore.getState().removeRecentConnection("c2");

      expect(useMruStore.getState().lastUsedConnectionId).toBe("c1");
    });

    it("모든 항목 제거 시 lastUsedConnectionId 는 null", () => {
      const store = useMruStore.getState();
      store.markConnectionUsed("c1");
      useMruStore.getState().removeRecentConnection("c1");

      expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
      expect(useMruStore.getState().recentConnections).toHaveLength(0);
    });
  });
});

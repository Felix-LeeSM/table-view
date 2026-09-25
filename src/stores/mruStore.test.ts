import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Written 2026-05-16 (state-management-strategy Phase 4 W2→W3)
//
// Reason: after mruStore's LS retirement, the store's behavior contract moved
// from "localStorage round-trip" to "snapshot hydrate + IPC persist". This
// file keeps the scenario intent (moving an entry to the recentConnections
// head / cap 5 / removeRecentConnection / lastUsedConnectionId recompute) and
// checks the persistence channel through the `persist_mru` IPC instead of LS.
//
// loadPersistedMru was demoted to a no-op, so this file locks that shape too —
// when called, the store does not touch LS (it only keeps the legacy interface
// compatible).

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { __resetMruStoreForTests, SYNCED_KEYS, useMruStore } from "./mruStore";

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  __resetMruStoreForTests();
});

describe("mruStore", () => {
  it("keeps store IPC behind the typed Tauri wrapper", () => {
    const src = readFileSync(resolve(__dirname, "mruStore.ts"), "utf-8");

    expect(src).not.toContain("@tauri-apps/api/core");
  });

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
    // The snapshot IPC is the sole hydration path. The function survives as
    // a no-op so existing boot effect call sites compile.
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

  // -- AC-153-06 — cross-window broadcast allowlist regression --
  //
  // `SYNCED_KEYS` pins which top-level state keys are broadcast on the
  // `mru-sync` channel. Adding a new key to `MruState` MUST be a deliberate
  // opt-in/opt-out decision — silently leaking a sensitive new field across
  // windows is the failure mode this regression guards against.
  describe("SYNCED_KEYS allowlist (AC-153-06)", () => {
    // Reason: recentConnections joined the sync allowlist (2026-04-28)
    it("exposes exactly the cross-window-synced keys", () => {
      expect([...SYNCED_KEYS]).toEqual([
        "lastUsedConnectionId",
        "recentConnections",
      ]);
    });
  });
});

// -- MRU list feature tests (Phase 16) --

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

  // The IPC mirror replaces the old localStorage JSON.
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

  // Reason (2026-05-13): user request — recent entries must be removable one
  // at a time. The mruStore.removeRecentConnection action was added for this,
  // and this regression guard asserts (a) normal removal + persistence IPC
  // (b) no change for an unknown id (c) lastUsedConnectionId recompute
  // (d) empty list → null.
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

  // Reason (2026-08-18, #2433): the only place that locked the `clear_mru`
  // wire shape was AC-376-08 in `src/pages/HomePage.reset-affordance.test.tsx`,
  // but #2433 moved that button from the launcher action bar to the end of the
  // Recent list, so the button left the HomePage tree. The lock moves to the
  // store that owns the action — the same axis the `removeRecentConnection`
  // block above covers for `persist_mru`.
  describe("clearRecentConnections (#2433 — wire lock 이관)", () => {
    it("목록을 비우고 clear_mru IPC 를 1회 발사한다", async () => {
      const store = useMruStore.getState();
      store.markConnectionUsed("c1");
      store.markConnectionUsed("c2");
      invokeMock.mockClear();

      useMruStore.getState().clearRecentConnections();
      await Promise.resolve();

      expect(useMruStore.getState().recentConnections).toEqual([]);
      expect(useMruStore.getState().lastUsedConnectionId).toBeNull();
      expect(
        invokeMock.mock.calls.filter((c) => c[0] === "clear_mru"),
      ).toHaveLength(1);
    });

    it("이미 비어 있어도 IPC 는 나간다 (다른 창의 잔여 row 정리 — idempotent)", async () => {
      useMruStore.getState().clearRecentConnections();
      await Promise.resolve();

      expect(
        invokeMock.mock.calls.filter((c) => c[0] === "clear_mru"),
      ).toHaveLength(1);
    });
  });
});

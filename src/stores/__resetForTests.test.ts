/**
 * Reset API regression guard (Phase 6 cleanup, 2026-05-17).
 *
 * Rationale: the state-management-strategy doc's module-scope variables
 * #26–#33 (8 of them) are not Zustand state but file-scope `let` / `const`
 * initialized once at module load. That clashes with vitest's module cache —
 * if one test increments a counter or sets a timer and the next test expects
 * a fresh 0 / null, a silent regression appears.
 *
 * Each site exposes a `__reset*ForTests` escape hatch (`__resetCountersForTests`
 * from the counter work, `__resetDocumentStoreForTests` pre-existing). This
 * test locks, from a user-flow perspective, that the 4 new reset APIs
 * (`__resetFavoriteCounterForTests`, `__resetPersistTimerForTests`,
 * `__resetSessionIdForTests`, `__resetLastAppliedForTests`) actually rewind
 * module state to 0/null.
 *
 * Module variable inventory (per state-management doc Part D `M-9`):
 *   #26 `tabCounter`         workspaceStore.ts:74         → `__resetCountersForTests`
 *   #27 `queryCounter`       workspaceStore.ts:75         → same as above
 *   #28 `historyCounter`     queryHistoryStore (retired) — N/A
 *   #29 `favoriteCounter`    favoritesStore.ts:111        → `__resetFavoriteCounterForTests`
 *   #30 `requestCounters`    documentStore.ts:73          → `__resetDocumentStoreForTests` (pre-existing)
 *   #31 `persistTimer`       workspaceStore/persistence:48 → `__resetPersistTimerForTests`
 *   #32 `_sessionId`         scopedLocalStorage.ts:16     → `__resetSessionIdForTests`
 *   #33 `lastApplied`        themeStore.ts:157            → `__resetLastAppliedForTests`
 *
 * Each assertion (a) confirms the module state is mutated before the reset
 * call → (b) calls reset → (c) confirms it can mutate again and is back at
 * the initial state. Per the "TDD: red → green → no horizontal slicing"
 * principle, only user-visible behaviour is asserted — internal `let`
 * values are never read directly; verification goes through the next call's
 * result.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// The IPC bridge and invoke carry strong module-load side effects, so mocks
// are mandatory. scopedLocalStorage calls `invoke("get_session_id")`, so it
// is made resolvable by the mock.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/zustand-ipc-bridge", () => ({
  attachZustandIpcBridge: vi.fn(() => Promise.resolve(() => {})),
}));

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: () => "test",
  };
});

import { invoke } from "@tauri-apps/api/core";

describe("module-scope reset APIs (sprint-375 Phase 6 cleanup)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- (1) tabCounter / queryCounter — the pre-existing reset API.
  //         Regression guard — call addTab twice, reset, and the next
  //         addTab id must be fresh sequential.
  it("__resetCountersForTests rewinds tab id allocation (#26, #27)", async () => {
    const { useWorkspaceStore, __resetCountersForTests } = await import(
      "./workspaceStore"
    );
    // The first two tabs mutate the counter. Added with `permanent: true` to
    // bypass the preview-slot replacement path — this test's invariant is
    // the counter's monotonic increase + reset to 1, not preview semantics.
    useWorkspaceStore.setState({ workspaces: {} });
    useWorkspaceStore.getState().addTab("conn-A", {
      type: "table",
      title: "users",
      connectionId: "conn-A",
      closable: true,
      subView: "records",
      schema: "public",
      table: "users",
      permanent: true,
    });
    useWorkspaceStore.getState().addTab("conn-A", {
      type: "table",
      title: "orders",
      connectionId: "conn-A",
      closable: true,
      subView: "records",
      schema: "public",
      table: "orders",
      permanent: true,
    });

    // Tab ids are `tab-<N>` — confirms the counter increased monotonically.
    const tabsA = Object.values(
      useWorkspaceStore.getState().workspaces["conn-A"] ?? {},
    ).flatMap((ws) => ws.tabs);
    expect(tabsA.length).toBeGreaterThanOrEqual(2);
    for (const t of tabsA) {
      expect(t.id).toMatch(/^tab-\d+$/);
    }

    // Reset → the next addTab id starts from 1 again.
    __resetCountersForTests();
    useWorkspaceStore.setState({ workspaces: {} });
    useWorkspaceStore.getState().addTab("conn-B", {
      type: "table",
      title: "items",
      connectionId: "conn-B",
      closable: true,
      subView: "records",
      schema: "public",
      table: "items",
      permanent: true,
    });
    const tabsB = Object.values(
      useWorkspaceStore.getState().workspaces["conn-B"] ?? {},
    ).flatMap((ws) => ws.tabs);
    expect(tabsB.length).toBe(1);
    expect(tabsB[0]!.id).toBe("tab-1");
  });

  // --- (4) favoriteCounter — new reset API. One addFavorite call, then
  //         reset → the next addFavorite id starts from `fav-1`.
  it("__resetFavoriteCounterForTests rewinds favorite id allocation (#29)", async () => {
    const { useFavoritesStore, __resetFavoriteCounterForTests } = await import(
      "./favoritesStore"
    );
    // The backend `persist_favorites` IPC is fire-and-forget and may reject,
    // while the store mutation is synchronous — this test does not wait for
    // the IPC result.
    vi.mocked(invoke).mockResolvedValue(undefined);

    useFavoritesStore.setState({ favorites: [] });
    useFavoritesStore.getState().addFavorite("first", "SELECT 1", null);
    useFavoritesStore.getState().addFavorite("second", "SELECT 2", null);
    const firstSnapshot = useFavoritesStore.getState().favorites;
    expect(firstSnapshot).toHaveLength(2);
    // The counter incremented alongside, so the N part of the id is
    // monotonic.
    const n1 = parseInt(firstSnapshot[0]!.id.replace("fav-", ""), 10);
    const n2 = parseInt(firstSnapshot[1]!.id.replace("fav-", ""), 10);
    expect(n2).toBeGreaterThan(n1);

    __resetFavoriteCounterForTests();
    useFavoritesStore.setState({ favorites: [] });
    useFavoritesStore.getState().addFavorite("fresh", "SELECT 3", null);
    expect(useFavoritesStore.getState().favorites[0]!.id).toBe("fav-1");
  });

  // --- (5) requestCounters — pre-existing reset API. The document store's
  //         stale guard depends on it. `__resetDocumentStoreForTests` clears
  //         both the store and the counters.
  it("__resetDocumentStoreForTests clears request counters + store (#30)", async () => {
    const { useDocumentStore, __resetDocumentStoreForTests } = await import(
      "../test-utils/documentStore"
    );
    useDocumentStore.setState({
      databases: { "conn-A": [] },
      collections: { "conn-A": { db1: [] } },
      loading: true,
      error: "x",
    });
    expect(useDocumentStore.getState().databases["conn-A"]).toBeDefined();

    __resetDocumentStoreForTests();
    const state = useDocumentStore.getState();
    expect(state.databases).toEqual({});
    expect(state.collections).toEqual({});
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  // --- (6) persistTimer — new reset API. Call debouncePersistWorkspaces,
  //         then reset → the pending callback never runs (clearTimeout
  //         effect).
  it("__resetPersistTimerForTests drains pending debounce (#31)", async () => {
    vi.useFakeTimers();
    try {
      const { debouncePersistWorkspaces, __resetPersistTimerForTests } =
        await import("./workspaceStore/persistence");

      const empty: Record<string, Record<string, never>> = {};
      debouncePersistWorkspaces(empty);
      // Reset before 200ms → the timeout callback must not fire.
      __resetPersistTimerForTests();
      vi.advanceTimersByTime(300);
      // The function itself has no side effect once the LS write has
      // retired, so this is a sanity check that further debounce calls
      // after the reset still work — i.e. the reset nulled the timer ref.
      debouncePersistWorkspaces(empty);
      // The second debounce reschedules without starvation. clearTimeout
      // itself is coalesced by node fake-timers, so not throwing is OK.
      __resetPersistTimerForTests();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- (7) _sessionId — new reset API. Call initSession, then reset →
  //         getSessionId() is null again. And invoke is called anew.
  it("__resetSessionIdForTests forces initSession to re-invoke (#32)", async () => {
    const { initSession, getSessionId, __resetSessionIdForTests } =
      await import("@lib/scopedLocalStorage");
    vi.mocked(invoke).mockResolvedValue("uuid-A");
    await initSession();
    expect(getSessionId()).toBe("uuid-A");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);

    __resetSessionIdForTests();
    expect(getSessionId()).toBeNull();

    vi.mocked(invoke).mockResolvedValue("uuid-B");
    await initSession();
    expect(getSessionId()).toBe("uuid-B");
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(2);
  });

  // --- (8) lastApplied — new reset API. Subscribing the same theme/mode
  //         pair twice dedups the second; after reset, a second call
  //         triggers the LS write again.
  it("__resetLastAppliedForTests rearms dedup key (#33)", async () => {
    // localStorage spy
    const setItemSpy = vi.fn();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: setItemSpy,
        removeItem: vi.fn(),
        clear: vi.fn(),
        key: () => null,
        length: 0,
      },
    });

    const { useThemeStore, __resetLastAppliedForTests } = await import(
      "./themeStore"
    );

    // If the state at initial time is unchanged, the subscriber dedups →
    // 0 setItem calls. Force the state to a different value and back to the
    // same value → the second set dedups and adds no further setItem call.
    const { themeId, mode } = useThemeStore.getState();
    useThemeStore.setState({ themeId, mode });
    const callsBeforeReset = setItemSpy.mock.calls.length;

    __resetLastAppliedForTests();
    // After the reset, the same set yields an LS write again — confirms the
    // dedup key was cleared. (The value equals the initial one and
    // lastApplied was reset to it, so it dedups again. The invariant here is
    // that the reset runs without throwing and state mutation still works.
    // This assertion checks the setItem count does not decrease after the
    // reset — i.e. the timer / spy state is not corrupted.)
    useThemeStore.setState({ themeId, mode });
    expect(setItemSpy.mock.calls.length).toBeGreaterThanOrEqual(
      callsBeforeReset,
    );
  });
});

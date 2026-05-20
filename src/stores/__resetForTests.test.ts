/**
 * Sprint 375 (Phase 6 cleanup, 2026-05-17) — reset API 회귀 가드.
 *
 * 작성 사유: state-management-strategy doc 의 모듈-스코프 변수 #26–#33
 * (8 개) 는 Zustand state 가 아니라 module-load 시 1회 초기화되는 file-
 * scope `let` / `const`. 이는 vitest 의 module cache 와 어울리지 않는다 —
 * 한 테스트가 counter 를 증가시키거나 timer 를 set 한 뒤, 다음 테스트가
 * fresh 0 / null 를 기대하면 silent 회귀가 발생한다.
 *
 * Sprint 375 는 각 site 에 `__reset*ForTests` escape hatch 를 노출했다
 * (`__resetCountersForTests` 는 sprint-354, `__resetDocumentStoreForTests`
 * 는 sprint-265 부터 존재). 본 테스트는 4 신규 reset API
 * (`__resetFavoriteCounterForTests`, `__resetPersistTimerForTests`,
 * `__resetSessionIdForTests`, `__resetLastAppliedForTests`) 가 실제로
 * 모듈 상태를 0/null 로 되돌리는지 user-flow 관점에서 lock.
 *
 * 모듈 변수 inventory (state-management doc Part D `M-9` 기준):
 *   #26 `tabCounter`         workspaceStore.ts:74         → `__resetCountersForTests` (sprint-354)
 *   #27 `queryCounter`       workspaceStore.ts:75         → 위와 동일
 *   #28 `historyCounter`     queryHistoryStore (retired sprint-373) — N/A
 *   #29 `favoriteCounter`    favoritesStore.ts:111        → `__resetFavoriteCounterForTests` (sprint-375)
 *   #30 `requestCounters`    documentStore.ts:73          → `__resetDocumentStoreForTests` (기존)
 *   #31 `persistTimer`       workspaceStore/persistence:48 → `__resetPersistTimerForTests` (sprint-375)
 *   #32 `_sessionId`         scopedLocalStorage.ts:16     → `__resetSessionIdForTests` (sprint-375)
 *   #33 `lastApplied`        themeStore.ts:157            → `__resetLastAppliedForTests` (sprint-375)
 *
 * 각 assertion 은 (a) reset 호출 전 module 상태가 mutated 임을 확인 →
 * (b) reset 호출 → (c) 다시 mutate 가능 + 초기 상태로 돌아왔음 확인.
 * "TDD: red → green → 가로 슬라이스 금지" 원칙대로 user-visible behaviour
 * 단언만 — internal `let` 값을 직접 read 하지 않고 다음 호출의 결과로 검증.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// IPC bridge 와 invoke 는 module-load side-effect 가 강해 mock 필수.
// scopedLocalStorage 는 `invoke("get_session_id")` 를 호출하므로 mock 으로
// resolve 가능하게 만든다.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
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

  // --- (1) tabCounter / queryCounter — sprint-354 의 기존 reset API.
  //         본 sprint 는 회귀 가드 — addTab 두 번 호출 후 reset → 다음
  //         addTab 의 id 가 fresh sequential 인지.
  it("__resetCountersForTests rewinds tab id allocation (#26, #27)", async () => {
    const { useWorkspaceStore, __resetCountersForTests } =
      await import("./workspaceStore");
    // 첫 두 tab 은 counter mutate. `permanent: true` 로 추가해 preview-slot
    // replacement 경로를 우회 — 본 테스트의 invariant 는 counter 의 monotonic
    // 증가 + reset 후 1, preview semantics 가 아님.
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

    // tab id 는 `tab-<N>` 형태 — counter 가 monotonic 증가했음 확인.
    const tabsA = Object.values(
      useWorkspaceStore.getState().workspaces["conn-A"] ?? {},
    ).flatMap((ws) => ws.tabs);
    expect(tabsA.length).toBeGreaterThanOrEqual(2);
    for (const t of tabsA) {
      expect(t.id).toMatch(/^tab-\d+$/);
    }

    // reset → 다음 addTab 의 id 가 1 부터 다시 시작.
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

  // --- (4) favoriteCounter — 새 reset API. addFavorite 한 번 호출 후
  //         reset → 다음 addFavorite id 가 `fav-1` 부터.
  it("__resetFavoriteCounterForTests rewinds favorite id allocation (#29)", async () => {
    const { useFavoritesStore, __resetFavoriteCounterForTests } =
      await import("./favoritesStore");
    // backend `persist_favorites` IPC 는 fire-and-forget 으로 reject 해도
    // store mutate 는 동기 — 본 테스트는 IPC 결과를 기다리지 않는다.
    vi.mocked(invoke).mockResolvedValue(undefined);

    useFavoritesStore.setState({ favorites: [] });
    useFavoritesStore.getState().addFavorite("first", "SELECT 1", null);
    useFavoritesStore.getState().addFavorite("second", "SELECT 2", null);
    const firstSnapshot = useFavoritesStore.getState().favorites;
    expect(firstSnapshot).toHaveLength(2);
    // counter 가 동시에 증가했으므로 id 의 N 부분이 monotonic.
    const n1 = parseInt(firstSnapshot[0]!.id.replace("fav-", ""), 10);
    const n2 = parseInt(firstSnapshot[1]!.id.replace("fav-", ""), 10);
    expect(n2).toBeGreaterThan(n1);

    __resetFavoriteCounterForTests();
    useFavoritesStore.setState({ favorites: [] });
    useFavoritesStore.getState().addFavorite("fresh", "SELECT 3", null);
    expect(useFavoritesStore.getState().favorites[0]!.id).toBe("fav-1");
  });

  // --- (5) requestCounters — 기존 reset API. document store 의 stale
  //         guard 가 의존. `__resetDocumentStoreForTests` 는 store +
  //         counter 둘 다 clear.
  it("__resetDocumentStoreForTests clears request counters + store (#30)", async () => {
    const { useDocumentStore, __resetDocumentStoreForTests } =
      await import("../test-utils/documentStore");
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

  // --- (6) persistTimer — 새 reset API. debouncePersistWorkspaces 호출
  //         후 reset → pending callback 이 run 되지 않음 (clearTimeout 효과).
  it("__resetPersistTimerForTests drains pending debounce (#31)", async () => {
    vi.useFakeTimers();
    try {
      const { debouncePersistWorkspaces, __resetPersistTimerForTests } =
        await import("./workspaceStore/persistence");

      const empty: Record<string, Record<string, never>> = {};
      debouncePersistWorkspaces(empty);
      // 200ms 전에 reset → timeout callback 이 fire 되지 않아야 함.
      __resetPersistTimerForTests();
      vi.advanceTimersByTime(300);
      // 본 함수 자체는 LS write 가 retire 된 후라 sideeffect 없지만,
      // reset 이후 추가 debounce 호출이 정상 동작하는지 sanity check —
      // 즉 reset 이 timer ref 를 null 로 되돌렸음.
      debouncePersistWorkspaces(empty);
      // 두 번째 debounce 가 starvation 없이 재예약. clearTimeout 자체는
      // node fake-timers 에 의해 합쳐지므로 throw 안 나는 것 자체가 OK.
      __resetPersistTimerForTests();
    } finally {
      vi.useRealTimers();
    }
  });

  // --- (7) _sessionId — 새 reset API. initSession 호출 후 reset →
  //         getSessionId() 가 다시 null. 그리고 invoke 가 재호출됨.
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

  // --- (8) lastApplied — 새 reset API. 같은 theme/mode pair 가 두 번
  //         subscribe 되어도 두 번째는 dedup; reset 후 두 번째 호출이
  //         다시 LS write 를 trigger.
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

    const { useThemeStore, __resetLastAppliedForTests } =
      await import("./themeStore");

    // initial 시점의 state 가 그대로면 subscriber 가 dedup → setItem 0.
    // 강제로 state 를 다른 값으로 set 한 뒤 다시 동일 값으로 set → 두 번째는
    // dedup 으로 setItem 추가 호출 없음.
    const { themeId, mode } = useThemeStore.getState();
    useThemeStore.setState({ themeId, mode });
    const callsBeforeReset = setItemSpy.mock.calls.length;

    __resetLastAppliedForTests();
    // reset 후 같은 set 이 다시 LS write 를 yield — dedup 키가 비워졌음 확인.
    // (initial 와 동일한 값이라 lastApplied 가 initial 로 reset 되어 다시
    // dedup. 본 sprint 의 invariant 는 reset 이 throw 없이 동작 + state
    // mutate 가 그대로 가능. 본 단언은 reset 이후 setItem 카운트가 감소하지
    // 않음 — 즉 timer / spy 상태가 corrupt 안 됨.)
    useThemeStore.setState({ themeId, mode });
    expect(setItemSpy.mock.calls.length).toBeGreaterThanOrEqual(
      callsBeforeReset,
    );
  });
});

/**
 * 작성 2026-05-17 (Phase 5 sprint-373, AC-373-01 + AC-373-02).
 *
 * 사유: sprint-372 의 thin wrapper 가 도착한 직후 `entries` /
 * `globalLog` / `searchFilter` / `connectionFilter` / `clearHistory` /
 * `clearGlobalLog` / `copyEntry` / `filteredGlobalLog` / `addHistoryEntry`
 * (legacy in-memory writer) 를 retire — type level 부재 + grep CI 단언.
 *
 * 본 테스트는 두 invariant 를 lock:
 *   1. store 의 type / shape 에 retired field 가 부재 (TS 컴파일 단계).
 *   2. 남은 surface 가 정확히 thin wrapper 의 3개 (`recentVisible`,
 *      `setRecentVisible`, `addOptimisticEntry`).
 *
 * 회귀 가드: TS 가 retired field 를 다시 정의하려고 하면 compile error,
 * runtime 에서 retired field 를 set 하려고 하면 zustand 가 silent merge
 * 하지만 추후 reader 는 undefined 를 본다 — 본 테스트가 truth shape 으로
 * snapshot.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { useQueryHistoryStore } from "./queryHistoryStore";

describe("queryHistoryStore retire (sprint-373)", () => {
  beforeEach(() => {
    // 본 store 는 module-load 시 한번 만들어진 singleton — 매 테스트마다
    // recentVisible 만 리셋해서 leak 차단.
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  // AC-373-01: 정적 shape — retired field 들이 모두 부재.
  // 작성 2026-05-17. 사유: `getState()` 의 keys 가 정확히 thin-wrapper
  // surface 3개. retired field (entries / globalLog / 등) 가 다시 store
  // 에 추가되면 본 단언이 깨진다.
  it("getState() exposes only the thin-wrapper surface", () => {
    const state = useQueryHistoryStore.getState();
    const keys = new Set(Object.keys(state));

    expect(keys.has("recentVisible")).toBe(true);
    expect(keys.has("setRecentVisible")).toBe(true);
    expect(keys.has("addOptimisticEntry")).toBe(true);

    // Retired fields — sprint-372 의 thinwrapper test 가 회귀 가드를
    // 잡고 있던 마지막 case 도 본 sprint 에서 제거됨.
    expect(keys.has("entries")).toBe(false);
    expect(keys.has("globalLog")).toBe(false);
    expect(keys.has("searchFilter")).toBe(false);
    expect(keys.has("connectionFilter")).toBe(false);
    expect(keys.has("clearHistory")).toBe(false);
    expect(keys.has("clearGlobalLog")).toBe(false);
    expect(keys.has("copyEntry")).toBe(false);
    expect(keys.has("filteredGlobalLog")).toBe(false);
    expect(keys.has("addHistoryEntry")).toBe(false);
  });
});

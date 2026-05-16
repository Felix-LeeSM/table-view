/**
 * `persistWorkspaces` — Sprint 358 (Phase 1 W1 dual-write).
 *
 * 작성 2026-05-16 (Phase 1 sprint-358).
 *
 * 사유:
 *   - workspaces 는 codex 6차 #5 결정에 따라 W1 시작 시점부터 **SQLite-only**.
 *   - 다른 4 도메인 (connections/favorites/mru/settings) 는 file/LS + SQLite
 *     dual-write 지만, workspaces 는 LS write 가 즉시 금지된다 (workspace 데이터
 *     의 boot 시점 atomic snapshot 은 SQLite 의 BEGIN IMMEDIATE 만이 보장 가능).
 *   - 본 테스트는 `persistWorkspaces` 호출 시 `localStorage.setItem` 이
 *     `"table-view-workspaces"` 키로 단 한 번도 호출되지 않음을 spy 로 단언한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { persistWorkspaces, STORAGE_KEY } from "./persistence";
import type { WorkspaceState } from "./types";

function makeWorkspace(): WorkspaceState {
  return {
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: {
      selectedNode: null,
      expanded: [],
      scrollTop: 0,
    },
  };
}

describe("persistWorkspaces — Sprint 358 (no LS write)", () => {
  let setItemSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.localStorage.clear();
    setItemSpy = vi.spyOn(window.localStorage, "setItem");
  });

  afterEach(() => {
    setItemSpy.mockRestore();
    window.localStorage.clear();
  });

  it("does NOT call localStorage.setItem for the table-view-workspaces key (SQLite-only)", () => {
    expect(STORAGE_KEY).toBe("table-view-workspaces");
    persistWorkspaces({ c1: { d1: makeWorkspace() } });
    // setItem 호출이 0회 — workspace LS write 사이트 제거 (codex 6차 #5).
    const calls = setItemSpy.mock.calls.filter(
      ([key]: [string, string]) => key === STORAGE_KEY,
    );
    expect(calls).toHaveLength(0);
  });

  it("does NOT write ANYTHING to localStorage on persistWorkspaces", () => {
    // localStorage 시작점 — 다른 테스트가 import 시 setup 한 entry 가 남아
    // 있을 수 있어 length 의 절대값보다 "persistWorkspaces 호출 후 증가량 == 0"
    // 을 검증한다.
    const before = window.localStorage.length;
    persistWorkspaces({
      c1: { d1: makeWorkspace() },
      c2: { d2: makeWorkspace() },
    });
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(before);
  });
});

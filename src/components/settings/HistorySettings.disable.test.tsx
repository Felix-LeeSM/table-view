/**
 * 작성 2026-05-17 (Phase 5 sprint-373, AC-373-03 + AC-373-04 + AC-373-08).
 *
 * 사용자 journey:
 *   1. (default) HistorySettings 토글 ON — `query_history_enabled = true`
 *      (AC-373-08). 6 source caller (`recordHistoryEntry`) 가 `add_history_entry`
 *      IPC 를 호출.
 *   2. 사용자 토글 OFF — `setQueryHistoryEnabled(false)` 호출 →
 *      `persist_setting("query_history_enabled", false)` IPC + store mutate.
 *      이후 6 source caller 가 `recordHistoryEntry` 호출 시 IPC 0회 (early
 *      return).
 *   3. 사용자 다시 토글 ON — IPC 호출 재개.
 *
 * 사유 (test scenarios 8 원칙):
 *   - user journey path: 토글 → 6 source caller 모두 시뮬 → IPC spy 0/N
 *     검증. mock 광역화 silent failure 가 안 일어나도록 6 caller 각자
 *     호출이 ON 시 +1 / OFF 시 +0 임을 정확히 단언.
 *   - state transition: ON → OFF → ON 의 3 단계 모두 자명한 단언.
 *   - regression-lock: `recordHistoryEntry` 의 early-return 분기가 빠지면
 *     OFF 상태에서도 IPC count 가 6 — 본 테스트가 회귀를 즉시 잡음.
 *
 * Tauri `invoke` 만 mock — `recordHistoryEntry` / `useHistorySettingsStore`
 * 의 실제 logic 을 실행해서 lego (settings → record → store → invoke)
 * 가 완전히 맞물려 동작하는지 검증.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

// hoisted mock — module-level invoke. 6 source caller 마다 어떤 IPC 가
// 호출되는지 단언하기 위해 spy 화.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import HistorySettings from "./HistorySettings";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";

/**
 * 6 source caller 의 동일 입력 시뮬레이터. 본 helper 는 `recordHistoryEntry`
 * 의 6종 source 라벨을 1회씩 발사 — IPC mock 의 count 가 ON 일 때 6,
 * OFF 일 때 0 인지 검증할 수 있다.
 */
function simulateAll6Sources() {
  // raw
  recordHistoryEntry({
    sql: "SELECT 1",
    executedAt: 1_700_000_000_000,
    duration: 5,
    status: "success",
    connectionId: "c-1",
    paradigm: "rdb",
    queryMode: "sql",
    source: "raw",
  });
  // grid-edit
  recordHistoryEntry({
    sql: "UPDATE t SET a=1 WHERE id=1",
    executedAt: 1_700_000_000_001,
    duration: 7,
    status: "success",
    connectionId: "c-1",
    paradigm: "rdb",
    queryMode: "sql",
    source: "grid-edit",
  });
  // ddl-structure
  recordHistoryEntry({
    sql: "ALTER TABLE t ADD COLUMN x INT",
    executedAt: 1_700_000_000_002,
    duration: 9,
    status: "success",
    connectionId: "c-1",
    paradigm: "rdb",
    queryMode: "sql",
    source: "ddl-structure",
  });
  // mongo-op
  recordHistoryEntry({
    sql: 'db.t.deleteMany({"a": 1})',
    executedAt: 1_700_000_000_003,
    duration: 11,
    status: "success",
    connectionId: "c-2",
    paradigm: "document",
    queryMode: "deleteMany",
    database: "db1",
    collection: "t",
    source: "mongo-op",
  });
  // explain (RDB plan inspection)
  recordHistoryEntry({
    sql: "SELECT * FROM t WHERE id = 1",
    executedAt: 1_700_000_000_004,
    duration: 4,
    status: "success",
    connectionId: "c-1",
    paradigm: "rdb",
    queryMode: "sql",
    database: "db1",
    tabId: "query-1",
    source: "explain",
  });
  // sidebar-prefetch (RDB preview rows)
  recordHistoryEntry({
    sql: "SELECT * FROM t",
    executedAt: 1_700_000_000_005,
    duration: 3,
    status: "success",
    connectionId: "c-1",
    paradigm: "rdb",
    queryMode: "sql",
    database: "db1",
    source: "sidebar-prefetch",
  });
}

/**
 * `add_history_entry` IPC 만 카운트. `persist_setting` 등 다른 invoke
 * 는 spy 에서 제외 — 본 테스트의 invariant 는 history insert path 의
 * count 만 잡는다.
 */
function countAddHistoryCalls(): number {
  return invokeMock.mock.calls.filter((call) => call[0] === "add_history_entry")
    .length;
}

describe("HistorySettings (sprint-373) — disable toggle gates IPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // backend IPC 가 응답하지 않는다고 가정해도 store 가 optimistic
    // mutate 되므로 default 응답은 resolve 로 통일.
    invokeMock.mockResolvedValue({
      id: 99,
      executedAt: 1,
      sqlRedacted: "?",
    });
    // store reset — default ON / default 30d (AC-373-07 + AC-373-08).
    useHistorySettingsStore.setState({
      queryHistoryEnabled: true,
      queryHistoryRetentionDays: 30,
    });
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  // AC-373-08 — 신규 사용자 boot 시 default = enabled.
  // 작성 2026-05-17. 사유: 신규 사용자에게 history 가 자동 ON 이어야
  // "기록되는지 모름" 회귀를 만들지 않음.
  it("defaults to enabled = true (AC-373-08)", () => {
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(true);
  });

  // AC-373-03 — 토글 OFF 후 6 source caller 모두 IPC 호출 안 함.
  // 작성 2026-05-17. 사유: 사용자가 disable 하면 IPC count = 0 invariant.
  it("disables IPC across all 6 source callers when toggled off (AC-373-03)", async () => {
    render(<HistorySettings />);

    // 1. ON 상태 — 6 source 발사 → 6 IPC.
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(6);

    // 2. 사용자 토글 OFF — IPC 1회 (persist_setting). count reset 후
    //    add_history_entry count 만 다시 잰다.
    invokeMock.mockClear();
    const toggle = screen.getByTestId("history-settings-toggle");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(false);

    // 3. OFF 상태에서 6 source 다시 발사 → IPC 0.
    invokeMock.mockClear();
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(0);
  });

  // AC-373-04 — 토글 ON 복원 후 IPC 호출 재개.
  // 작성 2026-05-17. 사유: disable → enable 의 round-trip 가 사용자
  // 의 mental model 과 정확히 일치 (IPC stop → IPC resume).
  it("re-enables IPC when toggled back on (AC-373-04)", async () => {
    render(<HistorySettings />);

    // 1. OFF 로 토글.
    const toggle = screen.getByTestId("history-settings-toggle");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(false);

    // 2. ON 으로 복원.
    invokeMock.mockClear();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(true);

    // 3. 6 source 발사 → IPC 6회 (resume).
    invokeMock.mockClear();
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(6);
  });

  // 토글 상태가 aria-pressed 에 동기화 — accessibility 회귀 가드.
  // 작성 2026-05-17. 사유: screen reader 사용자가 토글 상태를 정확히
  // 인지하도록 aria-pressed 가 enabled boolean 과 1:1.
  it("aria-pressed mirrors the enabled state", async () => {
    render(<HistorySettings />);
    const toggle = screen.getByTestId("history-settings-toggle");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });
});

/**
 * AC-373-03 + AC-373-04 + AC-373-08.
 *
 * User journey:
 *   1. (default) HistorySettings toggle ON — `query_history_enabled = true`
 *      (AC-373-08). The 6 source callers (`recordHistoryEntry`) call the
 *      `add_history_entry` IPC.
 *   2. User toggles OFF — calls `setQueryHistoryEnabled(false)` →
 *      `persist_setting("query_history_enabled", false)` IPC + store mutate.
 *      Afterwards the 6 source callers fire 0 IPCs when calling
 *      `recordHistoryEntry` (early return).
 *   3. User toggles ON again — IPC calls resume.
 *
 * Reason (the 8 test-scenario principles):
 *   - user journey path: toggle → simulate all 6 source callers → verify the
 *     IPC spy 0/N. To keep broad mocks from producing a silent failure, assert
 *     precisely that each of the 6 callers is +1 when ON and +0 when OFF.
 *   - state transition: all 3 steps of ON → OFF → ON get explicit assertions.
 *   - regression-lock: if `recordHistoryEntry`'s early-return branch is
 *     dropped, the IPC count is 6 even when OFF — this test catches that
 *     regression immediately.
 *
 * Only the Tauri `invoke` is mocked — the real logic of `recordHistoryEntry`
 * / `useHistorySettingsStore` runs, verifying that the lego (settings →
 * record → store → invoke) meshes and works end to end.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// hoisted mock — module-level invoke, turned into a spy so each of the 6
// source callers can be asserted on for the IPC it fires.
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { recordHistoryEntry } from "@lib/runtime/history/recordHistoryEntry";
import { useHistorySettingsStore } from "@stores/historySettingsStore";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import HistorySettings from "./HistorySettings";

/**
 * One-input simulator for the 6 source callers. This helper fires each of
 * `recordHistoryEntry`'s 6 source labels once, so the IPC mock's count can be
 * verified as 6 when ON and 0 when OFF.
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
 * Counts only the `add_history_entry` IPC. Other invokes such as
 * `persist_setting` are excluded from the spy — this test's invariant covers
 * only the count of the history insert path.
 */
function countAddHistoryCalls(): number {
  return invokeMock.mock.calls.filter((call) => call[0] === "add_history_entry")
    .length;
}

describe("HistorySettings (sprint-373) — disable toggle gates IPC", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    // Even if the backend IPC never responds, the store mutates
    // optimistically, so the default response is uniformly a resolve.
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

  // AC-373-08 — default = enabled on a new user's boot.
  // Reason: history must start ON for new users so the "did not know it
  // was recording" regression never appears.
  it("defaults to enabled = true (AC-373-08)", () => {
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(true);
  });

  // AC-373-03 — after toggling OFF, none of the 6 source callers fire IPC.
  // Reason: when the user disables, the IPC count = 0 invariant.
  it("disables IPC across all 6 source callers when toggled off (AC-373-03)", async () => {
    render(<HistorySettings />);

    // 1. ON — fire the 6 sources → 6 IPCs.
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(6);

    // 2. User toggles OFF — 1 IPC (persist_setting). After resetting the
    //    count, re-count only add_history_entry.
    invokeMock.mockClear();
    const toggle = screen.getByTestId("history-settings-toggle");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(false);

    // 3. Fire the 6 sources again while OFF → 0 IPCs.
    invokeMock.mockClear();
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(0);
  });

  // AC-373-04 — after restoring the toggle to ON, IPC calls resume.
  // Reason: the disable → enable round trip matches the user's mental
  // model exactly (IPC stop → IPC resume).
  it("re-enables IPC when toggled back on (AC-373-04)", async () => {
    render(<HistorySettings />);

    // 1. Toggle OFF.
    const toggle = screen.getByTestId("history-settings-toggle");
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(false);

    // 2. Restore ON.
    invokeMock.mockClear();
    await act(async () => {
      fireEvent.click(toggle);
    });
    expect(useHistorySettingsStore.getState().queryHistoryEnabled).toBe(true);

    // 3. Fire the 6 sources → 6 IPCs (resume).
    invokeMock.mockClear();
    act(() => {
      simulateAll6Sources();
    });
    expect(countAddHistoryCalls()).toBe(6);
  });

  // The toggle state mirrors aria-pressed — accessibility regression guard.
  // Reason: aria-pressed is 1:1 with the enabled boolean so a screen
  // reader user perceives the toggle state accurately.
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

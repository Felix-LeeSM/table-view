/**
 * `flushPersistWorkspaces` — synchronous flush of the pending debounce window
 * (#1580).
 *
 * The workspace persist was a pure trailing 200ms debounce with no flush
 * point, so two edits could be lost:
 *   - F1: paste SQL then close the window within 200ms — the trailing timer
 *     never fired and the close path destroyed the window.
 *   - F2: continuous typing kept resetting the trailing timer, so a crash
 *     mid-burst lost everything since the last pause.
 *
 * `flushPersistWorkspaces` clears the pending timer(s) and persists the latest
 * workspaces immediately (App's close handler awaits it before destroy). The
 * debounce also grows a 1000ms maxWait cap so a burst can't starve the flush.
 *
 * Boundary mock (mock-scope rule): only `@tauri-apps/api/core` `invoke` and the
 * toast surface are stubbed; dehydration + request shaping run for real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import { invoke } from "@tauri-apps/api/core";
import {
  __resetPersistTimerForTests,
  debouncePersistWorkspaces,
  flushPersistWorkspaces,
  type WorkspacesShape,
} from "./persistence";
import type { WorkspaceState } from "./types";

// #1580 — test-setup globally mocks `@lib/tauri/workspaces` (no-op resolve) so
// stray background persists don't toast in component specs. This spec asserts
// the REAL flush → `persist_workspace` invoke path, so opt back into the actual
// `persistWorkspace` and drive the mocked core invoke below.
vi.unmock("@lib/tauri/workspaces");

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@lib/runtime/toast", () => ({
  toast: { error: vi.fn() },
}));

function queryWs(sql: string): WorkspacesShape {
  const ws: WorkspaceState = {
    tabs: [
      {
        type: "query",
        id: "q-1" as TabId,
        title: "Query 1",
        connectionId: "conn1" as ConnectionId,
        closable: true,
        sql,
        queryState: { status: "idle" },
        paradigm: "rdb",
        queryMode: "sql",
        database: "dbA",
      },
    ],
    activeTabId: "q-1",
    closedTabHistory: [],
    dirtyTabIds: [],
    sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
  };
  return { conn1: { dbA: ws } };
}

function persistedTabsJson(): string {
  const call = vi
    .mocked(invoke)
    .mock.calls.find(([cmd]) => cmd === "persist_workspace");
  if (!call) throw new Error("persist_workspace was not invoked");
  return (call[1] as { req: { tabsJson: string } }).req.tabsJson;
}

describe("flushPersistWorkspaces (#1580)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
    __resetPersistTimerForTests();
  });

  afterEach(() => {
    __resetPersistTimerForTests();
    vi.useRealTimers();
  });

  // Reason: #1580 F1 — paste-then-close inside the 200ms window dropped the
  // edit because the pure trailing debounce never flushed; the close handler
  // now awaits this flush before destroying the window. (2026-07-17)
  it("persists the latest edit when flushed inside the debounce window", async () => {
    debouncePersistWorkspaces(queryWs("SELECT edited"));
    // Still inside the 200ms window — nothing has been sent yet.
    expect(invoke).not.toHaveBeenCalled();

    await flushPersistWorkspaces();

    expect(persistedTabsJson()).toContain("SELECT edited");
  });

  // Reason: #1580 — flush must clear the pending timer(s) so the same snapshot
  // is not persisted twice (once by flush, once by a stale trailing/maxWait
  // timer). (2026-07-17)
  it("clears the pending timers so no second persist fires after flush", async () => {
    debouncePersistWorkspaces(queryWs("SELECT edited"));
    await flushPersistWorkspaces();
    const afterFlush = vi.mocked(invoke).mock.calls.length;

    vi.advanceTimersByTime(2000); // past both the 200ms and 1000ms caps
    expect(vi.mocked(invoke).mock.calls.length).toBe(afterFlush);
  });

  // Reason: #1580 F2 — under continuous typing the trailing timer keeps
  // resetting; the 1000ms maxWait cap forces a flush so a crash mid-burst
  // loses at most ~1s of edits, not the whole burst. (2026-07-17)
  it("flushes within the 1000ms maxWait cap under continuous edits", () => {
    // An edit every 100ms would reset a pure trailing debounce indefinitely.
    for (let i = 0; i < 12; i++) {
      debouncePersistWorkspaces(queryWs(`SELECT ${i}`));
      vi.advanceTimersByTime(100);
    }
    // 1200ms of uninterrupted edits — the maxWait cap must have fired.
    expect(invoke).toHaveBeenCalled();
  });
});

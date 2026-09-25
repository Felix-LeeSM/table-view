/**
 * `persistWorkspaces` — state-management-strategy W1 dual-write.
 *
 * Written 2026-05-16.
 *
 * Reason:
 *   - workspaces are **SQLite-only** from the start of W1.
 *   - In W1 the other 4 domains (connections/favorites/mru/settings)
 *     dual-write to file/LS + SQLite, but workspaces ban LS writes at once
 *     (only SQLite's BEGIN IMMEDIATE can guarantee an atomic boot-time
 *     snapshot of workspace data).
 *   - This test asserts with a spy that calling `persistWorkspaces` never
 *     calls `localStorage.setItem` with the `"table-view-workspaces"` key.
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
    // Zero setItem calls — the workspace LS write site was removed.
    const calls = setItemSpy.mock.calls.filter(
      ([key]: [string, string]) => key === STORAGE_KEY,
    );
    expect(calls).toHaveLength(0);
  });

  it("does NOT write ANYTHING to localStorage on persistWorkspaces", () => {
    // localStorage starting point — entries that other tests set up at
    // import time may remain, so verify "zero growth after the
    // persistWorkspaces call" rather than the absolute length.
    const before = window.localStorage.length;
    persistWorkspaces({
      c1: { d1: makeWorkspace() },
      c2: { d2: makeWorkspace() },
    });
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(before);
  });
});

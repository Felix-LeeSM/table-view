/**
 * Written 2026-05-17 (AC-373-01 + AC-373-02).
 *
 * Reason: right after the thin wrapper landed, `entries` /
 * `globalLog` / `searchFilter` / `connectionFilter` / `clearHistory` /
 * `clearGlobalLog` / `copyEntry` / `filteredGlobalLog` / `addHistoryEntry`
 * (the legacy in-memory writer) were retired — absent at the type level.
 *
 * This test locks two invariants:
 *   1. The store's type / shape has no retired field (TS compile step).
 *   2. The remaining surface is exactly the thin wrapper's 3 fields
 *      (`recentVisible`, `setRecentVisible`, `addOptimisticEntry`).
 *
 * Regression guard: typed code that reads or sets a retired field fails TS
 * compilation, but re-adding one to the store initializer compiles and a
 * runtime set is silently merged by zustand — this test snapshots the true
 * shape.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { useQueryHistoryStore } from "./queryHistoryStore";

describe("queryHistoryStore retire (sprint-373)", () => {
  beforeEach(() => {
    // The store is a singleton created once at module load — reset only
    // recentVisible before each test to block leaks.
    useQueryHistoryStore.setState({ recentVisible: [] });
  });

  // AC-373-01: static shape — all retired fields are absent.
  // Written 2026-05-17. Reason: `getState()` keys are exactly the 3
  // thin-wrapper fields. Re-adding a retired field (entries / globalLog /
  // etc.) to the store breaks this assertion.
  it("getState() exposes only the thin-wrapper surface", () => {
    const state = useQueryHistoryStore.getState();
    const keys = new Set(Object.keys(state));

    expect(keys.has("recentVisible")).toBe(true);
    expect(keys.has("setRecentVisible")).toBe(true);
    expect(keys.has("addOptimisticEntry")).toBe(true);

    // Retired fields.
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

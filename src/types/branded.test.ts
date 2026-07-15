import { describe, expect, it } from "vitest";
import { rawEntryKey } from "@stores/rawQueryGridEditStore";
import type { ExecuteRdbSingleStatementRequest } from "@components/query/QueryTab/rdbQueryExecution";
import type { ConnectionId, TabId } from "./branded";

/**
 * Type-level regression for issue #1493. The real assertion runs under
 * `tsc --noEmit`: each `@ts-expect-error` below must be a LIVE suppression,
 * i.e. the swapped call is a genuine compile error. Before `rawEntryKey` /
 * `findLiveIdleTab` were branded these calls type-checked (both args were
 * plain `string`), so the directive was unused and `tsc` failed — that is
 * the RED this test locks in. The runtime `expect` keeps the file a valid
 * vitest suite and pins the key shape.
 */
describe("branded ConnectionId / TabId argument-order safety", () => {
  const connectionId = "conn-1" as ConnectionId;
  const tabId = "tab-1" as TabId;

  it("composes the raw entry key from (connectionId, tabId)", () => {
    expect(rawEntryKey(connectionId, tabId)).toBe("conn-1::tab-1");
  });

  it("rejects a swapped rawEntryKey call at compile time", () => {
    // @ts-expect-error swapped (tabId, connectionId) order must not compile
    expect(rawEntryKey(tabId, connectionId)).toBe("tab-1::conn-1");
  });

  it("rejects a swapped findLiveIdleTab call at compile time", () => {
    type FindLiveIdleTab = ExecuteRdbSingleStatementRequest["findLiveIdleTab"];
    const findLiveIdleTab = ((): unknown => null) as FindLiveIdleTab;
    // Canonical order is (connectionId, tabId).
    expect(findLiveIdleTab(connectionId, tabId)).toBeNull();
    // @ts-expect-error swapped (tabId, connectionId) order must not compile
    expect(findLiveIdleTab(tabId, connectionId)).toBeNull();
  });
});

/**
 * Written 2026-05-16 (AC-365-09)
 *
 * Reason: F.5 "Clear query history" (strategy doc lines 1369–1371).
 * Receiving `{domain:"history", op:"clear", entityId:null, version:N+1}`
 * makes the mounted history panel set `entries=[]` and reset its page, with
 * zero refetches. This test locks that the dispatcher routes the
 * history.clear payload only to the `onClear` handler and calls `onCreated`
 * (the per-entry refetch handler) zero times.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
} from "./stateChanged";

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("AC-365-09 history clear", () => {
  it("op='clear' with entityId=null → onClear, refetch 0", () => {
    const onCreated = vi.fn();
    const onClear = vi.fn();
    setStateChangedHandlers({ history: { onCreated, onClear } });

    dispatchStateChangedPayload("self", {
      domain: "history",
      op: "clear",
      entityId: null,
      version: 314,
      snapshotVersion: 0,
      originWindow: null,
      emittedAt: 1700000000000,
    });

    expect(onCreated).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

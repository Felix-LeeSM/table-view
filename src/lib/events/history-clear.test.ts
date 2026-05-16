/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-09)
 *
 * 사유: F.5 "Clear query history" (strategy doc lines 1366–1368 + codex
 * 7차 #3). `{domain:"history", op:"clear", entityId:null, version:N+1}`
 * 수신 → mounted history panel 의 `entries=[]` set + page reset. refetch
 * 0회. 본 테스트는 dispatcher 가 history.clear payload 를 `onClear`
 * 핸들러로만 라우팅하고 `onCreated` (per-entry refetch 핸들러) 는 0회임
 * 을 잠근다.
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

  it("clear is routed even when no entityId is present", () => {
    // history.clear is the one case where entityId=null is the contract;
    // all other domains require entityId. The dispatcher must NOT bail
    // on null here.
    const onClear = vi.fn();
    setStateChangedHandlers({ history: { onClear } });

    dispatchStateChangedPayload("self", {
      domain: "history",
      op: "clear",
      entityId: null,
      version: 1,
      snapshotVersion: 0,
      originWindow: null,
      emittedAt: 1,
    });

    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

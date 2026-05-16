/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-03)
 *
 * 사유: F.4 invariant — `originWindow === currentWindowLabel` 인 event 는
 * 원인 window 가 자기 action 의 응답 (optimistic) 으로 이미 store 를
 * 갱신했기에 mutate 를 skip 한다. 단 lastApplied version 은 갱신 (이후
 * stale detection 정확성). 회귀 시 origin window 가 자기 mutate 의 두 번째
 * 적용으로 UI flicker / count 두 배 / scroll position 리셋 등을 겪는다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
  type StateChangedPayload,
} from "./stateChanged";

const BASE = {
  domain: "setting" as const,
  op: "update" as const,
  entityId: "theme",
  snapshotVersion: 0,
  emittedAt: 1700000000000,
};

function build(
  version: number,
  originWindow: string | null,
): StateChangedPayload {
  return { ...BASE, version, originWindow };
}

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("AC-365-03 self-echo skip", () => {
  it("skips mutate when originWindow === currentWindowLabel", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload(
      "workspace-conn-1",
      build(1, "workspace-conn-1"),
    );

    expect(onUpdated).not.toHaveBeenCalled();
  });

  it("DOES dispatch when originWindow differs (other window's mutate)", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("workspace-conn-1", build(1, "launcher"));

    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("DOES dispatch when originWindow=null (backend-initiated)", () => {
    // null origin = backend internal emit (e.g. keep-alive status change).
    // Self-echo rule applies only when origin matches current label.
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("workspace-conn-1", build(1, null));

    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("self-echo updates lastApplied so subsequent stale receive is dropped", () => {
    // Even though the self-echo skipped mutate, the version was applied
    // bookkeeping-wise. A later receive at version=1 (same) must still
    // be dropped by the dedup logic.
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload(
      "workspace-conn-1",
      build(2, "workspace-conn-1"), // self-echo, version 2
    );
    expect(onUpdated).not.toHaveBeenCalled();

    // Now a stale broadcast at version 1 arrives from another window —
    // must be dropped because lastApplied is now 2.
    dispatchStateChangedPayload("workspace-conn-1", build(1, "launcher"));
    expect(onUpdated).not.toHaveBeenCalled();

    // A fresh broadcast at version 3 from another window does dispatch.
    dispatchStateChangedPayload("workspace-conn-1", build(3, "launcher"));
    expect(onUpdated).toHaveBeenCalledTimes(1);
  });
});

/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-02)
 *
 * 사유: F.4 invariant — `(domain, entityId, version)` 마지막 적용을 기록.
 * 같은 version 재수신 시 drop, version < lastApplied 도 drop (stale).
 * dedup 이 깨지면 수신자 핸들러가 같은 mutate 를 두 번 수행해 UI 가
 * "blink" 하거나 카운터가 두 배가 된다 — 회귀 시 즉시 잡혀야 한다.
 *
 * 본 테스트는 self/non-self 양쪽 다 dedup 이 적용됨을 검증한다 (origin
 * 이 누구든 같은 version 은 중복 처리 금지).
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
  originWindow: string | null = null,
): StateChangedPayload {
  return { ...BASE, version, originWindow };
}

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("AC-365-02 version dedup", () => {
  it("drops a second receive at the same version (no second handler call)", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("self", build(1));
    dispatchStateChangedPayload("self", build(1));

    expect(onUpdated).toHaveBeenCalledTimes(1);
  });

  it("drops a stale receive (version < lastApplied)", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("self", build(5));
    dispatchStateChangedPayload("self", build(3));

    expect(onUpdated).toHaveBeenCalledTimes(1);
    // The version applied is the first (5), not the stale (3).
  });

  it("accepts a strictly-greater version (no extra refetch yet on +1 step)", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("self", build(1));
    dispatchStateChangedPayload("self", build(2));
    dispatchStateChangedPayload("self", build(3));

    expect(onUpdated).toHaveBeenCalledTimes(3);
  });

  it("dedup is per (domain, entityId) — different entity is independent", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated } });

    dispatchStateChangedPayload("self", { ...build(1), entityId: "theme" });
    dispatchStateChangedPayload("self", {
      ...build(1),
      entityId: "safe_mode",
    });

    expect(onUpdated).toHaveBeenCalledTimes(2);
    expect(onUpdated.mock.calls[0]?.[0]).toBe("theme");
    expect(onUpdated.mock.calls[1]?.[0]).toBe("safe_mode");
  });
});

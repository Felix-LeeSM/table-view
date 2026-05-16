/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-04)
 *
 * 사유: F.4 protection #2 — Version gap 감지.
 * `version > lastApplied + 1` 이면 missed event 가 있다는 신호. 해당
 * domain 전체 refetch (예: `domain:"connection"` 이면 `get_all_connections()`
 * 재호출). gap 처리가 누락되면 frontend store 가 영구적으로 stale 상태에
 * 머무를 수 있다 — listener 가 모든 event 를 한 번에 받는다는 보장 없음
 * (Tauri runtime 동작 변경, OS hot-loop 등).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
  type StateChangedPayload,
} from "./stateChanged";

const BASE = {
  domain: "connection" as const,
  op: "update" as const,
  entityId: "conn-1",
  snapshotVersion: 0,
  originWindow: null,
  emittedAt: 1700000000000,
};

function build(version: number): StateChangedPayload {
  return { ...BASE, version };
}

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("AC-365-04 version gap refetch", () => {
  it("calls onGapDetected when version > lastApplied + 1", () => {
    const onCrudChanged = vi.fn();
    const onGapDetected = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged, onGapDetected },
    });

    // Establish lastApplied = 5
    dispatchStateChangedPayload("self", build(5));
    expect(onCrudChanged).toHaveBeenCalledTimes(1);
    expect(onGapDetected).not.toHaveBeenCalled();

    // Receive version 7 — gap of 1 missed event (version 6)
    dispatchStateChangedPayload("self", build(7));
    expect(onGapDetected).toHaveBeenCalledTimes(1);
    // Gap-recovery should NOT also call the normal handler — the
    // refetch in onGapDetected supersedes the per-event mutate.
    expect(onCrudChanged).toHaveBeenCalledTimes(1);
  });

  it("does not call onGapDetected on a normal +1 step", () => {
    const onCrudChanged = vi.fn();
    const onGapDetected = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged, onGapDetected },
    });

    dispatchStateChangedPayload("self", build(1));
    dispatchStateChangedPayload("self", build(2));
    dispatchStateChangedPayload("self", build(3));

    expect(onCrudChanged).toHaveBeenCalledTimes(3);
    expect(onGapDetected).not.toHaveBeenCalled();
  });

  it("does not call onGapDetected on the first-ever receive (no prior baseline)", () => {
    // The very first event for a (domain, entityId) cannot be a gap —
    // we have no `lastApplied` to compare against, so we treat it as
    // a fresh baseline.
    const onCrudChanged = vi.fn();
    const onGapDetected = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged, onGapDetected },
    });

    dispatchStateChangedPayload("self", build(42));

    expect(onCrudChanged).toHaveBeenCalledTimes(1);
    expect(onGapDetected).not.toHaveBeenCalled();
  });

  it("gap detection updates lastApplied to the received version (recovers from gap)", () => {
    const onCrudChanged = vi.fn();
    const onGapDetected = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged, onGapDetected },
    });

    dispatchStateChangedPayload("self", build(5));
    dispatchStateChangedPayload("self", build(8)); // gap
    // After gap, lastApplied = 8. The next +1 step is 9.
    dispatchStateChangedPayload("self", build(9));

    expect(onGapDetected).toHaveBeenCalledTimes(1);
    // Initial mutate at v=5 + normal mutate at v=9. v=8 was gap, so its
    // mutate handler was NOT called (refetch supersedes).
    expect(onCrudChanged).toHaveBeenCalledTimes(2);
  });

  it("schemaCache reset op does not call onGapDetected on first receive", () => {
    // schemaCache.invalidate uses op:invalidate; first receive of a
    // new entity is a baseline, never a gap.
    const onInvalidate = vi.fn();
    const onGapDetected = vi.fn();
    setStateChangedHandlers({
      schemaCache: { onInvalidate, onGapDetected },
    });

    dispatchStateChangedPayload("self", {
      ...build(99),
      domain: "schemaCache",
      op: "invalidate",
    });

    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onGapDetected).not.toHaveBeenCalled();
  });
});

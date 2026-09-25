/**
 * Written 2026-05-16 (AC-365-02)
 *
 * Reason: F.4 invariant — record the last applied
 * `(domain, entityId, version)`. A repeat receive of the same version is
 * dropped, and so is version < lastApplied (stale). If dedup breaks, the
 * receiver handler runs the same mutate twice and the UI "blinks" or a
 * counter doubles — a regression must be caught immediately.
 *
 * Whatever the origin, the same version must not be processed twice. This
 * file drives events with `originWindow: null`; the self-origin side is in
 * `self-echo.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  type StateChangedPayload,
  setStateChangedHandlers,
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

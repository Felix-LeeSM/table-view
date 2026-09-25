/**
 * Written 2026-05-16 (AC-365-05)
 *
 * Reason: the F.4 reset-op flow (strategy doc lines 1419–1447). Unlike
 * update, `op:"reset"` does not take the refetch path — backend
 * `reset_setting` deletes the row, so `get_setting` returns null and a
 * refetch is pointless. Per F.4, the receiver applies the frontend
 * `SETTING_DEFAULTS` constant directly.
 *
 * This test locks that the dispatcher routes the reset op only to the
 * `onReset` handler and calls `onUpdated` (the refetch handler) zero times.
 * On regression the store updates twice after a reset, or gets a
 * null/stale value instead of the default.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
} from "./stateChanged";

const BASE = {
  version: 1,
  snapshotVersion: 0,
  originWindow: null,
  emittedAt: 1700000000000,
};

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("AC-365-05 setting reset op no-refetch", () => {
  it("calls onReset and NOT onUpdated when op='reset'", () => {
    const onUpdated = vi.fn();
    const onReset = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated, onReset } });

    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "setting",
      op: "reset",
      entityId: "theme",
    });

    expect(onUpdated).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset.mock.calls[0]?.[0]).toBe("theme");
  });

  it("payload carries the setting key in entityId — receiver applies SETTING_DEFAULTS[key]", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ setting: { onReset } });

    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "setting",
      op: "reset",
      entityId: "sidebar_width",
    });

    // The receiver gets the entity id (settings key) and the full
    // payload — the actual SETTING_DEFAULTS lookup is the receiver's
    // job (kept out of the dispatcher because the constants live with
    // the store).
    expect(onReset).toHaveBeenCalledWith("sidebar_width", expect.any(Object));
  });
});

describe("AC-365-06 datagridColumnPrefs reset by field", () => {
  it("field='widths' is forwarded to onReset", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "datagridColumnPrefs",
      op: "reset",
      entityId: "<base64url>",
      field: "widths",
    });
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onReset.mock.calls[0]?.[1].field).toBe("widths");
  });

  it("field='hiddenColumns' is forwarded to onReset", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "datagridColumnPrefs",
      op: "reset",
      entityId: "<base64url>",
      field: "hiddenColumns",
    });
    expect(onReset.mock.calls[0]?.[1].field).toBe("hiddenColumns");
  });

  it("field='all' is forwarded to onReset", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "datagridColumnPrefs",
      op: "reset",
      entityId: "<base64url>",
      field: "all",
    });
    expect(onReset.mock.calls[0]?.[1].field).toBe("all");
  });

  it("reset never calls onUpdated (no refetch)", () => {
    const onUpdated = vi.fn();
    const onReset = vi.fn();
    setStateChangedHandlers({
      datagridColumnPrefs: { onUpdated, onReset },
    });
    dispatchStateChangedPayload("self", {
      ...BASE,
      domain: "datagridColumnPrefs",
      op: "reset",
      entityId: "<eid>",
      field: "widths",
    });
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});

/**
 * 작성 2026-05-16 (Phase 3 sprint-365, AC-365-05)
 *
 * 사유: F.4 "Reset op 처리 흐름" (strategy doc lines 1416–1444 + codex 6차
 * #4 통일). `op:"reset"` 은 update 와 달리 refetch 경로를 타지 않는다 —
 * backend `reset_setting` 은 row 를 삭제하기에 `get_setting` 결과가
 * null 이 되어 refetch 가 무의미. 수신자는 frontend `SETTING_DEFAULTS`
 * 상수를 직접 적용한다.
 *
 * 본 테스트는 dispatcher 가 reset op 를 `onReset` 핸들러로만 라우팅하고
 * `onUpdated` (refetch 핸들러) 는 호출 0회임을 잠근다. 회귀 시 reset
 * 후 store 가 두 번 갱신되거나, default 대신 null/stale 값이 들어간다.
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

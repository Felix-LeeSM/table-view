/**
 * 작성 2026-05-16 (Phase 3 sprint-365)
 *
 * 사유: cross-window `state-changed` event 의 9 domain 라우팅을 잠근다.
 * 각 domain × op 조합이 등록된 핸들러로 정확히 dispatch 되는지 — 그리고
 * 등록 안 된 조합은 silently drop 되는지 — 가 strategy doc F.4 의 핵심
 * 계약. 회귀 시 (예: 도메인 추가하면서 switch case 빠뜨림) 본 테스트가
 * 첫 알람이 되어 frontend 가 멈춰 있는 모드 (event 수신했는데 store 가
 * 안 갱신) 를 막는다.
 *
 * 9 domain × {create/update/delete/reorder, status, bulk, invalidate,
 * reset, clear} 의 contract-spec 조합을 한 곳에서 검증.
 *
 * Out of scope: 실제 store mutate (각 store 의 unit test 가 담당).
 *               dedup / self-echo / gap (별도 파일).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  setStateChangedHandlers,
  type StateChangedPayload,
} from "./stateChanged";

const BASE: Omit<StateChangedPayload, "domain" | "op" | "entityId"> = {
  version: 1,
  snapshotVersion: 0,
  originWindow: null,
  emittedAt: 1700000000000,
};

function payload(
  overrides: Partial<StateChangedPayload> &
    Pick<StateChangedPayload, "domain" | "op">,
): StateChangedPayload {
  return {
    ...BASE,
    entityId: overrides.entityId ?? "id-1",
    ...overrides,
  };
}

beforeEach(() => {
  resetStateChangedRegistryForTests();
});

describe("connection domain receiver — 9-domain matrix #1", () => {
  it("create/update/delete/reorder → onCrudChanged with entityId", () => {
    // Use a fresh entityId per op so dedup doesn't suppress later receives
    // (same (domain, entityId, version) is dropped). The point of this
    // test is to verify routing, not dedup — so we make each event a
    // fresh key.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ connection: { onCrudChanged } });
    const ops = ["create", "update", "delete", "reorder"] as const;
    ops.forEach((op, i) => {
      dispatchStateChangedPayload(
        "self",
        payload({
          domain: "connection",
          op,
          entityId: `conn-${i}`,
        }),
      );
    });
    expect(onCrudChanged).toHaveBeenCalledTimes(4);
    expect(onCrudChanged.mock.calls[0]?.[0]).toBe("conn-0");
  });

  it("status → onStatusChanged with entityId", () => {
    const onCrudChanged = vi.fn();
    const onStatusChanged = vi.fn();
    setStateChangedHandlers({
      connection: { onCrudChanged, onStatusChanged },
    });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "connection", op: "status", entityId: "conn-7" }),
    );
    expect(onCrudChanged).not.toHaveBeenCalled();
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
    expect(onStatusChanged.mock.calls[0]?.[0]).toBe("conn-7");
  });
});

describe("group domain receiver — #2", () => {
  it("crud ops → onCrudChanged", () => {
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ group: { onCrudChanged } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "group", op: "create", entityId: "g-1" }),
    );
    expect(onCrudChanged).toHaveBeenCalledWith("g-1", expect.any(Object));
  });
});

describe("mru domain receiver — #3", () => {
  it("bulk → onBulkChanged (no entityId)", () => {
    const onBulkChanged = vi.fn();
    setStateChangedHandlers({ mru: { onBulkChanged } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "mru", op: "bulk", entityId: null }),
    );
    expect(onBulkChanged).toHaveBeenCalledTimes(1);
  });
});

describe("favorite domain receiver — #4", () => {
  it("crud ops → onCrudChanged", () => {
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ favorite: { onCrudChanged } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "favorite", op: "delete", entityId: "fav-2" }),
    );
    expect(onCrudChanged).toHaveBeenCalledWith("fav-2", expect.any(Object));
  });
});

describe("setting domain receiver — #5", () => {
  it("update → onUpdated with entityId (settings key)", () => {
    const onUpdated = vi.fn();
    const onReset = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated, onReset } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "setting", op: "update", entityId: "theme" }),
    );
    expect(onUpdated).toHaveBeenCalledWith("theme", expect.any(Object));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("reset → onReset with entityId (no refetch)", () => {
    const onUpdated = vi.fn();
    const onReset = vi.fn();
    setStateChangedHandlers({ setting: { onUpdated, onReset } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "setting", op: "reset", entityId: "sidebar_width" }),
    );
    expect(onUpdated).not.toHaveBeenCalled();
    expect(onReset).toHaveBeenCalledWith("sidebar_width", expect.any(Object));
  });
});

describe("workspace domain receiver — #6", () => {
  it("update → onUpdated with entityId (connection id of workspace)", () => {
    const onUpdated = vi.fn();
    setStateChangedHandlers({ workspace: { onUpdated } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "workspace", op: "update", entityId: "conn-3" }),
    );
    expect(onUpdated).toHaveBeenCalledWith("conn-3", expect.any(Object));
  });
});

describe("history domain receiver — #7", () => {
  it("create → onCreated with entityId", () => {
    const onCreated = vi.fn();
    const onClear = vi.fn();
    setStateChangedHandlers({ history: { onCreated, onClear } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "history", op: "create", entityId: "h-1" }),
    );
    expect(onCreated).toHaveBeenCalledWith("h-1", expect.any(Object));
    expect(onClear).not.toHaveBeenCalled();
  });

  it("clear → onClear (no entityId)", () => {
    // AC-365-09 — history clear: entries=[] + page reset, refetch 0.
    const onCreated = vi.fn();
    const onClear = vi.fn();
    setStateChangedHandlers({ history: { onCreated, onClear } });
    dispatchStateChangedPayload(
      "self",
      payload({ domain: "history", op: "clear", entityId: null }),
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe("schemaCache domain receiver — #8", () => {
  it("invalidate → onInvalidate with entityId (connection_id)", () => {
    const onInvalidate = vi.fn();
    setStateChangedHandlers({ schemaCache: { onInvalidate } });
    dispatchStateChangedPayload(
      "self",
      payload({
        domain: "schemaCache",
        op: "invalidate",
        entityId: "conn-9",
      }),
    );
    expect(onInvalidate).toHaveBeenCalledWith("conn-9", expect.any(Object));
  });
});

describe("datagridColumnPrefs domain receiver — #9", () => {
  it("update → onUpdated with entityId (encoded base64url)", () => {
    const onUpdated = vi.fn();
    const onReset = vi.fn();
    setStateChangedHandlers({
      datagridColumnPrefs: { onUpdated, onReset },
    });
    dispatchStateChangedPayload(
      "self",
      payload({
        domain: "datagridColumnPrefs",
        op: "update",
        entityId: "<base64url>",
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith("<base64url>", expect.any(Object));
    expect(onReset).not.toHaveBeenCalled();
  });

  it("reset field='widths' → onReset with field='widths'", () => {
    // AC-365-06 — field 별 분기 (widths only)
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload(
      "self",
      payload({
        domain: "datagridColumnPrefs",
        op: "reset",
        entityId: "<eid>",
        field: "widths",
      }),
    );
    expect(onReset).toHaveBeenCalledTimes(1);
    const call = onReset.mock.calls[0];
    expect(call?.[1].field).toBe("widths");
  });

  it("reset field='hiddenColumns' → onReset with field='hiddenColumns'", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload(
      "self",
      payload({
        domain: "datagridColumnPrefs",
        op: "reset",
        entityId: "<eid>",
        field: "hiddenColumns",
      }),
    );
    const call = onReset.mock.calls[0];
    expect(call?.[1].field).toBe("hiddenColumns");
  });

  it("reset field='all' → onReset with field='all'", () => {
    const onReset = vi.fn();
    setStateChangedHandlers({ datagridColumnPrefs: { onReset } });
    dispatchStateChangedPayload(
      "self",
      payload({
        domain: "datagridColumnPrefs",
        op: "reset",
        entityId: "<eid>",
        field: "all",
      }),
    );
    const call = onReset.mock.calls[0];
    expect(call?.[1].field).toBe("all");
  });
});

describe("Missing handler safety", () => {
  it("drops payload silently when no handler is registered", () => {
    // After reset: no handlers. Dispatch must not throw.
    expect(() =>
      dispatchStateChangedPayload(
        "self",
        payload({ domain: "connection", op: "update", entityId: "x" }),
      ),
    ).not.toThrow();
  });

  it("drops payload with malformed shape silently", () => {
    // The dispatcher is called from a listen() callback — `payload` is
    // user-controlled (in principle a buggy / malicious sender) so the
    // dispatcher must defensively ignore obviously-wrong shapes.
    const onCrudChanged = vi.fn();
    setStateChangedHandlers({ connection: { onCrudChanged } });
    // missing `op`
    dispatchStateChangedPayload(
      "self",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { domain: "connection" } as any,
    );
    expect(onCrudChanged).not.toHaveBeenCalled();
  });
});

/**
 * Purpose: cross-window `state-changed` 라우터의 9-domain 완전성 불변식 —
 * Phase 3 sprint-365 F.4 (재작성 이슈 #1627, 2026-07-24)
 *
 * 사유(재작성): 이전 버전은 `stateChanged.ts` 소스를 `readFileSync` +
 * 문자열 grep 하여 `case "<domain>":` 존재를 세는 change-detector 였다
 * (P2/P9 위반 — 소스 문자열 매칭). 라우터 완전성이라는 의도는 정당하나
 * 수단이 소스 텍스트에 결합돼 실제 라우팅 동작을 관측하지 못했고 주석
 * 리네이밍/포맷 변경만으로도 깨졌다.
 *
 * 재작성 방식: 각 domain 을 normal + gap 두 라우터로 **실제 dispatch** 해
 * 등록한 handler 호출을 단언한다 (behavioral). 완전성은 두 겹으로 잠근다.
 *   1. compile-time — `DOMAIN_PROBES` 를 `Record<EventDomain, DomainProbe>` 로
 *      타입 고정. `EventDomain` union 에 10번째 domain 을 추가하면 이 테이블에
 *      키가 없어 `tsc` 가 컴파일 에러로 잡는다 (누락 강제 검출).
 *   2. runtime — 그 테이블을 순회하며 각 domain 을 실제 라우팅. `routeNormalHandler`
 *      / `routeGapHandler` 의 `switch` 에 그 domain case 가 없으면 handler 가
 *      호출되지 않아 단언이 fail 한다 (switch 는 default throw 없이 silent no-op).
 *
 * 역할 분담: `stateChanged.test.ts` = domain×op 세부 매트릭스(normal 경로 상세).
 *            `version-gap.test.ts` = gap 감지 임계/baseline 의미론(단일 domain).
 *            본 파일 = 9 domain 이 normal+gap 두 라우터에 모두 존재하는지의
 *            완전성 가드 하나만. op 세부는 재검증하지 않는다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  type EventDomain,
  type EventOp,
  resetStateChangedRegistryForTests,
  STATE_CHANGED_EVENT,
  setStateChangedHandlers,
  type StateChangedPayload,
} from "./stateChanged";

const BASE: Omit<
  StateChangedPayload,
  "domain" | "op" | "entityId" | "version"
> = {
  snapshotVersion: 0,
  originWindow: null,
  emittedAt: 1700000000000,
};

interface DomainProbe {
  /** An op the normal router routes to a handler for this domain. */
  op: EventOp;
  entityId: string | null;
  /**
   * Install this domain's normal handler + its `onGapDetected` as spies.
   * Literal domain keys keep the `setStateChangedHandlers` argument well
   * typed (a computed key would widen to a string index).
   */
  register: () => {
    normal: ReturnType<typeof vi.fn>;
    gap: ReturnType<typeof vi.fn>;
  };
}

// `Record<EventDomain, ...>` → compile-time completeness. A new domain in
// the `EventDomain` union that is not added here is a `tsc` error.
const DOMAIN_PROBES: Record<EventDomain, DomainProbe> = {
  connection: {
    op: "update",
    entityId: "conn-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        connection: { onCrudChanged: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  group: {
    op: "update",
    entityId: "grp-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        group: { onCrudChanged: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  workspace: {
    op: "update",
    entityId: "ws-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        workspace: { onUpdated: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  mru: {
    op: "bulk",
    entityId: null,
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        mru: { onBulkChanged: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  favorite: {
    op: "update",
    entityId: "fav-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        favorite: { onCrudChanged: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  history: {
    op: "create",
    entityId: "hist-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        history: { onCreated: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  setting: {
    op: "update",
    entityId: "theme",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        setting: { onUpdated: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  schemaCache: {
    op: "invalidate",
    entityId: "conn-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        schemaCache: { onInvalidate: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
  datagridColumnPrefs: {
    op: "update",
    entityId: "grid-1",
    register: () => {
      const normal = vi.fn();
      const gap = vi.fn();
      setStateChangedHandlers({
        datagridColumnPrefs: { onUpdated: normal, onGapDetected: gap },
      });
      return { normal, gap };
    },
  },
};

function payloadFor(
  domain: EventDomain,
  probe: DomainProbe,
  version: number,
): StateChangedPayload {
  return { ...BASE, domain, op: probe.op, entityId: probe.entityId, version };
}

const ALL_DOMAINS = Object.keys(DOMAIN_PROBES) as EventDomain[];

describe("nine-domain router completeness", () => {
  beforeEach(() => {
    resetStateChangedRegistryForTests();
  });

  // Reason: normal 라우터가 9 domain 모두를 등록 handler 로 라우팅 —
  // switch case 누락이면 handler 미호출로 fail. 이슈 #1627 (2026-07-24)
  it.each(ALL_DOMAINS)(
    "routes a normal %s event to its registered handler",
    (domain) => {
      const probe = DOMAIN_PROBES[domain];
      const { normal, gap } = probe.register();

      dispatchStateChangedPayload("self", payloadFor(domain, probe, 1));

      expect(
        normal,
        `routeNormalHandler is missing a case for "${domain}"`,
      ).toHaveBeenCalledTimes(1);
      expect(gap).not.toHaveBeenCalled();
    },
  );

  // Reason: gap 라우터가 9 domain 모두를 onGapDetected 로 라우팅 —
  // version > baseline+1 일 때. switch case 누락이면 fail. 이슈 #1627 (2026-07-24)
  it.each(ALL_DOMAINS)(
    "routes a version-gap %s event to onGapDetected",
    (domain) => {
      const probe = DOMAIN_PROBES[domain];
      const { normal, gap } = probe.register();

      // v1 establishes the baseline via the normal path...
      dispatchStateChangedPayload("self", payloadFor(domain, probe, 1));
      // ...then v3 skips v2 → gap detection routes to onGapDetected.
      dispatchStateChangedPayload("self", payloadFor(domain, probe, 3));

      expect(
        gap,
        `routeGapHandler is missing a case for "${domain}"`,
      ).toHaveBeenCalledTimes(1);
      // Gap recovery replaces the per-event handler; it is not called again.
      expect(normal).toHaveBeenCalledTimes(1);
    },
  );

  // Reason: FE 상수는 backend `src-tauri/src/events.rs::STATE_CHANGED_EVENT`
  // 와의 wire-name 계약 미러. 값이 어긋나면 cross-window delivery 가 조용히
  // 끊긴다 (backend 쪽 parity 는 Rust listen 테스트가 검증). 이슈 #1627 (2026-07-24)
  it("exports the canonical `state-changed` wire name", () => {
    expect(STATE_CHANGED_EVENT).toBe("state-changed");
  });
});

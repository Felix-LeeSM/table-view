/**
 * Purpose: the 9-domain completeness invariant of the cross-window
 * `state-changed` router — F.4 (rewritten under issue #1627, 2026-07-24)
 *
 * Reason (rewrite): the previous version was a change-detector that ran
 * `readFileSync` + a string grep over the `stateChanged.ts` source to count
 * `case "<domain>":` occurrences (a P2/P9 violation — source string
 * matching). Router completeness is a legitimate intent, but the means was
 * coupled to the source text: it never observed actual routing, and a
 * comment rename or a format change alone broke it.
 *
 * Rewrite approach: **actually dispatch** each domain through both the
 * normal and gap routers and assert the registered handler calls
 * (behavioral). Completeness is locked in two layers.
 *   1. compile-time — `DOMAIN_PROBES` is typed as
 *      `Record<EventDomain, DomainProbe>`. Adding a 10th domain to the
 *      `EventDomain` union leaves this table without that key, and `tsc`
 *      reports a compile error (the omission is forced into view).
 *   2. runtime — iterate that table and actually route each domain. If the
 *      `switch` in `routeNormalHandler` / `routeGapHandler` lacks that
 *      domain's case, the handler is not called and the assertion fails
 *      (the switch has no default throw; a missing case is a silent no-op).
 *
 * Division of roles:
 *   `stateChanged.test.ts` = the detailed domain×op matrix (normal path).
 *   `version-gap.test.ts` = gap-detection threshold/baseline semantics.
 *   This file = only the completeness guard that all 9 domains exist in
 *   both the normal and gap routers. It does not re-verify op details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  dispatchStateChangedPayload,
  type EventDomain,
  type EventOp,
  resetStateChangedRegistryForTests,
  STATE_CHANGED_EVENT,
  type StateChangedPayload,
  setStateChangedHandlers,
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

  // Reason: the normal router routes all 9 domains to their registered
  // handler — a missing switch case leaves the handler uncalled and fails.
  // Issue #1627 (2026-07-24)
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

  // Reason: the gap router routes all 9 domains to onGapDetected when
  // version > baseline+1. A missing switch case fails. Issue #1627
  // (2026-07-24)
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

  // Reason: the FE constant mirrors the wire-name contract with the backend
  // `src-tauri/src/events.rs::STATE_CHANGED_EVENT`. If the values drift
  // apart, cross-window delivery silently breaks (the Rust listen tests
  // verify the backend-side parity). Issue #1627 (2026-07-24)
  it("exports the canonical `state-changed` wire name", () => {
    expect(STATE_CHANGED_EVENT).toBe("state-changed");
  });
});

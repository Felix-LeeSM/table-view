import { describe, it, expect, vi, beforeEach } from "vitest";

// 2026-05-06 — Sprint 224 (P10 step 3a). The `hydrateFromSession` body
// (readConnectionSession + partial-patch + set(patch)) used to live inside
// `connectionStore.ts`. It moved here so the store stays a pure
// state-transition module. These cases migrate verbatim from
// `connectionStore.test.ts` (lines 950-984 pre-Sprint 224):
//   1. `hydrateFromSession restores focusedConnId and activeStatuses`
//   2. `hydrateFromSession is a no-op when session is empty`
// Assertion logic is identical — only the mount differs (direct
// `hydrateConnectionSession()` call instead of
// `useConnectionStore.getState().hydrateFromSession()`).
//
// Mock pattern follows `useConnectionMutations.test.ts` /
// `useSchemaTableMutations.test.ts` — `vi.hoisted` + factory mock for
// `@stores/connectionStore` (exposing `setState` / `getState`) +
// `@lib/scopedLocalStorage` (exposing `readConnectionSession`). The store is
// modelled as a plain mutable object so post-call assertions read the
// final shape directly.

const { storeState, mockSetState, mockGetState, mockReadConnectionSession } =
  vi.hoisted(() => {
    const state: {
      focusedConnId: string | null;
      activeStatuses: Record<string, unknown>;
    } = {
      focusedConnId: null,
      activeStatuses: {},
    };
    return {
      storeState: state,
      mockSetState: vi.fn((patch: Partial<typeof state>) => {
        Object.assign(state, patch);
      }),
      mockGetState: vi.fn(() => state),
      mockReadConnectionSession: vi.fn(
        (): {
          focusedConnId: string | null;
          activeStatuses: Record<string, unknown> | null;
        } => ({
          focusedConnId: null,
          activeStatuses: null,
        }),
      ),
    };
  });

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: Object.assign(
    (selector: (s: unknown) => unknown) => selector(storeState),
    { getState: mockGetState, setState: mockSetState },
  ),
}));

vi.mock("@lib/scopedLocalStorage", () => ({
  readConnectionSession: () => mockReadConnectionSession(),
}));

import { hydrateConnectionSession } from "./useConnectionSessionHydration";

describe("useConnectionSessionHydration", () => {
  beforeEach(() => {
    storeState.focusedConnId = null;
    storeState.activeStatuses = {};
    mockSetState.mockClear();
    mockGetState.mockClear();
    mockReadConnectionSession.mockReset();
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: null,
    });
  });

  it("hydrateFromSession restores focusedConnId and activeStatuses", () => {
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "c2",
      activeStatuses: {
        c1: { type: "connected", activeDb: "prod" },
        c2: { type: "connected", activeDb: "dev" },
      },
    });

    hydrateConnectionSession();

    expect(storeState.focusedConnId).toBe("c2");
    expect(storeState.activeStatuses["c1"]).toEqual({
      type: "connected",
      activeDb: "prod",
    });
    expect(storeState.activeStatuses["c2"]).toEqual({
      type: "connected",
      activeDb: "dev",
    });
  });

  it("hydrateFromSession is a no-op when session is empty", () => {
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: null,
    });

    hydrateConnectionSession();

    expect(storeState.focusedConnId).toBeNull();
    expect(storeState.activeStatuses).toEqual({});
    // Empty patch ⇒ setState was NOT called (byte-equivalent to the
    // pre-extraction store body's `if (Object.keys(patch).length > 0)`
    // guard).
    expect(mockSetState).not.toHaveBeenCalled();
  });

  it("hydrateFromSession applies focusedConnId only when activeStatuses is missing", () => {
    // Partial-session edge: only focusedConnId is set; activeStatuses must
    // not be touched. (Byte-equivalent to the store body's two-conditional
    // `patch.focusedConnId = ...` / `patch.activeStatuses = ...` guards.)
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: "c1",
      activeStatuses: null,
    });
    storeState.activeStatuses = { existing: { type: "connected" } };

    hydrateConnectionSession();

    expect(storeState.focusedConnId).toBe("c1");
    // existing activeStatuses untouched
    expect(storeState.activeStatuses).toEqual({
      existing: { type: "connected" },
    });
    expect(mockSetState).toHaveBeenCalledTimes(1);
    expect(mockSetState).toHaveBeenCalledWith({ focusedConnId: "c1" });
  });

  it("hydrateFromSession applies activeStatuses only when focusedConnId is missing", () => {
    // Partial-session edge: only activeStatuses is set; focusedConnId must
    // not be touched.
    mockReadConnectionSession.mockReturnValue({
      focusedConnId: null,
      activeStatuses: { c1: { type: "connected" } },
    });
    storeState.focusedConnId = "previous";

    hydrateConnectionSession();

    expect(storeState.focusedConnId).toBe("previous");
    expect(storeState.activeStatuses["c1"]).toEqual({ type: "connected" });
    expect(mockSetState).toHaveBeenCalledTimes(1);
    expect(mockSetState).toHaveBeenCalledWith({
      activeStatuses: { c1: { type: "connected" } },
    });
  });
});

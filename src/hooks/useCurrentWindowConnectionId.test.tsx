// Written 2026-05-16
//
// Reason: state-management-strategy Q15 lock — the workspace window's
// connection identity is no longer `connectionStore.focusedConnId`; it is
// derived from the Tauri window label (`workspace-{connection_id}`). This
// hook does that derivation, so workspace-tree callers such as Sidebar and
// useCurrentWorkspaceKey read the memoized value through it instead of
// calling `parseWorkspaceLabel` directly.
//
// AC mapping:
//   - AC-366-01: launcher window → null
//   - AC-366-02: workspace window → connection_id
//   - AC-366-03: invalid label → null
//
// Scenario principles (testing-scenarios):
//   - Happy path: workspace-conn-1 → "conn-1"
//   - Empty/missing input: label === null (Tauri inactive) → null
//   - State transition: a fresh mount under a different label → a new
//     result

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lib/window-label", async () => {
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(),
  };
});

import { getCurrentWindowLabel } from "@lib/window-label";
import { useCurrentWindowConnectionId } from "./useCurrentWindowConnectionId";

const mockedGetLabel = vi.mocked(getCurrentWindowLabel);

describe("useCurrentWindowConnectionId", () => {
  beforeEach(() => {
    mockedGetLabel.mockReset();
  });

  afterEach(() => {
    mockedGetLabel.mockReset();
  });

  it("AC-366-01: returns null on the launcher window", () => {
    // Reason: the launcher window's label is bare `"launcher"`. That window
    // has no notion of connection identity at all (the user has not picked a
    // connection *yet*), so the hook returns null. When this value reaches
    // the workspace tree cascade (Sidebar etc.), that side reads it as "no
    // connection focused".
    mockedGetLabel.mockReturnValue("launcher");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("AC-366-02: returns the connection_id for a workspace label", () => {
    // Reason: the workspace window's label follows the round-trip pattern
    // `workspace-{connection_id}`. The hook must extract the conn id from the
    // label and return it. This is the core derivation that makes each
    // workspace show only its own connection in multi-window scenarios.
    mockedGetLabel.mockReturnValue("workspace-conn-1");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBe("conn-1");
  });

  it("AC-366-03: returns null for an unknown label string", () => {
    // Reason: an unrecognized label (e.g. an external tool attached, or a
    // leftover path) → null as the safe fallback. Call sites treat null as
    // "no focus", so no unsafe state leaks.
    mockedGetLabel.mockReturnValue("ghost-label");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null when getCurrentWindowLabel returns null (Tauri 비활성)", () => {
    // Reason: in an environment without a Tauri runtime, such as vitest
    // jsdom, getCurrentWindowLabel() returns null. The hook must pass that
    // signal through and fall back to null — that way workspace tree
    // components can mount without a fake Tauri.
    mockedGetLabel.mockReturnValue(null);
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null for the legacy bare 'workspace' label (pre-sprint-361)", () => {
    // Reason: the bare `"workspace"` label is no longer emitted, but if it
    // surfaces from an external path, null is the safe fallback. (The router
    // uses the same fallback — locked by `window-label.test.ts` and
    // `window-resolve.test.tsx`.)
    mockedGetLabel.mockReturnValue("workspace");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("returns null for an empty conn_id (`workspace-`)", () => {
    // Reason: parseWorkspaceLabel returns null for the degenerate
    // "workspace-" label (window-label.ts:60). The hook must pass that
    // decision through unchanged.
    mockedGetLabel.mockReturnValue("workspace-");
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBeNull();
  });

  it("preserves UUID-style conn_id with internal dashes", () => {
    // Reason: a connection_id that is a UUID — strip only the `workspace-`
    // prefix and keep the body. Checks that the hook does not break
    // parseWorkspaceLabel's round-trip guarantee.
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    mockedGetLabel.mockReturnValue(`workspace-${uuid}`);
    const { result } = renderHook(() => useCurrentWindowConnectionId());
    expect(result.current).toBe(uuid);
  });
});

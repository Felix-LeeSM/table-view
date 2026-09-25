/**
 * Test helper for stubbing the connection id derived from the Tauri webview
 * window's label (Q15).
 *
 * The workspace tree reads its connection identity from
 * `useCurrentWindowConnectionId()`, which in turn reads
 * `getCurrentWindowLabel()`, so RTL tests of workspace-tree components stub
 * the label rather than the `connectionStore.focusedConnId` slot.
 *
 * Usage pattern (each test file that mounts a workspace-tree component):
 *
 *   vi.mock("@lib/window-label", async () => {
 *     const actual = await vi.importActual<typeof import("@lib/window-label")>(
 *       "@lib/window-label",
 *     );
 *     return { ...actual, getCurrentWindowLabel: vi.fn() };
 *   });
 *
 *   import { setFakeWindowConnectionId } from "@stores/__tests__/fakeWindowConnectionId";
 *
 *   beforeEach(() => setFakeWindowConnectionId("conn1"));
 *
 * `vi.mock` cannot live inside this helper because vitest hoists it to
 * the top of the importer's file — the helper exposes the *setter* once
 * the mock is in place.
 */

import { formatWorkspaceLabel, getCurrentWindowLabel } from "@lib/window-label";
import { vi } from "vitest";

/**
 * Stub `getCurrentWindowLabel()` to return a synthetic workspace label
 * for `connectionId`. Pass `null` to simulate the launcher window /
 * jsdom-only environment (the hook then returns null — the "no connection
 * focused" default).
 *
 * Requires the importer to have already declared the
 * `vi.mock("@lib/window-label", ...)` block — see file-level docstring.
 */
export function setFakeWindowConnectionId(connectionId: string | null): void {
  const mocked = vi.mocked(getCurrentWindowLabel);
  if (connectionId === null) {
    // Launcher / jsdom: the hook returns null, matching `focusedConnId`'s
    // null default. Mirroring that here keeps tests that don't care about
    // the window label working.
    mocked.mockReturnValue(null);
  } else {
    mocked.mockReturnValue(formatWorkspaceLabel(connectionId));
  }
}

/**
 * Reset the label stub so subsequent renders fall through to the real
 * `getCurrentWindowLabel()` (which returns null in jsdom). Pair with
 * `afterEach` to avoid cross-test bleed.
 */
export function resetFakeWindowConnectionId(): void {
  vi.mocked(getCurrentWindowLabel).mockReset();
}

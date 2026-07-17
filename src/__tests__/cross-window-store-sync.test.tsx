/**
 * Sprint 153 — TDD-FIRST cross-window sync tests for the remaining shared
 * stores (`tabStore`, `mruStore`, `themeStore`, `favoritesStore`) plus the
 * app-shell window context (window-scoped, deliberately unbridged).
 *
 * Authored BEFORE the per-store `attachZustandIpcBridge` wirings ship.
 * Against pre-Sprint-153 code these cases fail because none of the four
 * stores yet broadcast on their respective channels and inbound payloads
 * are not applied.
 *
 * Pattern follows `cross-window-connection-sync.test.tsx`:
 *  - one in-process event bus mocked via `vi.hoisted` so the module-load
 *    `attachZustandIpcBridge(...)` calls inside each store register their
 *    listener BEFORE the test file's locals would otherwise initialize.
 *  - per-store `vi.mock("@lib/window-label", ...)` for the workspace-only
 *    attach guard on `tabStore`.
 *
 * Acceptance coverage:
 *  - AC-153-01 — `tabStore`'s workspace-only attach guard (launcher does
 *    NOT register a listener on `tab-sync`, mutations from a workspace
 *    bridge do not bleed into the launcher's tabs).
 *  - AC-153-02 — `mruStore` symmetric sync.
 *  - AC-153-03 — `themeStore` symmetric sync.
 *  - AC-153-04 — `favoritesStore` symmetric sync.
 *  - AC-153-07 — allowlist filter (workspace `tabStore` does NOT broadcast
 *    `dirtyTabIds` / `closedTabHistory`, both of which are window-local).
 *  - AC-153-07 — error path: malformed inbound payloads are silently
 *    ignored on every channel.
 *  - app-shell window context is window-scoped (no bridge attached, so the
 *    context is never sent on any channel).
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import type { ConnectionId, TabId } from "@/types/branded";
import {
  doMockTauriModule,
  doUnmockTauriModule,
  setupTauriMock,
} from "@/test-utils/tauriMock";
import {
  seedWorkspace,
  getTestWorkspace,
} from "@/stores/__tests__/workspaceStoreTestHelpers";

// ---------------------------------------------------------------------------
// Shared in-process event bus mock for `@tauri-apps/api/event`.
//
// Hoisted via `vi.hoisted` so the bus map exists BEFORE every store module's
// load-time `attachZustandIpcBridge()` call. Without hoisting, the bus would
// still be `undefined` when the bridges register and the inbound-apply tests
// would silently pass against a no-op listener.
// ---------------------------------------------------------------------------

interface BusEnvelope {
  event: string;
  payload: unknown;
}

const busModule = vi.hoisted(() => {
  const bus = new Map<string, Set<(env: BusEnvelope) => void>>();
  return {
    bus,
    emit: vi.fn(async (event: string, payload?: unknown) => {
      const listeners = bus.get(event);
      if (!listeners) return;
      for (const listener of [...listeners]) {
        listener({ event, payload });
      }
    }),
    listen: vi.fn(async (event: string, handler: (e: BusEnvelope) => void) => {
      let set = bus.get(event);
      if (!set) {
        set = new Set<(env: BusEnvelope) => void>();
        bus.set(event, set);
      }
      set.add(handler);
      return () => {
        set?.delete(handler);
      };
    }),
  };
});

function busEmit(event: string, payload: unknown): void {
  const listeners = busModule.bus.get(event);
  if (!listeners) return;
  for (const listener of [...listeners]) {
    listener({ event, payload });
  }
}

vi.mock("@tauri-apps/api/event", () => ({
  emit: busModule.emit,
  listen: busModule.listen,
}));

// Sprint 368 (Phase 4 Q12) — theme / safe-mode actions invoke
// `persist_setting`. Mock to immediate-resolve so the unawaited promise in
// the legacy bridge regression below doesn't surface as an unhandled
// rejection.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));
beforeEach(() => {
  setupTauriMock({
    listConnections: vi.fn(() => Promise.resolve([])),
    listGroups: vi.fn(() => Promise.resolve([])),
    saveConnection: vi.fn(() => Promise.resolve({})),
    deleteConnection: vi.fn(() => Promise.resolve()),
    testConnection: vi.fn(() => Promise.resolve("ok")),
    connectToDatabase: vi.fn(() => Promise.resolve()),
    disconnectFromDatabase: vi.fn(() => Promise.resolve()),
    saveGroup: vi.fn(() => Promise.resolve({})),
    deleteGroup: vi.fn(() => Promise.resolve()),
    moveConnectionToGroup: vi.fn(() => Promise.resolve()),
  });
});

// Default the window label to a real `workspace-{connection_id}` label so
// `workspaceStore`'s attach guard fires at module load. #1097: the guard used
// to compare against the bare legacy `"workspace"` label that sprint-361 no
// longer produces, so mocking bare `"workspace"` here masked the dead branch.
// Mocking the real format keeps this file honest — the guard must accept
// `parseWorkspaceLabel(label) !== null`, not a byte-for-byte `"workspace"`.
// The launcher-only test below re-imports the store with the label flipped to
// "launcher" via `vi.resetModules` + `vi.doMock`.
const WORKSPACE_LABEL = "workspace-c1";
vi.mock("@lib/window-label", async () => {
  // sprint-366 (2026-05-16) — keep the real parseWorkspaceLabel /
  // formatWorkspaceLabel exports (pure string ops) so
  // `useCurrentWindowConnectionId()` and downstream selectors don't
  // crash when this file's tests mount workspace-tree components.
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(() => "workspace-c1"),
  };
});

// Import AFTER all mocks are registered.
import { emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { useMruStore } from "@stores/mruStore";
import { useThemeStore } from "@stores/themeStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useSafeModeStore } from "@stores/safeModeStore";
import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
  type StateChangedPayload,
} from "@lib/events/stateChanged";
import {
  registerSettingReceiver,
  resetSettingReceiverForTests,
} from "@lib/runtime/settings/settingsReceiver";

const mockedEmit = emit as unknown as Mock;
const mockedInvoke = invoke as unknown as Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Simulate a remote window emitting on the given channel. Mirrors what the
 * Sprint 151 bridge ships on the wire: `{ origin, state }` envelope.
 */
function simulateRemoteEmit(
  channel: string,
  origin: string,
  state: Record<string, unknown>,
): void {
  busEmit(channel, { origin, state });
}

function resetTabStore(): void {
  useWorkspaceStore.setState({ workspaces: {} });
}

function resetMruStore(): void {
  useMruStore.setState({ lastUsedConnectionId: null, recentConnections: [] });
}

function resetFavoritesStore(): void {
  useFavoritesStore.setState({ favorites: [] });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-window store sync (Sprint 153)", () => {
  beforeEach(async () => {
    resetTabStore();
    resetMruStore();
    resetFavoritesStore();
    // Drain microtasks so any module-load `void attach...` listener
    // registration has settled before each test fires events.
    await Promise.resolve();
    await Promise.resolve();
    mockedEmit.mockClear();
  });

  afterEach(() => {
    resetTabStore();
    resetMruStore();
    resetFavoritesStore();
  });

  // -------------------------------------------------------------------------
  // tabStore — workspace-only sync (AC-153-01)
  // -------------------------------------------------------------------------

  describe("tabStore (workspace-only)", () => {
    // ADR 0027 (Sprint 262) — the cross-window bridge moved off the flat
    // `tab-sync` channel onto the per-workspace `workspace-sync` channel.
    // The wire payload now carries `{ workspaces }` (a 2-level map keyed
    // by `(connId, db)`) instead of the flat `{ tabs, activeTabId }`.
    // Workspace-local fields (`closedTabHistory`, `dirtyTabIds`,
    // `sidebar`) live INSIDE each per-(connId, db) slot and divergence
    // there is acceptable — the same window-local exclusion intent as
    // the legacy bridge.
    it("AC-153-01a: workspace mutation of `workspaces` emits on `workspace-sync`", async () => {
      mockedEmit.mockClear();
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-A" as TabId,
              title: "users",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
            },
          ],
          "tab-A",
        ),
      );
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "workspace-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      expect(payload.origin).toBe(WORKSPACE_LABEL);
      expect(payload.state).toHaveProperty("workspaces");
    });

    it("AC-153-01b: a remote workspace emit applies to the local workspace store", async () => {
      simulateRemoteEmit("workspace-sync", "workspace-2", {
        workspaces: {
          c2: {
            db1: {
              tabs: [
                {
                  type: "table",
                  id: "tab-remote",
                  title: "remote",
                  connectionId: "c2",
                  closable: true,
                  schema: "public",
                  table: "remote",
                  subView: "records",
                },
              ],
              activeTabId: "tab-remote",
              closedTabHistory: [],
              dirtyTabIds: [],
              sidebar: { selectedNode: null, expanded: [], scrollTop: 0 },
            },
          },
        },
      });
      await Promise.resolve();

      const state = getTestWorkspace("c2", "db1");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe("tab-remote");
      expect(state.activeTabId).toBe("tab-remote");
    });

    it("AC-153-06 (tabStore): wire payload carries only the `workspaces` field", async () => {
      mockedEmit.mockClear();
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-C" as TabId,
              title: "c",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "c",
              subView: "records",
            },
          ],
          "tab-C",
          "conn1",
          "db1",
          { dirtyTabIds: ["tab-C"], closedTabHistory: [] },
        ),
      );
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "workspace-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      // Per ADR 0027 the wire payload is `{ workspaces }`; per-slot
      // window-local fields (`dirtyTabIds`, `closedTabHistory`, sidebar)
      // still travel inside the slot — divergence on those is by design.
      expect(Object.keys(payload.state).sort()).toEqual(["workspaces"]);
    });

    it("AC-153-07 (tabStore): malformed `workspace-sync` payload does not throw or pollute state", async () => {
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-keep" as TabId,
              title: "users",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
            },
          ],
          "tab-keep",
        ),
      );

      expect(() => {
        busEmit("workspace-sync", null);
        busEmit("workspace-sync", "not-an-object");
        busEmit("workspace-sync", { origin: "workspace-2" });
        busEmit("workspace-sync", { origin: "workspace-2", state: "string" });
        busEmit("workspace-sync", { origin: "workspace-2", state: null });
        busEmit("workspace-sync", {
          origin: "workspace-2",
          state: { unknown: 1 },
        });
      }).not.toThrow();
      await Promise.resolve();

      // seedWorkspace auto-derives connId from `firstTab.connectionId` ("c1").
      const state = getTestWorkspace("c1", "db1");
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe("tab-keep");
      expect(state.activeTabId).toBe("tab-keep");
    });

    it("AC-153-01c (workspace-only): a fresh tabStore module loaded as launcher does NOT receive workspace tab updates", async () => {
      // Re-import tabStore with the window-label flipped to "launcher". The
      // attach guard inside tabStore must short-circuit, so this fresh store
      // does NOT register a listener on `tab-sync`. A subsequent remote emit
      // must therefore leave the launcher's tabs untouched.
      vi.resetModules();
      vi.doMock("@lib/window-label", async () => {
        const actual =
          await vi.importActual<typeof import("@lib/window-label")>(
            "@lib/window-label",
          );
        return { ...actual, getCurrentWindowLabel: vi.fn(() => "launcher") };
      });
      vi.doMock("@tauri-apps/api/event", () => ({
        emit: busModule.emit,
        listen: busModule.listen,
      }));
      setupTauriMock({
        listConnections: vi.fn(() => Promise.resolve([])),
        listGroups: vi.fn(() => Promise.resolve([])),
        saveConnection: vi.fn(() => Promise.resolve({})),
        deleteConnection: vi.fn(() => Promise.resolve()),
        testConnection: vi.fn(() => Promise.resolve("ok")),
        connectToDatabase: vi.fn(() => Promise.resolve()),
        disconnectFromDatabase: vi.fn(() => Promise.resolve()),
        saveGroup: vi.fn(() => Promise.resolve({})),
        deleteGroup: vi.fn(() => Promise.resolve()),
        moveConnectionToGroup: vi.fn(() => Promise.resolve()),
      });
      doMockTauriModule();

      const { useWorkspaceStore: launcherWorkspaceStore } =
        await import("@stores/workspaceStore");
      // Reset the freshly-imported store to a known clean baseline.
      launcherWorkspaceStore.setState({ workspaces: {} });
      await Promise.resolve();
      await Promise.resolve();

      // Simulate the workspace broadcasting tab updates. If the launcher had
      // attached a listener, this would mutate the launcher's tabs.
      simulateRemoteEmit("tab-sync", "workspace", {
        tabs: [
          {
            type: "table",
            id: "tab-from-workspace",
            title: "from-ws",
            connectionId: "c1" as ConnectionId,
            closable: true,
            schema: "public",
            table: "ws",
            subView: "records",
          },
        ],
        activeTabId: "tab-from-workspace",
      });
      await Promise.resolve();

      // Launcher's tabs MUST stay empty.
      expect(
        launcherWorkspaceStore.getState().workspaces["conn1"]?.["db1"]?.tabs ??
          [],
      ).toHaveLength(0);
      expect(
        launcherWorkspaceStore.getState().workspaces["conn1"]?.["db1"]
          ?.activeTabId ?? null,
      ).toBeNull();

      vi.doUnmock("@lib/window-label");
      vi.doUnmock("@tauri-apps/api/event");
      doUnmockTauriModule();
    });
  });

  // -------------------------------------------------------------------------
  // workspaceStore — cross-window bridge label guard (#1097)
  //
  // sprint-361 renamed workspace windows from bare `"workspace"` to
  // `workspace-{connection_id}`, but the attach guard kept a strict
  // `=== "workspace"` compare, so the `workspace-sync` bridge never attached
  // (dead code). The fix routes the guard through `parseWorkspaceLabel`, the
  // single label parser, so it tracks the real format. These pin the single
  // sync path (the bridge) the way AC-1122 pins safeMode's single path:
  //   (a) a real `workspace-{id}` label DOES attach — a mutation broadcasts
  //       on `workspace-sync` tagged with that exact label (RED before the
  //       fix: the bridge never attached so no emit fires).
  //   (b) the legacy bare `"workspace"` label sprint-361 no longer produces
  //       does NOT attach — the guard is format-aware, not a loosened
  //       `startsWith("workspace")` that would re-admit the dead label.
  // -------------------------------------------------------------------------

  describe("workspaceStore bridge label guard (#1097)", () => {
    it("AC-1097-01: a `workspace-{id}` window attaches the bridge and broadcasts on `workspace-sync` tagged with its real label", async () => {
      mockedEmit.mockClear();
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-1097" as TabId,
              title: "users",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "users",
              subView: "records",
            },
          ],
          "tab-1097",
        ),
      );
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "workspace-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as { origin: string };
      // The regression: origin is the real `workspace-{connection_id}` label,
      // proving the guard matched the sprint-361 format (not bare "workspace").
      expect(payload.origin).toBe(WORKSPACE_LABEL);
    });

    it("AC-1097-02: a fresh store loaded under the legacy bare `workspace` label does NOT attach", async () => {
      // Re-import with the label pinned to the pre-sprint-361 bare
      // `"workspace"`. `parseWorkspaceLabel("workspace")` is null, so the
      // guard must short-circuit — the bridge does not attach and a local
      // mutation emits nothing on `workspace-sync`. A naive
      // `startsWith("workspace")` guard would wrongly re-admit this label.
      vi.resetModules();
      vi.doMock("@lib/window-label", async () => {
        const actual =
          await vi.importActual<typeof import("@lib/window-label")>(
            "@lib/window-label",
          );
        return { ...actual, getCurrentWindowLabel: vi.fn(() => "workspace") };
      });
      vi.doMock("@tauri-apps/api/event", () => ({
        emit: busModule.emit,
        listen: busModule.listen,
      }));
      setupTauriMock({
        listConnections: vi.fn(() => Promise.resolve([])),
        listGroups: vi.fn(() => Promise.resolve([])),
        saveConnection: vi.fn(() => Promise.resolve({})),
        deleteConnection: vi.fn(() => Promise.resolve()),
        testConnection: vi.fn(() => Promise.resolve("ok")),
        connectToDatabase: vi.fn(() => Promise.resolve()),
        disconnectFromDatabase: vi.fn(() => Promise.resolve()),
        saveGroup: vi.fn(() => Promise.resolve({})),
        deleteGroup: vi.fn(() => Promise.resolve()),
        moveConnectionToGroup: vi.fn(() => Promise.resolve()),
      });
      doMockTauriModule();

      const { useWorkspaceStore: bareWorkspaceStore } =
        await import("@stores/workspaceStore");
      bareWorkspaceStore.setState({ workspaces: {} });
      await Promise.resolve();
      await Promise.resolve();
      mockedEmit.mockClear();

      bareWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-bare" as TabId,
              title: "bare",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "bare",
              subView: "records",
            },
          ],
          "tab-bare",
        ),
      );
      await Promise.resolve();

      const channels = mockedEmit.mock.calls.map((call) => call[0]);
      expect(channels).not.toContain("workspace-sync");

      vi.doUnmock("@lib/window-label");
      vi.doUnmock("@tauri-apps/api/event");
      doUnmockTauriModule();
    });
  });

  // -------------------------------------------------------------------------
  // mruStore — symmetric sync (AC-153-02)
  // -------------------------------------------------------------------------

  describe("mruStore (symmetric)", () => {
    it("AC-153-02a: workspace markConnectionUsed emits on `mru-sync`", async () => {
      mockedEmit.mockClear();
      useMruStore.getState().markConnectionUsed("c-fresh");
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "mru-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      expect(payload.state).toMatchObject({
        lastUsedConnectionId: "c-fresh",
      });
    });

    it("AC-153-02b: an inbound `mru-sync` payload is applied locally", async () => {
      simulateRemoteEmit("mru-sync", "launcher", {
        lastUsedConnectionId: "c-from-launcher",
      });
      await Promise.resolve();

      expect(useMruStore.getState().lastUsedConnectionId).toBe(
        "c-from-launcher",
      );
    });

    it("AC-153-07 (mruStore): malformed payload is silently ignored", async () => {
      useMruStore.setState({ lastUsedConnectionId: "stable" });

      expect(() => {
        busEmit("mru-sync", null);
        busEmit("mru-sync", { origin: "launcher" });
        busEmit("mru-sync", { origin: "launcher", state: "string" });
        busEmit("mru-sync", { origin: "launcher", state: { unknown: 1 } });
      }).not.toThrow();
      await Promise.resolve();

      expect(useMruStore.getState().lastUsedConnectionId).toBe("stable");
    });
  });

  // -------------------------------------------------------------------------
  // themeStore — symmetric sync (AC-153-03)
  // -------------------------------------------------------------------------

  describe("themeStore (symmetric)", () => {
    it("AC-153-03a: setMode emits on `theme-sync` carrying themeId + mode", async () => {
      mockedEmit.mockClear();
      // Sprint 368: setMode is now async (await IPC). Await before the
      // assertion so the bridge has a chance to emit on the post-IPC
      // store mutate.
      await useThemeStore.getState().setMode("dark");
      await Promise.resolve();
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "theme-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      expect(payload.state).toHaveProperty("mode");
      expect(payload.state).toHaveProperty("themeId");
      // resolvedMode is a derived field — it is allowed to be excluded; we
      // only assert mode/themeId here so the implementation has flexibility.
      expect(payload.state.mode).toBe("dark");
    });

    it("AC-153-03b: an inbound `theme-sync` payload converges the local store", async () => {
      simulateRemoteEmit("theme-sync", "launcher", {
        themeId: "github",
        mode: "light",
      });
      await Promise.resolve();

      const state = useThemeStore.getState();
      expect(state.themeId).toBe("github");
      expect(state.mode).toBe("light");
    });

    it("AC-153-07 (themeStore): malformed payload is silently ignored", async () => {
      useThemeStore.setState({ themeId: "github", mode: "system" });

      expect(() => {
        busEmit("theme-sync", null);
        busEmit("theme-sync", "garbage");
        busEmit("theme-sync", { origin: "launcher" });
        busEmit("theme-sync", { origin: "launcher", state: null });
      }).not.toThrow();
      await Promise.resolve();

      const state = useThemeStore.getState();
      // Original state preserved — malformed payloads cannot mutate.
      expect(state.themeId).toBe("github");
      expect(state.mode).toBe("system");
    });
  });

  // -------------------------------------------------------------------------
  // favoritesStore — symmetric sync (AC-153-04)
  // -------------------------------------------------------------------------

  describe("favoritesStore (symmetric)", () => {
    it("AC-153-04a: addFavorite emits on `favorites-sync`", async () => {
      mockedEmit.mockClear();
      useFavoritesStore.getState().addFavorite("My Q", "SELECT 1", null);
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "favorites-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      expect(payload.state).toHaveProperty("favorites");
      const favs = payload.state.favorites as Array<{ name: string }>;
      expect(favs).toHaveLength(1);
      expect(favs[0]!.name).toBe("My Q");
    });

    it("AC-153-04b: an inbound `favorites-sync` payload converges the local store", async () => {
      simulateRemoteEmit("favorites-sync", "launcher", {
        favorites: [
          {
            id: "fav-9",
            name: "Remote",
            sql: "SELECT 9",
            connectionId: null,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      });
      await Promise.resolve();

      const state = useFavoritesStore.getState();
      expect(state.favorites).toHaveLength(1);
      expect(state.favorites[0]!.name).toBe("Remote");
    });

    it("AC-153-07 (favoritesStore): malformed payload is silently ignored", async () => {
      useFavoritesStore.setState({ favorites: [] });

      expect(() => {
        busEmit("favorites-sync", null);
        busEmit("favorites-sync", { origin: "launcher" });
        busEmit("favorites-sync", { origin: "launcher", state: "x" });
        busEmit("favorites-sync", {
          origin: "launcher",
          state: { unknown: 1 },
        });
      }).not.toThrow();
      await Promise.resolve();

      expect(useFavoritesStore.getState().favorites).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // safeModeStore — single sync path (settings receiver only), issue #1122
  //
  // safe_mode used to ride BOTH the zustand IPC bridge (`safe-mode-sync`
  // channel) AND the backend-first settings receiver. #1122 removed the
  // bridge so the backend-SOT receiver (`setting.update` → refetch) is the
  // sole path. These cases pin that single-path coherence:
  //   (a) a local `setMode` no longer emits on ANY bridge channel — the
  //       removed second path stays removed (red before the bridge removal).
  //   (b) a remote `setting.update` for `safe_mode` converges the local
  //       store to the refetched value — the surviving path still works.
  // -------------------------------------------------------------------------

  describe("safeModeStore (single sync path: settings receiver, #1122)", () => {
    async function flushReceiver(): Promise<void> {
      // dispatch → onUpdated → dispatchSettingUpdate → getSetting (invoke)
      // → parse → setState. Drain enough microtasks for the async chain.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    }

    function safeModeUpdatePayload(originWindow: string): StateChangedPayload {
      return {
        domain: "setting",
        op: "update",
        entityId: "safe_mode",
        // Unique ascending version so the dispatcher's dedup never drops it
        // (registry is reset per case, so any value clears the empty baseline).
        version: Date.now(),
        snapshotVersion: 0,
        originWindow,
        emittedAt: 1700000000000,
      };
    }

    beforeEach(() => {
      useSafeModeStore.setState({ mode: "warn" });
      resetStateChangedRegistryForTests();
      resetSettingReceiverForTests();
      registerSettingReceiver();
      // Default invoke → resolve undefined; per-case override for get_setting.
      mockedInvoke.mockReset();
      mockedInvoke.mockResolvedValue(undefined);
    });

    afterEach(() => {
      mockedInvoke.mockReset();
      mockedInvoke.mockResolvedValue(undefined);
    });

    it("AC-1122-01: local setMode does NOT broadcast on the removed `safe-mode-sync` bridge channel", async () => {
      mockedEmit.mockClear();
      await useSafeModeStore.getState().setMode("off");
      await Promise.resolve();

      const channels = mockedEmit.mock.calls.map((call) => call[0]);
      expect(channels).not.toContain("safe-mode-sync");
      expect(useSafeModeStore.getState().mode).toBe("off");
    });

    it("AC-1122-02: a remote safe_mode `setting.update` converges the local store via refetch", async () => {
      mockedInvoke.mockImplementation((cmd: string, args?: unknown) => {
        if (
          cmd === "get_setting" &&
          (args as { key?: string } | undefined)?.key === "safe_mode"
        ) {
          // strategy F.4 wire shape — bare JSON string literal.
          return Promise.resolve(JSON.stringify("strict"));
        }
        return Promise.resolve(undefined);
      });

      dispatchStateChangedPayload(
        "workspace",
        safeModeUpdatePayload("launcher"),
      );
      await flushReceiver();

      expect(useSafeModeStore.getState().mode).toBe("strict");
    });

    it("AC-1122-03: a self-origin safe_mode `setting.update` does NOT refetch (no double-apply)", async () => {
      // originWindow === currentWindowLabel ("workspace") → dispatcher
      // self-echo skip. The origin already applied via its IPC response, so
      // no `get_setting` refetch fires and the store is left untouched.
      dispatchStateChangedPayload(
        "workspace",
        safeModeUpdatePayload("workspace"),
      );
      await flushReceiver();

      const getCalls = mockedInvoke.mock.calls.filter(
        (call) => call[0] === "get_setting",
      );
      expect(getCalls).toHaveLength(0);
      expect(useSafeModeStore.getState().mode).toBe("warn");
    });
  });

  // -------------------------------------------------------------------------
  // app-shell window context — window-scoped (AC-153-05)
  // -------------------------------------------------------------------------

  describe("app-shell context (window-scoped, no bridge)", () => {
    it("AC-153-05: app-shell window context does NOT broadcast on any sync channel", async () => {
      // Sprint 153 originally locked this against the legacy app-shell
      // setter flipping a window-context field. Sprint 155 removed the
      // store entirely (multi-window split made the screen context
      // implied by `getCurrentWindowLabel()`). The user-observable
      // invariant the case pinned — "no app-shell channel exists, no
      // emit carries a window-context field" — survives untouched and is
      // still load-bearing: any future "appshell-sync" / "screen-sync" /
      // "window-context-sync" channel addition must trip this check.
      mockedEmit.mockClear();

      // Drive any signal that COULD plausibly trigger app-shell broadcast
      // in a regressed bridge (a tab mutation is the closest neighbour
      // since `tabStore` is workspace-scoped). The point is to give the
      // bus traffic so the assertion below is a real filter, not vacuous.
      useWorkspaceStore.setState(
        seedWorkspace(
          [
            {
              type: "table",
              id: "tab-driver" as TabId,
              title: "drv",
              connectionId: "c1" as ConnectionId,
              closable: true,
              schema: "public",
              table: "drv",
              subView: "records",
            },
          ],
          "tab-driver",
        ),
      );
      await Promise.resolve();

      const sentChannels = mockedEmit.mock.calls.map((call) => call[0]);
      expect(sentChannels).not.toContain("appshell-sync");
      expect(sentChannels).not.toContain("screen-sync");
      expect(sentChannels).not.toContain("window-context-sync");
      // And no emit should carry a `screen` / `windowContext` field on
      // any channel — neither the surviving 5 sync stores nor any future
      // shim may leak window-local context onto the wire.
      for (const call of mockedEmit.mock.calls) {
        const env = call[1] as
          | { state?: Record<string, unknown> }
          | null
          | undefined;
        if (env && typeof env === "object" && env.state) {
          expect(env.state).not.toHaveProperty("screen");
          expect(env.state).not.toHaveProperty("windowContext");
        }
      }
    });
  });
});

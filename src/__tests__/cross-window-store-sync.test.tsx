/**
 * Sprint 153 — TDD-FIRST cross-window sync tests for the remaining shared
 * stores (`tabStore`, `mruStore`, `themeStore`, `favoritesStore`,
 * `appShellStore`).
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
 *  - `appShellStore.screen` is window-scoped (no bridge attached, so the
 *    field is never sent on any channel).
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

// Mock the Tauri invoke wrapper so connectionStore (transitively imported by
// tabStore) doesn't crash on module load.
vi.mock("@lib/tauri", () => ({
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
}));

// Default the window label to "workspace" so `tabStore`'s attach guard fires
// at module load. The launcher-only test below re-imports tabStore with the
// label flipped to "launcher" via `vi.resetModules` + `vi.doMock`.
vi.mock("@lib/window-label", () => ({
  getCurrentWindowLabel: vi.fn(() => "workspace"),
}));

// Import AFTER all mocks are registered.
import { emit } from "@tauri-apps/api/event";
import { useTabStore } from "@stores/tabStore";
import { useMruStore } from "@stores/mruStore";
import { useThemeStore } from "@stores/themeStore";
import { useFavoritesStore } from "@stores/favoritesStore";
import { useAppShellStore } from "@stores/appShellStore";

const mockedEmit = emit as unknown as Mock;

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
  useTabStore.setState({
    tabs: [],
    activeTabId: null,
    closedTabHistory: [],
    dirtyTabIds: new Set<string>(),
  });
}

function resetMruStore(): void {
  useMruStore.setState({ lastUsedConnectionId: null });
}

function resetFavoritesStore(): void {
  useFavoritesStore.setState({ favorites: [] });
}

function resetAppShellStore(): void {
  useAppShellStore.setState({ screen: "home" });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("cross-window store sync (Sprint 153)", () => {
  beforeEach(async () => {
    resetTabStore();
    resetMruStore();
    resetFavoritesStore();
    resetAppShellStore();
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
    resetAppShellStore();
  });

  // -------------------------------------------------------------------------
  // tabStore — workspace-only sync (AC-153-01)
  // -------------------------------------------------------------------------

  describe("tabStore (workspace-only)", () => {
    it("AC-153-01a: workspace mutation of `tabs` emits on `tab-sync`", async () => {
      // The default mock has `getCurrentWindowLabel() === "workspace"`, so the
      // bridge attached at module load. A workspace-side state write must
      // produce an emit on the dedicated channel.
      mockedEmit.mockClear();
      useTabStore.setState({
        tabs: [
          {
            type: "table",
            id: "tab-A",
            title: "users",
            connectionId: "c1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        activeTabId: "tab-A",
      });
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "tab-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      expect(payload.origin).toBe("workspace");
      expect(payload.state).toHaveProperty("tabs");
      expect(payload.state).toHaveProperty("activeTabId");
    });

    it("AC-153-01b: a remote workspace emit applies to the local workspace store", async () => {
      // Two workspace stores in the same process simulate the cross-window
      // contract — origin "workspace-2" so the local "workspace" guard does
      // not drop the payload.
      simulateRemoteEmit("tab-sync", "workspace-2", {
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
      });
      await Promise.resolve();

      const state = useTabStore.getState();
      expect(state.tabs).toHaveLength(1);
      expect(state.tabs[0]!.id).toBe("tab-remote");
      expect(state.activeTabId).toBe("tab-remote");
    });

    it("AC-153-06 (tabStore): allowlist excludes window-local fields", async () => {
      mockedEmit.mockClear();
      // Mutate dirtyTabIds + closedTabHistory + tabs in the same write so the
      // bridge's diff sees a change but the wire payload should only contain
      // `tabs` / `activeTabId`.
      useTabStore.setState({
        tabs: [
          {
            type: "table",
            id: "tab-C",
            title: "c",
            connectionId: "c1",
            closable: true,
            schema: "public",
            table: "c",
            subView: "records",
          },
        ],
        activeTabId: "tab-C",
        dirtyTabIds: new Set<string>(["tab-C"]),
        closedTabHistory: [],
      });
      await Promise.resolve();

      const syncCall = mockedEmit.mock.calls.find(
        (call) => call[0] === "tab-sync",
      );
      expect(syncCall).toBeDefined();
      const payload = syncCall![1] as {
        origin: string;
        state: Record<string, unknown>;
      };
      // `dirtyTabIds` is a Set instance and must not survive `JSON.stringify`,
      // so we explicitly forbid it in the wire payload. `closedTabHistory` is
      // window-local (reopen-last-closed must not surface another window's
      // closed tabs).
      expect(payload.state).not.toHaveProperty("dirtyTabIds");
      expect(payload.state).not.toHaveProperty("closedTabHistory");
      expect(Object.keys(payload.state).sort()).toEqual([
        "activeTabId",
        "tabs",
      ]);
    });

    it("AC-153-07 (tabStore): malformed `tab-sync` payload does not throw or pollute state", async () => {
      useTabStore.setState({
        tabs: [
          {
            type: "table",
            id: "tab-keep",
            title: "users",
            connectionId: "c1",
            closable: true,
            schema: "public",
            table: "users",
            subView: "records",
          },
        ],
        activeTabId: "tab-keep",
      });

      expect(() => {
        busEmit("tab-sync", null);
        busEmit("tab-sync", "not-an-object");
        busEmit("tab-sync", { origin: "workspace-2" });
        busEmit("tab-sync", { origin: "workspace-2", state: "string" });
        busEmit("tab-sync", { origin: "workspace-2", state: null });
        busEmit("tab-sync", { origin: "workspace-2", state: { unknown: 1 } });
      }).not.toThrow();
      await Promise.resolve();

      const state = useTabStore.getState();
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
      vi.doMock("@lib/window-label", () => ({
        getCurrentWindowLabel: vi.fn(() => "launcher"),
      }));
      vi.doMock("@tauri-apps/api/event", () => ({
        emit: busModule.emit,
        listen: busModule.listen,
      }));
      vi.doMock("@lib/tauri", () => ({
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
      }));

      const { useTabStore: launcherTabStore } =
        await import("@stores/tabStore");
      // Reset the freshly-imported store to a known clean baseline.
      launcherTabStore.setState({
        tabs: [],
        activeTabId: null,
        closedTabHistory: [],
        dirtyTabIds: new Set<string>(),
      });
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
            connectionId: "c1",
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
      expect(launcherTabStore.getState().tabs).toHaveLength(0);
      expect(launcherTabStore.getState().activeTabId).toBeNull();

      vi.doUnmock("@lib/window-label");
      vi.doUnmock("@tauri-apps/api/event");
      vi.doUnmock("@lib/tauri");
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
      useThemeStore.getState().setMode("dark");
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
  // appShellStore — window-scoped (AC-153-05)
  // -------------------------------------------------------------------------

  describe("appShellStore (window-scoped, no bridge)", () => {
    it("AC-153-05: setScreen does NOT broadcast on any sync channel", async () => {
      mockedEmit.mockClear();
      useAppShellStore.getState().setScreen("workspace");
      await Promise.resolve();

      const sentChannels = mockedEmit.mock.calls.map((call) => call[0]);
      // The store decision (Sprint 153) is to keep `screen` window-local —
      // no `appshell-sync` / `screen-sync` / etc.
      expect(sentChannels).not.toContain("appshell-sync");
      expect(sentChannels).not.toContain("screen-sync");
      // And no other emit should carry a `screen` field, ever.
      for (const call of mockedEmit.mock.calls) {
        const env = call[1] as
          | { state?: Record<string, unknown> }
          | null
          | undefined;
        if (env && typeof env === "object" && env.state) {
          expect(env.state).not.toHaveProperty("screen");
        }
      }
    });
  });
});

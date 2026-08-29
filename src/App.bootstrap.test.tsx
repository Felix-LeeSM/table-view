/**
 * #2557 — boot-wiring render spec.
 *
 * The store actions dispatched at boot are covered by store specs, but those
 * specs call the action directly (`useConnectionStore.getState()
 * .initEventListeners()`). That enters the graph *below* the mount point, so
 * the `useEffect` in `App` and in `AppRouter`'s `LauncherShell` that dispatches
 * them was left unguarded: the 2026-08-28 audit deleted boot call lines one at
 * a time and the suite stayed green.
 *
 * This file enters *above* the mount point instead. It renders the two boot
 * surfaces and stubs only the Tauri boundary each line reaches:
 *
 *   - `@lib/tauri` barrel (`listConnections` / `listGroups`) — the connection
 *     store's IPC wrapper, already mocked process-wide by `src/test-setup.ts`.
 *   - `invoke` — `list_favorites` / `list_snippets` / `list_table_activity`,
 *     reached through the real `@lib/tauri/{favorites,snippets,tableActivity}`
 *     wrappers.
 *   - `listen` — `connection-status-changed`, the subscription
 *     `initEventListeners` registers.
 *
 * Each case then asserts the store slot the user sees, not the fact that a
 * function was called: a favorite that survives a restart, a status change that
 * reaches the workspace window. Deleting one of the guarded lines takes exactly
 * one case red — no two of them share a boundary observation.
 *
 * NOT guarded here: `loadPersistedMru()` in `src/App.tsx` and in
 * `src/AppRouter.tsx`. That action has an empty body since sprint-370 moved MRU
 * hydration to the `get_initial_app_state` snapshot (`src/stores/mruStore.ts`
 * `loadPersistedMru`, and the no-op is itself locked by
 * `src/stores/mruStore.test.ts`). A line that reaches no boundary and changes no
 * state cannot be observed from a render, so no assertion here can go red when
 * it is deleted.
 */

import {
  type ConnectionConfig,
  // The feature barrel exports `ConnectionGroup` as the component; the model
  // type is re-exported under `ConnectionGroupModel`.
  type ConnectionGroupModel,
  useConnectionStore,
} from "@features/connection";
import type { FavoriteRow } from "@lib/tauri/favorites";
import type { SnippetRow } from "@lib/tauri/snippets";
import type { PersistTableActivityPayload } from "@lib/tauri/tableActivity";
import { getCurrentWindowLabel } from "@lib/window-label";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

// `App` renders the workspace page and `AppRouter`'s launcher branch renders
// the launcher page. Neither is under test here and both pull a large runtime
// graph, so they are narrowed to a marker element (page/container test
// exemption in `memory/engineering/conventions/testing-scenarios/mock-scope`).
vi.mock("./pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));
vi.mock("./pages/LauncherPage", () => ({
  default: () => <div data-testid="launcher-page" />,
}));
vi.mock("@features/workspace", () => ({
  WorkspaceApp: () => <div data-testid="workspace-app" />,
  WorkspacePage: () => <div data-testid="workspace-page" />,
}));

// The Tauri boundary. `isTauri` is stubbed false so the launcher's
// fire-and-forget `checkForUpdatesOnLaunch()` short-circuits instead of
// reaching the updater plugin.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import AppRouter from "./AppRouter";
import { useFavoritesStore } from "./stores/favoritesStore";
import { useSnippetsStore } from "./stores/snippetsStore";
import { useTableActivityStore } from "./stores/tableActivityStore";

const CONNECTION: ConnectionConfig = {
  id: "conn-boot",
  name: "Boot DB",
  dbType: "postgresql",
  host: "localhost",
  port: 5432,
  user: "postgres",
  hasPassword: false,
  database: "test",
  groupId: null,
  color: null,
  environment: null,
  paradigm: "rdb",
};

const GROUP: ConnectionGroupModel = {
  id: "grp-boot",
  name: "Boot Group",
  color: null,
  collapsed: false,
};

const FAVORITE_ROW: FavoriteRow = {
  id: "fav-boot",
  name: "Boot favorite",
  sql: "select 1",
  connectionId: null,
  createdAt: 1,
  updatedAt: 2,
};

const SNIPPET_ROW: SnippetRow = {
  id: "snip-boot",
  name: "Boot snippet",
  body: "select 2",
  createdAt: 3,
  updatedAt: 4,
};

const TABLE_ACTIVITY_ROW: PersistTableActivityPayload = {
  connectionId: "conn-boot",
  db: "test",
  schema: "public",
  table: "boot_rows",
  lastUsed: 5,
  pinnedAt: null,
};

/**
 * The listener `initEventListeners` registers. `listen` is also called for the
 * cross-window sync bridges and the menu bridges, so the lookup is keyed on the
 * event name rather than on call order.
 */
function statusHandler() {
  const call = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "connection-status-changed");
  return call?.[1] as
    | ((event: { payload: { id: string; status: unknown } }) => void)
    | undefined;
}

beforeEach(() => {
  vi.mocked(listen).mockClear();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    switch (command) {
      case "list_favorites":
        return [FAVORITE_ROW];
      case "list_snippets":
        return [SNIPPET_ROW];
      case "list_table_activity":
        return [TABLE_ACTIVITY_ROW];
      default:
        return undefined;
    }
  });

  setupTauriMock({
    listConnections: vi.fn(() => Promise.resolve([CONNECTION])),
    listGroups: vi.fn(() => Promise.resolve([GROUP])),
  });

  // Every store below is a process singleton, so a slot left populated by the
  // previous case would keep an assertion green after its boot line is deleted.
  useConnectionStore.setState({
    connections: [],
    groups: [],
    activeStatuses: {},
    focusedConnId: null,
    hasLoadedOnce: false,
    error: null,
  });
  useFavoritesStore.setState({ favorites: [] });
  useSnippetsStore.setState({ snippets: [] });
  useTableActivityStore.setState({ entries: [] });
});

afterEach(() => {
  cleanup();
});

describe("#2557 workspace window boot wiring (<App />)", () => {
  beforeEach(() => {
    // A null label keeps `useCurrentWindowConnectionId()` null, which is the
    // guard the orphan self-close effect (#1583) checks first — the boot effect
    // under test reads no label.
    vi.mocked(getCurrentWindowLabel).mockReturnValue(null);
  });

  it("loads the connection list (src/App.tsx loadConnections)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(useConnectionStore.getState().connections).toEqual([CONNECTION]);
    });
  });

  it("loads the connection groups (src/App.tsx loadGroups)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(useConnectionStore.getState().groups).toEqual([GROUP]);
    });
  });

  it("subscribes to connection status changes (src/App.tsx initEventListeners)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(statusHandler()).toBeTypeOf("function");
    });

    act(() => {
      statusHandler()?.({
        payload: { id: "conn-boot", status: { type: "connected" } },
      });
    });

    expect(useConnectionStore.getState().activeStatuses["conn-boot"]).toEqual({
      type: "connected",
    });
  });

  it("restores saved favorites (src/App.tsx loadPersistedFavorites)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(useFavoritesStore.getState().favorites).toEqual([FAVORITE_ROW]);
    });
  });

  it("restores saved snippets (src/App.tsx loadPersistedSnippets)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(useSnippetsStore.getState().snippets).toEqual([SNIPPET_ROW]);
    });
  });

  it("restores table activity (src/App.tsx loadPersistedTableActivity)", async () => {
    render(<App />);
    await waitFor(() => {
      expect(useTableActivityStore.getState().entries).toEqual([
        TABLE_ACTIVITY_ROW,
      ]);
    });
  });
});

describe("#2557 launcher window boot wiring (<AppRouter />)", () => {
  beforeEach(() => {
    vi.mocked(getCurrentWindowLabel).mockReturnValue("launcher");
  });

  it("loads the connection list (src/AppRouter.tsx loadConnections)", async () => {
    render(<AppRouter />);
    await waitFor(() => {
      expect(useConnectionStore.getState().connections).toEqual([CONNECTION]);
    });
  });

  it("loads the connection groups (src/AppRouter.tsx loadGroups)", async () => {
    render(<AppRouter />);
    await waitFor(() => {
      expect(useConnectionStore.getState().groups).toEqual([GROUP]);
    });
  });

  it("subscribes to connection status changes (src/AppRouter.tsx initEventListeners)", async () => {
    render(<AppRouter />);
    await waitFor(() => {
      expect(statusHandler()).toBeTypeOf("function");
    });

    act(() => {
      statusHandler()?.({
        payload: { id: "conn-boot", status: { type: "connected" } },
      });
    });

    expect(useConnectionStore.getState().activeStatuses["conn-boot"]).toEqual({
      type: "connected",
    });
  });

  it("restores saved favorites (src/AppRouter.tsx loadPersistedFavorites)", async () => {
    render(<AppRouter />);
    await waitFor(() => {
      expect(useFavoritesStore.getState().favorites).toEqual([FAVORITE_ROW]);
    });
  });
});

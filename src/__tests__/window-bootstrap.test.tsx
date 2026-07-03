/**
 * Sprint 150 — AC-150-04 (Two-Window Foundation) label-routing tests.
 *
 * **TDD-FIRST**: this file was authored before the production routing change
 * (`src/AppRouter.tsx` + `src/lib/window-label.ts` + `src/pages/LauncherPage.tsx`).
 * Against pre-Sprint-150 code (single-window stub), the imports below fail —
 * `AppRouter` and the `window-label` shim do not yet exist. After the routing
 * change lands, the same file goes green.
 *
 * The test asserts:
 *  - `launcher` label → `LauncherPage` mounts (existing `HomePage` body).
 *  - `workspace` label → existing workspace shell mounts.
 *  - unknown / missing label → defensive fallback to launcher with a
 *    `console.warn`.
 *
 * Phase 12 keeps this file the gate against any regression in the boot-time
 * label dispatch — Sprint 154 will extend it with real lifecycle wiring, but
 * Sprint 150 only proves the static dispatch.
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
import { setupTauriMock } from "@/test-utils/tauriMock";
import { render, screen, cleanup } from "@testing-library/react";

// The label-resolution seam lives in `src/lib/window-label.ts`. We mock it so
// each case can simulate `getCurrentWebviewWindow().label` returning the
// launcher / workspace / unknown / missing surfaces without a real Tauri
// runtime (vitest runs under jsdom).
//
// sprint-361 (2026-05-16) — Tauri seam is mocked, but the helpers
// `parseWorkspaceLabel` / `formatWorkspaceLabel` are pure string utilities
// that AppRouter calls inline. Spread the actual module first so those
// helpers remain available; only override the runtime-dependent
// `getCurrentWindowLabel`.
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

// AppRouter's launcher branch boots the connection store via tauri IPC. The
// router test does NOT exercise that surface — it only asserts the boot
// dispatcher picks the correct page — so stub the IPC-touching imports.
// Sprint 153: mruStore/themeStore/favoritesStore now wire the cross-window
// bridge at module load and subscribe to setState, calling `emit(...)` on
// every change. AppRouter's launcher branch transitively imports those
// stores, so a synchronous setState during boot would throw without an
// `emit` stub. Sprint 152 set the precedent in connectionStore.test.ts.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));
beforeEach(() => {
  setupTauriMock({
    listConnections: vi.fn(() => Promise.resolve([])),
    listGroups: vi.fn(() => Promise.resolve([])),
    testConnection: vi.fn(() => Promise.resolve(true)),
    connect: vi.fn(() => Promise.resolve()),
    disconnect: vi.fn(() => Promise.resolve()),
    connectToDatabase: vi.fn(() => Promise.resolve()),
    disconnectFromDatabase: vi.fn(() => Promise.resolve()),
    saveConnections: vi.fn(() => Promise.resolve()),
    saveGroups: vi.fn(() => Promise.resolve()),
    deleteConnection: vi.fn(() => Promise.resolve()),
    updateConnection: vi.fn(() => Promise.resolve()),
    createConnection: vi.fn(() => Promise.resolve("test-id")),
    addGroup: vi.fn(() => Promise.resolve("g1")),
    updateGroup: vi.fn(() => Promise.resolve()),
    deleteGroup: vi.fn(() => Promise.resolve()),
    moveConnectionToGroup: vi.fn(() => Promise.resolve()),
  });
});

// HomePage transitively pulls in the connection bootstrap (`loadConnections`,
// `loadGroups`, `initEventListeners`, theme, MRU). Stub it so the only thing
// observed in the launcher case is a stable `data-testid` we can assert on.
vi.mock("@/pages/LauncherPage", () => ({
  default: () => <div data-testid="launcher-page" />,
}));

// AppRouter's workspace branch imports the workspace feature boundary. Stub
// it so routing assertions observe a single stable workspace selector.
vi.mock("@features/workspace", () => ({
  WorkspaceApp: () => <div data-testid="workspace-page" />,
  WorkspacePage: () => <div data-testid="workspace-page" />,
}));

import { getCurrentWindowLabel } from "@lib/window-label";
import { listen } from "@tauri-apps/api/event";
import AppRouter from "@/AppRouter";
import { useConnectionStore } from "@stores/connectionStore";
import type { ConnectionConfig } from "@/types/connection";

const mockedGetLabel = getCurrentWindowLabel as Mock;
const mockedListen = listen as Mock;

function makeConnection(id: string, name: string): ConnectionConfig {
  return {
    id,
    name,
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
}

describe("AC-150-*: window-label-driven boot routing", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    warnSpy.mockRestore();
    useConnectionStore.setState({ connections: [] });
  });

  it("AC-150-04a: label='launcher' mounts the LauncherPage shell", () => {
    mockedGetLabel.mockReturnValue("launcher");

    render(<AppRouter />);

    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-page")).not.toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // sprint-173 (2026-04-30) — `document.title` is the only thing webdriver's
  // `getTitle()` sees, so it must reflect the OS window decoration title for
  // `_helpers.ts:switchToWorkspaceWindow` to identify which window it landed
  // on. Both windows load the same `index.html`, so without this the
  // multi-window e2e suite cannot disambiguate them.
  it("AC-173-01: label='launcher' sets document.title to the launcher title", () => {
    mockedGetLabel.mockReturnValue("launcher");

    render(<AppRouter />);

    expect(document.title).toBe("Table View");
  });

  // sprint-361 (2026-05-16) — bare `"workspace"` label retired. Workspace
  // windows are now per-connection (`workspace-{connection_id}`); the
  // legacy single workspace label is treated as unknown by AppRouter.
  it("AC-150-04b (sprint-361): per-conn label 'workspace-<id>' mounts the WorkspacePage shell", () => {
    mockedGetLabel.mockReturnValue("workspace-conn-1");

    render(<AppRouter />);

    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    expect(screen.queryByTestId("launcher-page")).not.toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("AC-173-02 (sprint-361): per-conn workspace label sets document.title to the workspace title", () => {
    mockedGetLabel.mockReturnValue("workspace-conn-1");

    render(<AppRouter />);

    expect(document.title).toBe("Table View — Workspace");
  });

  // #1134 — the workspace title reflects the connection name so multiple
  // per-connection windows are distinguishable in dock/alt-tab.
  it("AC-1134: workspace title reflects the connection name when the store has it", () => {
    mockedGetLabel.mockReturnValue("workspace-conn-1");
    useConnectionStore.setState({
      connections: [makeConnection("conn-1", "Prod DB")],
    });

    render(<AppRouter />);

    expect(document.title).toContain("Prod DB");
  });

  it("AC-150-04c: unknown label falls back to launcher AND logs a warning", () => {
    mockedGetLabel.mockReturnValue("totally-bogus-label");

    render(<AppRouter />);

    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-page")).not.toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/unknown window label/i);
  });

  it("AC-150-04d: null/undefined label (missing seam) falls back to launcher AND logs a warning", () => {
    mockedGetLabel.mockReturnValue(null);

    render(<AppRouter />);

    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/unknown window label/i);
  });

  // 2026-05-01 — macOS native File > New Connection (Cmd+N) menu fires
  // the Tauri event `menu:new-connection`. The launcher shell must adapt
  // it into the existing `new-connection` DOM event so HomePage's listener
  // (HomePage.tsx:78) opens the ConnectionDialog. Regression guard for the
  // case where the user closed every window on macOS and Cmd+N is the only
  // path back to the connection dialog.
  it("LauncherShell bridges menu:new-connection Tauri event into the new-connection DOM event", () => {
    mockedGetLabel.mockReturnValue("launcher");

    let menuCallback: ((e: { payload: unknown }) => void) | undefined;
    mockedListen.mockImplementation(
      (event: string, cb: (e: { payload: unknown }) => void) => {
        if (event === "menu:new-connection") {
          menuCallback = cb;
        }
        return Promise.resolve(() => {});
      },
    );

    render(<AppRouter />);

    expect(mockedListen).toHaveBeenCalledWith(
      "menu:new-connection",
      expect.any(Function),
    );

    const domSpy = vi.fn();
    window.addEventListener("new-connection", domSpy);

    menuCallback?.({ payload: undefined });
    expect(domSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener("new-connection", domSpy);
  });
});

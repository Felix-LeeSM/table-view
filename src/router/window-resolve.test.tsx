/**
 * Written 2026-05-16 (state-management-strategy Phase 3)
 *
 * Reason: migration to the per-conn workspace window label
 * (`workspace-{conn_id}`). Checks that AppRouter recognizes the new pattern
 * and renders `WorkspacePage`.
 *
 * AC-361-06 router recognition matrix:
 *   - `"launcher"`              → `HomePage` (`LauncherPage`)
 *   - `"workspace-conn-1"`      → `WorkspacePage`
 *   - `"workspace-<UUID>"`      → `WorkspacePage`
 *   - unknown label             → launcher fallback + warn
 *   - legacy bare `"workspace"` → launcher fallback (the app no longer
 *     issues the bare workspace label, so it is treated as unrecognized)
 *
 * The bare `"workspace"` label case was retired from
 * `__tests__/window-bootstrap.test.tsx`; this file is the regression guard
 * for the new label pattern.
 */

import { cleanup, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { setupTauriMock } from "@/test-utils/tauriMock";

vi.mock("@lib/window-label", async () => {
  // Reuse real `parseWorkspaceLabel` / `formatWorkspaceLabel` while keeping
  // `getCurrentWindowLabel` controllable per case. The router uses both
  // (`getCurrentWindowLabel` to read its own window, `parseWorkspaceLabel`
  // to route) so the seam must not drop the helpers.
  const actual =
    await vi.importActual<typeof import("@lib/window-label")>(
      "@lib/window-label",
    );
  return {
    ...actual,
    getCurrentWindowLabel: vi.fn(),
  };
});

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

vi.mock("@/pages/LauncherPage", () => ({
  default: () => <div data-testid="launcher-page" />,
}));

vi.mock("@features/workspace", () => ({
  WorkspaceApp: () => <div data-testid="workspace-page" />,
  WorkspacePage: () => <div data-testid="workspace-page" />,
}));

import { getCurrentWindowLabel } from "@lib/window-label";
import AppRouter from "@/AppRouter";

const mockedGetLabel = getCurrentWindowLabel as Mock;

describe("AC-361-06: AppRouter window-label resolution", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    warnSpy.mockRestore();
  });

  it("renders WorkspacePage when label='workspace-conn-1' (per-conn workspace)", () => {
    mockedGetLabel.mockReturnValue("workspace-conn-1");
    render(<AppRouter />);
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    expect(screen.queryByTestId("launcher-page")).not.toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("renders WorkspacePage when label='workspace-<UUID>' (UUID conn_id)", () => {
    mockedGetLabel.mockReturnValue(
      "workspace-550e8400-e29b-41d4-a716-446655440000",
    );
    render(<AppRouter />);
    expect(screen.getByTestId("workspace-page")).toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("renders LauncherPage when label='launcher' (unchanged from pre-sprint-361)", () => {
    mockedGetLabel.mockReturnValue("launcher");
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(screen.queryByTestId("workspace-page")).not.toBeInTheDocument();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("falls back to LauncherPage + warns for the legacy bare 'workspace' label", () => {
    // Reason: the app no longer opens a window with the bare `"workspace"`
    // label — `open_workspace_window.rs` builds `workspace-{conn_id}`, and
    // the bare-label builder left in `launcher.rs` is reached only through
    // `showWindow("workspace")`, which no production code calls. If an
    // external tool or a leftover path surfaces that label, treat it as
    // unknown — fallback + warn.
    mockedGetLabel.mockReturnValue("workspace");
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toMatch(/unknown window label/i);
  });

  it("falls back to LauncherPage + warns for an unknown label", () => {
    mockedGetLabel.mockReturnValue("ghost-label");
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to LauncherPage + warns when label is null (no Tauri runtime)", () => {
    mockedGetLabel.mockReturnValue(null);
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("sets document.title to the workspace title for workspace-* labels", () => {
    mockedGetLabel.mockReturnValue("workspace-conn-2");
    render(<AppRouter />);
    expect(document.title).toBe("Table View — Workspace");
  });

  it("sets document.title to the launcher title for the launcher label", () => {
    mockedGetLabel.mockReturnValue("launcher");
    render(<AppRouter />);
    expect(document.title).toBe("Table View");
  });

  it("rejects empty workspace label 'workspace-' as unknown (fallback to launcher)", () => {
    // Reason: window-label.test.ts locks that
    // `parseWorkspaceLabel("workspace-")` returns null; this separately checks
    // that AppRouter also takes the fallback for it.
    mockedGetLabel.mockReturnValue("workspace-");
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

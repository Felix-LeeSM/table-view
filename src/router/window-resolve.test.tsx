/**
 * 작성 2026-05-16 (Phase 3 sprint-361)
 *
 * 사유: sprint-361 — per-conn workspace 윈도우 라벨 (`workspace-{conn_id}`)
 * 마이그. AppRouter 가 새 패턴을 인식해 `WorkspacePage` 를 렌더하는지 확인.
 *
 * AC-361-06 라우터 인식 매트릭스:
 *   - `"launcher"`              → `HomePage` (`LauncherPage`)
 *   - `"workspace-conn-1"`      → `WorkspacePage`
 *   - `"workspace-<UUID>"`      → `WorkspacePage`
 *   - 알려지지 않은 label       → launcher fallback + warn
 *   - 레거시 단일 `"workspace"` → launcher fallback (sprint-361 이후
 *     bare workspace label 은 더 이상 발급되지 않으므로 미인식 처리)
 *
 * 기존 `__tests__/window-bootstrap.test.tsx` 의 `"workspace"` 단독 라벨
 * 경로는 sprint-361 이후 deprecated. 본 파일은 새 라벨 패턴에 대한
 * 회귀 가드.
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
import { render, screen, cleanup } from "@testing-library/react";

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

vi.mock("@lib/tauri", () => ({
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
}));

vi.mock("@/pages/LauncherPage", () => ({
  default: () => <div data-testid="launcher-page" />,
}));

vi.mock("@/pages/WorkspacePage", () => ({
  default: () => <div data-testid="workspace-page" />,
}));

vi.mock("@/App", () => ({
  default: () => <div data-testid="workspace-page" />,
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
    // 사유: sprint-361 이후 backend 는 더 이상 bare `"workspace"` label 로
    // window 를 만들지 않는다 (`launcher.rs`/`open_workspace_window.rs` 가
    // `workspace-{conn_id}` 만 emit). 만약 외부 도구나 잔존 path 가 그
    // label 을 surface 하면 unknown 으로 처리 — fallback + warn.
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
    // 사유: `parseWorkspaceLabel("workspace-")` 가 null 을 반환해야 함을
    // window-label.test.ts 에서 잠갔지만, AppRouter 가 그 결정에 맞춰
    // fallback 도 거치는지 별도로 검증.
    mockedGetLabel.mockReturnValue("workspace-");
    render(<AppRouter />);
    expect(screen.getByTestId("launcher-page")).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

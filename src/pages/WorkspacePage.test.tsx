import { hydrateConnectionSession } from "@lib/runtime/connection/hydrateConnectionSession";
import * as windowControls from "@lib/window-controls";
import { useLayoutStore } from "@stores/layoutStore";
import { useThemeFavoritesStore } from "@stores/themeFavoritesStore";
import { useThemeStore } from "@stores/themeStore";
import { useWorkspaceStore } from "@stores/workspaceStore";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspacePage from "./WorkspacePage";

// Wrap the runtime implementation in a spy so the workspace's mount + focus
// call counts can still be asserted while preserving store behavior.
vi.mock("@lib/runtime/connection/hydrateConnectionSession", async () => {
  const actual = await vi.importActual<
    typeof import("@lib/runtime/connection/hydrateConnectionSession")
  >("@lib/runtime/connection/hydrateConnectionSession");
  return {
    ...actual,
    hydrateConnectionSession: vi.fn(actual.hydrateConnectionSession),
  };
});

// #1734 — the stub carries a focusable control so the collapse cases can
// assert the hidden column leaves the accessibility tree and the tab order,
// not just that it stopped painting.
vi.mock("@components/layout/Sidebar", () => ({
  default: () => (
    <div data-testid="sidebar-mock">
      <button type="button">Sidebar stub control</button>
    </div>
  ),
}));

vi.mock("@components/layout/MainArea", () => ({
  default: () => <div data-testid="main-area-mock" />,
}));

// Sprint 161 — isolate from the full ThemePicker rendering (72 cards + radix
// portals) so we can assert the trigger contract without visual noise.
vi.mock("@components/theme/ThemePicker", () => ({
  default: () => <div data-testid="theme-picker-mock" />,
}));

// #1738 (2026-07-25) — 테마/언어를 사이드바 상단 단일 영역(theme 팝오버)으로
// 통합. LanguageSwitcher 도 같은 방식으로 격리해 상단 배치만 검증한다.
vi.mock("@components/theme/LanguageSwitcher", () => ({
  default: () => <div data-testid="language-switcher-mock" />,
}));

// Sprint 154 — `WorkspacePage` registers a `tauri://close-requested`
// listener at mount and routes Back through the `@lib/window-controls`
// seam. Stub the seam so the assertions can observe call shape directly
// (no real Tauri runtime under jsdom).
vi.mock("@lib/window-controls", () => ({
  showWindow: vi.fn(() => Promise.resolve()),
  hideWindow: vi.fn(() => Promise.resolve()),
  focusWindow: vi.fn(() => Promise.resolve()),
  closeWindow: vi.fn(() => Promise.resolve()),
  destroyCurrentWindow: vi.fn(() => Promise.resolve()),
  exitApp: vi.fn(() => Promise.resolve()),
  onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
  onCurrentWindowCloseRequested: vi.fn(() => Promise.resolve(() => {})),
}));

function resetStores() {
  useWorkspaceStore.setState({ workspaces: {} });
  useThemeStore.setState({
    themeId: "slate",
    mode: "dark",
    resolvedMode: "dark",
  });
  // #2118 — a leaked `galleryOpen: true` would leave a modal dialog over the
  // page, and Radix marks everything behind it `aria-hidden`, which drops the
  // rest of this file's `getByRole` queries out of the accessibility tree.
  useThemeFavoritesStore.setState({ galleryOpen: false });
  // #1734 — `layoutStore` is reset by the global `beforeEach` in
  // `src/test-setup.ts` (`__resetLayoutStoreForTests`), not here.
}

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStores();
    vi.mocked(windowControls.showWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.hideWindow).mockResolvedValue(undefined);
    vi.mocked(windowControls.onCloseRequested).mockResolvedValue(() => {});
  });

  it("renders Sidebar and MainArea", () => {
    render(<WorkspacePage />);
    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
    expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
  });

  // #2118 — the workspace owns the theme gallery overlay's mount. It cannot sit
  // inside the appearance popover with `ThemePicker` (mocked in this file): the
  // picker is `PopoverContent`, and Radix unmounts that subtree the moment the
  // popover closes. So this one line is the workspace window's only route to
  // the full catalog, and nothing in the theme specs can see it — they render
  // the two components side by side themselves.
  it("mounts the theme gallery overlay", () => {
    useThemeFavoritesStore.setState({ galleryOpen: true });
    render(<WorkspacePage />);
    expect(screen.getByTestId("theme-gallery")).toBeInTheDocument();
  });

  // #1734 owner decision 1 — the Layout cluster's left-panel toggle drives
  // this. Collapsing hid the schema-tree column but kept the header strip
  // alive as a narrow rail, because that strip owned the only route back to
  // the launcher and the only theme / language control (#1738).
  //
  // #2431 moved both controls into `WorkspaceToolbar` (mocked away with
  // `MainArea` in this file — their collapsed reachability is asserted in
  // `src/components/workspace/WorkspaceToolbar.collapsed-rail.test.tsx`), so
  // the collapse now takes the column whole and no rail is left behind.
  describe("collapsed left panel (#1734, rail removed by #2431)", () => {
    it("[collapsed-rail] hides the sidebar and leaves no rail behind", () => {
      useLayoutStore.setState({ sidebarCollapsed: true });
      render(<WorkspacePage />);

      expect(screen.getByTestId("sidebar-mock")).not.toBeVisible();
      // Nothing of the old strip survives the collapse in the page shell.
      expect(
        screen.queryByRole("button", { name: /back to connections/i }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /theme|테마/i })).toBeNull();
      // `MainArea` is a sibling of the column, so it — and the toolbar it
      // mounts — is untouched by the collapse. This is what makes the two
      // controls reachable at all in the collapsed state.
      expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
    });

    // The column is gone, so its landmark goes with it. An empty <nav> would
    // announce a navigation region the user just closed.
    it("[collapsed-rail] drops the sidebar's <nav> landmark while collapsed", () => {
      render(<WorkspacePage />);
      expect(screen.getByRole("navigation")).toBeInTheDocument();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });

      expect(screen.queryByRole("navigation")).toBeNull();
    });

    // The heading moved out of the <nav> in the same change. A window that
    // opens collapsed would otherwise mount its <h1> under `display: none`,
    // where it is neither announced nor focusable.
    it("[collapsed-rail] still focuses the workspace heading when mounted collapsed", () => {
      useLayoutStore.setState({ sidebarCollapsed: true });
      render(<WorkspacePage />);

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeVisible();
      expect(heading).toHaveFocus();
    });

    // The regression this pins: an earlier revision gated the column with
    // `{!sidebarCollapsed && <Sidebar/>}`, so every collapse threw the
    // subtree away. Node identity is the proof — React destroys and
    // recreates the DOM node on unmount, so a surviving node means every
    // piece of React state inside survived too (the dragged width, the
    // schema-tree filter text, the Redis SCAN cursor, an open dialog).
    it("keeps the same sidebar DOM node across a collapse → expand cycle (no unmount)", () => {
      render(<WorkspacePage />);
      const beforeCollapse = screen.getByTestId("sidebar-mock");
      expect(beforeCollapse).toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });
      expect(screen.getByTestId("sidebar-mock")).toBe(beforeCollapse);
      expect(beforeCollapse).not.toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: false });
      });
      expect(screen.getByTestId("sidebar-mock")).toBe(beforeCollapse);
      expect(beforeCollapse).toBeVisible();
    });

    // The hidden column must also leave the accessibility tree and the tab
    // order — otherwise "collapsed" is only a visual claim and a screen
    // reader still walks a panel the user closed.
    it("drops the hidden column out of the accessibility tree", () => {
      render(<WorkspacePage />);
      // The mock stands in for the real sidebar's focusable controls.
      expect(
        screen.getByRole("button", { name: /sidebar stub/i }),
      ).toBeVisible();

      act(() => {
        useLayoutStore.setState({ sidebarCollapsed: true });
      });

      expect(
        screen.queryByRole("button", { name: /sidebar stub/i }),
      ).toBeNull();
    });
  });

  it("does NOT render the SidebarModeToggle (sprint 125 contract AC-04)", () => {
    render(<WorkspacePage />);
    expect(
      screen.queryByRole("radio", { name: /connections mode/i }),
    ).toBeNull();
    expect(screen.queryByRole("radio", { name: /schemas mode/i })).toBeNull();
  });

  // Wave 9.5 회귀 4 (2026-05-16) — `close-requested` listener trap.
  //
  // 회귀 증상: Back 클릭 시 launcher focus 는 가지만 workspace 창이 닫히지 않음.
  //
  // 근본 원인: WorkspacePage 가 `onCurrentWindowCloseRequested` 리스너를
  // 등록 + 그 안에서 `preventDefault()` + `handleBackToConnections()` 호출
  // 했다. 회귀 시점의 Back 핸들러가 `closeCurrentWindow()` (= `win.close()`)
  // 를 부르면 Tauri 가 `tauri://close-requested` 이벤트를 다시 발사 → 같은
  // 리스너가 `preventDefault()` → 재호출 → **무한 루프 + window destroy 안 됨**.
  // 현재 fix 는 (1) listener 제거 + (2) `destroyCurrentWindow()` 사용으로
  // close-requested 라이프사이클 자체 우회.
  //
  // 진짜 fix: 리스너 자체 제거. 이 리스너의 존재 이유는 sprint-154 의
  // launcher-hide UX (OS close 가 process kill 처럼 보이지 않게 가로채기)
  // 였는데, Wave 9.5 에서 desired UX 가 "launcher 항상 visible" 로 바뀌면서
  // OS-level close 는 default destroy 가 자연스럽다 (launcher 가 이미
  // visible 이므로 자동으로 활성). 리스너 = dead code.
  //
  // 본 테스트는 WorkspacePage 가 더 이상 close-requested 리스너를 등록하지
  // 않음을 lock — 다시 추가하면 같은 trap 이 부활.
  it("does NOT register a close-requested listener (Wave 9.5 회귀 4 — listener was the infinite loop trap)", () => {
    render(<WorkspacePage />);
    expect(windowControls.onCurrentWindowCloseRequested).not.toHaveBeenCalled();
  });

  // --- Sprint 161 / #1738: the appearance popover ---
  //
  // #2431 moved the trigger, the popover and the back button into
  // `WorkspaceToolbar`. `MainArea` is mocked here, so what those cases used to
  // assert — the trigger exists, it opens onto ThemePicker + LanguageSwitcher,
  // its aria-label tracks the store — now lives in
  // `src/components/workspace/WorkspaceToolbar.collapsed-rail.test.tsx`. What
  // stays here is the one piece the page still owns: the gallery mount, above.

  it("the page shell renders neither control itself after #2431", () => {
    render(<WorkspacePage />);
    expect(
      screen.queryByRole("button", { name: /back to connections/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /workspace theme/i }),
    ).toBeNull();
    expect(screen.getByTestId("sidebar-mock")).toBeInTheDocument();
    expect(screen.getByTestId("main-area-mock")).toBeInTheDocument();
  });

  // -- Re-hydration from session storage on window focus --

  // Reason: verify that the workspace re-hydrates connection state from session
  // storage on mount and when the window gains focus. This fixes the cross-
  // window state sync race where the workspace's boot-time hydration reads
  // empty data because the launcher hasn't connected yet. (2026-04-29)
  it("calls hydrateFromSession on mount", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    spy.mockClear();
    render(<WorkspacePage />);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("calls hydrateFromSession when the window gains focus", () => {
    const spy = hydrateConnectionSession as ReturnType<typeof vi.fn>;
    render(<WorkspacePage />);
    spy.mockClear();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  // --- #1134: landmark + heading a11y (Sidebar/MainArea are mocked here, so
  // the <nav> + <h1> asserted below come from WorkspacePage's own shell) ---

  it("exposes the sidebar column as a <nav> landmark (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("navigation")).toBeInTheDocument();
  });

  it("renders a top-level <h1> heading for the workspace (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("moves focus to the workspace heading on mount (a11y #1134)", () => {
    render(<WorkspacePage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
  });
});

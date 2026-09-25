// Purpose: Recent Connections UI component tests — Phase 16 (2026-04-28)

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import RecentConnections, { relativeTime } from "./RecentConnections";

// ---------------------------------------------------------------------------
// #2457 — `@lib/tauri/window` is the Tauri boundary this file has to stub.
// What a unit test can lock is the user-facing IPC step: activation fires
// `openWorkspaceWindow(connId)` (the real window build/focus is backend
// work, the same lock the AC-363-FE-* cases use for the ConnectionList path).
// ---------------------------------------------------------------------------
const openWorkspaceWindowMock = vi.fn((connId: string) => {
  void connId;
  return Promise.resolve();
});

vi.mock("@lib/tauri/window", () => ({
  openWorkspaceWindow: (connId: string) => openWorkspaceWindowMock(connId),
}));

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const mockMruState = {
  recentConnections: [] as Array<{ connectionId: string; lastUsed: number }>,
  removeRecentConnection: vi.fn() as (id: string) => void,
  clearRecentConnections: vi.fn() as () => void,
};

const mockConnState = {
  connections: [] as ConnectionConfig[],
};

vi.mock("@stores/mruStore", () => ({
  useMruStore: vi.fn((selector: (state: typeof mockMruState) => unknown) =>
    selector(mockMruState),
  ),
}));

vi.mock("@stores/connectionStore", () => ({
  useConnectionStore: vi.fn(
    (selector: (state: typeof mockConnState) => unknown) =>
      selector(mockConnState),
  ),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConnection(
  overrides: Partial<ConnectionConfig> = {},
): ConnectionConfig {
  return {
    id: "conn-1",
    name: "Test DB",
    dbType: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    hasPassword: false,
    database: "testdb",
    groupId: null,
    color: null,
    paradigm: "rdb",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// relativeTime unit tests
// ---------------------------------------------------------------------------

describe("relativeTime", () => {
  // Reason: AC-167-02 — relativeTime: under 1 minute → "just now" (2026-04-28)
  it('returns "just now" for timestamps less than 1 minute ago', () => {
    const now = Date.now();
    expect(relativeTime(now)).toBe("just now");
    expect(relativeTime(now - 30000)).toBe("just now");
  });

  // Reason: AC-167-02 — relativeTime: 1-59 minutes → "Xm ago" (2026-04-28)
  it('returns "Xm ago" for timestamps between 1 and 59 minutes ago', () => {
    const now = Date.now();
    expect(relativeTime(now - 5 * 60 * 1000)).toBe("5m ago");
    expect(relativeTime(now - 59 * 60 * 1000)).toBe("59m ago");
  });

  // Reason: AC-167-02 — relativeTime: 1-23 hours → "Xh ago" (2026-04-28)
  it('returns "Xh ago" for timestamps between 1 and 23 hours ago', () => {
    const now = Date.now();
    expect(relativeTime(now - 2 * 60 * 60 * 1000)).toBe("2h ago");
    expect(relativeTime(now - 23 * 60 * 60 * 1000)).toBe("23h ago");
  });

  // Reason: AC-167-02 — relativeTime: 24 hours or more → "Xd ago" (2026-04-28)
  it('returns "Xd ago" for timestamps 24 hours or more ago', () => {
    const now = Date.now();
    expect(relativeTime(now - 3 * 24 * 60 * 60 * 1000)).toBe("3d ago");
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe("RecentConnections", () => {
  let now: number;

  beforeEach(() => {
    vi.clearAllMocks();
    now = Date.now();
    mockMruState.recentConnections = [];
    mockMruState.clearRecentConnections = vi.fn();
    mockConnState.connections = [];
  });

  // Reason (2026-08-18, #2433): remove was hard to hit, and "Clear all" sat
  // at the very front of the launcher action bar, so a destructive action
  // aimed at the list got pressed before the list itself. The cases below are
  // this PR's acceptance criteria, counted by the `[recent]` token in their
  // names.
  //
  // jsdom does not compute Tailwind, so "how big / when visible" cannot be
  // measured through computed style. className assertions are the only
  // machine check for size and visibility conditions, and this feature
  // already uses the same substitute (the `py-1` / `select-none` assertions
  // in ConnectionGroup.test.tsx).
  describe("#2433 — remove 과녁 · 목록 끝의 전체 지우기", () => {
    function renderOne(name = "Prod DB") {
      mockMruState.recentConnections = [
        { connectionId: "c1", lastUsed: now - 5 * 60 * 1000 },
      ];
      mockConnState.connections = [makeConnection({ id: "c1", name })];
      return render(<RecentConnections />);
    }

    it("[recent] remove 과녁이 24px 사각형이다 (h-6 w-6)", () => {
      renderOne("Big DB");
      const btn = screen.getByRole("button", {
        name: /Remove Big DB from recent connections/,
      });
      // The regression target is the old p-0.5 + 12px icon = 16px hit area.
      expect(btn.className).toMatch(/\bh-6\b/);
      expect(btn.className).toMatch(/\bw-6\b/);
      expect(btn.className).not.toMatch(/\bp-0\.5\b/);
    });

    it("[recent] remove 는 hover 와 focus 양쪽에서 드러난다", () => {
      renderOne("Focus DB");
      const btn = screen.getByRole("button", {
        name: /Remove Focus DB from recent connections/,
      });
      // Hidden by default; shown on both row hover and row focus-within.
      expect(btn.className).toMatch(/\bopacity-0\b/);
      expect(btn.className).toContain("group-hover:opacity-100");
      expect(btn.className).toContain("group-focus-within:opacity-100");
    });

    it("[recent] remove 가 드러나면 같은 슬롯의 시간이 hover·focus 양쪽에서 물러난다", () => {
      renderOne();
      // The time and the X occupy the same grid cell — if only one of them
      // follows the focus condition, the two overlap when reached by keyboard.
      const timeSlot = screen.getByText("5m ago").parentElement;
      expect(timeSlot?.className).toContain("group-hover:opacity-0");
      expect(timeSlot?.className).toContain("group-focus-within:opacity-0");
    });

    it("[recent] 행과 remove 버튼 둘 다 키보드로 닿고, 버튼 활성화가 그 항목만 지운다", () => {
      const remove = vi.fn();
      mockMruState.removeRecentConnection = remove;
      const onActivate = vi.fn();
      mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
      mockConnState.connections = [makeConnection({ id: "c1", name: "K DB" })];

      render(<RecentConnections onActivate={onActivate} />);

      // List traversal: each row has tabIndex=0, so Tab reaches them in order.
      expect(screen.getByRole("listitem")).toHaveAttribute("tabindex", "0");

      const btn = screen.getByRole("button", {
        name: /Remove K DB from recent connections/,
      });
      btn.focus();
      expect(document.activeElement).toBe(btn);

      // jsdom does not run native button activation for Enter, so the two
      // axes are asserted separately: activation via click, and Enter not
      // leaking into the row's connect via keyDown.
      fireEvent.keyDown(btn, { key: "Enter" });
      expect(onActivate).not.toHaveBeenCalled();

      fireEvent.click(btn);
      expect(remove).toHaveBeenCalledWith("c1");
      expect(onActivate).not.toHaveBeenCalled();
    });

    it("[recent] 전체 지우기는 목록 뒤에 온다", () => {
      renderOne();
      const list = screen.getByRole("list", { name: "Recent connections" });
      const clear = screen.getByTestId("recent-clear-all");
      // It used to sit above the list (launcher action bar). 4 = FOLLOWING.
      expect(
        list.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // Placed inside the list, it would mix a non-listitem child into the
      // accessibility tree.
      expect(list.contains(clear)).toBe(false);
    });

    it("[recent] 전체 지우기 클릭만으로는 안 지워지고 확인 창이 먼저 뜬다", () => {
      renderOne();
      fireEvent.click(screen.getByTestId("recent-clear-all"));

      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      expect(mockMruState.clearRecentConnections).not.toHaveBeenCalled();
    });

    it("[recent] 확인 창에서 확인하면 목록이 지워진다", () => {
      renderOne();
      fireEvent.click(screen.getByTestId("recent-clear-all"));
      fireEvent.click(screen.getByTestId("recent-clear-confirm"));

      expect(mockMruState.clearRecentConnections).toHaveBeenCalledTimes(1);
    });

    it("[recent] 확인 창에서 취소하면 아무것도 안 지워진다", () => {
      renderOne();
      fireEvent.click(screen.getByTestId("recent-clear-all"));
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

      expect(mockMruState.clearRecentConnections).not.toHaveBeenCalled();
    });

    it("[recent] 지울 것이 없으면 전체 지우기 버튼도 없다", () => {
      render(<RecentConnections />);

      expect(screen.getByText("No recent connections")).toBeInTheDocument();
      expect(screen.queryByTestId("recent-clear-all")).toBeNull();
    });
  });

  // Reason: AC-167-01 — show the hint when the MRU list is empty (2026-04-28)
  it("shows empty hint when no recent connections", () => {
    render(<RecentConnections />);
    expect(screen.getByText("No recent connections")).toBeInTheDocument();
  });

  // Reason: AC-167-01 — MRU entries render with connection names (2026-04-28)
  it("renders connection names from MRU entries", () => {
    mockMruState.recentConnections = [
      { connectionId: "c1", lastUsed: now - 60000 },
      { connectionId: "c2", lastUsed: now - 120000 },
    ];
    mockConnState.connections = [
      makeConnection({ id: "c1", name: "Prod DB" }),
      makeConnection({ id: "c2", name: "Dev DB" }),
    ];

    render(<RecentConnections />);

    expect(screen.getByText("Prod DB")).toBeInTheDocument();
    expect(screen.getByText("Dev DB")).toBeInTheDocument();
  });

  // Reason: AC-167-02 — show a DB type badge on each entry (2026-04-28)
  it("shows DB type badge for each connection", () => {
    mockMruState.recentConnections = [
      { connectionId: "c1", lastUsed: now - 60000 },
      { connectionId: "c2", lastUsed: now - 120000 },
    ];
    mockConnState.connections = [
      makeConnection({ id: "c1", dbType: "postgresql" }),
      makeConnection({ id: "c2", dbType: "mysql" }),
    ];

    render(<RecentConnections />);

    expect(screen.getByText("PG")).toBeInTheDocument();
    expect(screen.getByText("MY")).toBeInTheDocument();
  });

  // Reason: AC-167-02 — show the relative time (2026-04-28)
  it("shows relative time for each entry", () => {
    const fiveMinAgo = now - 5 * 60 * 1000;
    mockMruState.recentConnections = [
      { connectionId: "c1", lastUsed: fiveMinAgo },
    ];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections />);

    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  // Reason: AC-167-03 — double-click calls onActivate (2026-04-28)
  it("calls onActivate on double-click", () => {
    const onActivate = vi.fn();
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections onActivate={onActivate} />);

    const item = screen.getByRole("listitem");
    act(() => {
      fireEvent.doubleClick(item);
    });

    expect(onActivate).toHaveBeenCalledWith("c1");
  });

  // Reason: AC-167-03 — the Enter key calls onActivate (2026-04-28)
  it("calls onActivate on Enter key", () => {
    const onActivate = vi.fn();
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections onActivate={onActivate} />);

    const item = screen.getByRole("listitem");
    act(() => {
      fireEvent.keyDown(item, { key: "Enter" });
    });

    expect(onActivate).toHaveBeenCalledWith("c1");
  });

  // Reason: AC-167-04 — show at most 5 entries (2026-04-28)
  it("shows at most 5 recent connections", () => {
    mockMruState.recentConnections = Array.from({ length: 7 }, (_, i) => ({
      connectionId: `c${i}`,
      lastUsed: now - i * 60000,
    }));
    mockConnState.connections = Array.from({ length: 7 }, (_, i) =>
      makeConnection({ id: `c${i}`, name: `DB ${i}` }),
    );

    render(<RecentConnections />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(5);
  });

  // Reason: AC-167-01 — the MRU filters out deleted connections (2026-04-28)
  it("filters out entries for deleted connections", () => {
    mockMruState.recentConnections = [
      { connectionId: "c1", lastUsed: now },
      { connectionId: "deleted", lastUsed: now - 60000 },
    ];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections />);

    expect(screen.getByText("Test DB")).toBeInTheDocument();
    // The entry for "deleted" should be filtered out — only 1 listitem
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
  });

  // Reason: AC-167-01 — check the role=list accessibility attributes
  // (2026-04-28)
  it("has role=list container with aria-label", () => {
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections />);

    const list = screen.getByRole("list", { name: "Recent connections" });
    expect(list).toBeInTheDocument();
  });

  // Reason: AC-167-03 — renders without errors even when onActivate is not
  // provided (2026-04-28)
  it("renders without onActivate prop without errors", () => {
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    expect(() => render(<RecentConnections />)).not.toThrow();
  });

  // Reason (2026-05-13): user request to remove recent entries one by one.
  // Regression guard that the X button calling the mruStore
  // removeRecentConnection action is actually wired.
  // Updated (2026-05-13): the collapse responsibility moved to HomePage's
  // home-recent footer wrapper. RecentConnections no longer has its own
  // collapse chevron — the related cases moved to the regression guards in
  // HomePage.test.tsx (#2440 later removed that footer and those cases).
  // Reason (2026-05-13): regression guard for the time ↔ X swap pattern in
  // the trailing slot. The X appears on hover and occupies the same slot as
  // the time text, so the time must be preserved in the row's aria-label
  // regardless of hover state. The X button must always be in the DOM
  // (opacity toggle only) so keyboard users can also reach it via
  // :focus-visible.
  describe("Sprint 297 — trailing slot swap (시간 ↔ X)", () => {
    it("row 의 aria-label 에 relative time 이 포함되어 정보 손실 없음", () => {
      mockMruState.recentConnections = [
        { connectionId: "c1", lastUsed: now - 5 * 60 * 1000 },
      ];
      mockConnState.connections = [
        makeConnection({ id: "c1", name: "Prod DB" }),
      ];

      render(<RecentConnections />);
      const row = screen.getByRole("listitem");
      expect(row).toHaveAttribute(
        "aria-label",
        expect.stringContaining("5m ago"),
      );
      expect(row.getAttribute("aria-label")).toContain("Prod DB");
    });

    it("X 버튼은 호버 상태와 무관하게 DOM 에 늘 존재 (opacity-only swap)", () => {
      mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
      mockConnState.connections = [makeConnection({ id: "c1", name: "Q DB" })];

      render(<RecentConnections />);
      // The X button must be queryable without firing a hover event — only
      // the opacity toggles; it is always mounted.
      expect(
        screen.getByRole("button", {
          name: /Remove Q DB from recent connections/,
        }),
      ).toBeInTheDocument();
    });
  });

  describe("Sprint 290 — remove", () => {
    it("각 항목의 X 버튼 클릭 시 removeRecentConnection 호출", () => {
      const remove = vi.fn();
      mockMruState.removeRecentConnection = remove;
      mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
      mockConnState.connections = [makeConnection({ id: "c1", name: "X DB" })];

      render(<RecentConnections />);
      const btn = screen.getByRole("button", {
        name: /Remove X DB from recent connections/,
      });
      fireEvent.click(btn);
      expect(remove).toHaveBeenCalledWith("c1");
    });

    it("X 버튼 클릭은 항목의 onActivate (double-click) 을 트리거하지 않는다", () => {
      const onActivate = vi.fn();
      mockMruState.removeRecentConnection = vi.fn();
      mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
      mockConnState.connections = [makeConnection({ id: "c1", name: "Z DB" })];

      render(<RecentConnections onActivate={onActivate} />);
      const btn = screen.getByRole("button", {
        name: /Remove Z DB from recent connections/,
      });
      fireEvent.click(btn);
      expect(onActivate).not.toHaveBeenCalled();
    });
  });

  // Reason (2026-09-05, #2457): even after Recent moved from the footer to a
  // rail view, activating a row fired only `onActivate` (store side) and
  // never opened the workspace window. In the All and group views,
  // ConnectionList's activate wrap fires openWorkspaceWindow, so the same
  // action opened the window there. These cases lock the exact symptom the
  // user saw, around the Recent rows — double-click and Enter each, with one
  // IPC call (which also locks against a double-fire regression) plus the
  // store-side callback.
  describe("#2457 — 최근 행 activate 가 workspace 창을 연다", () => {
    beforeEach(() => {
      openWorkspaceWindowMock.mockClear();
      openWorkspaceWindowMock.mockResolvedValue(undefined);
    });

    function renderOne() {
      mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
      mockConnState.connections = [makeConnection({ id: "c1", name: "W DB" })];
      const onActivate = vi.fn();
      render(<RecentConnections onActivate={onActivate} />);
      return onActivate;
    }

    it("[recent-activate] 더블클릭이 openWorkspaceWindow(c1) 1회와 onActivate(c1) 를 둘 다 태운다", async () => {
      const onActivate = renderOne();

      await act(async () => {
        fireEvent.doubleClick(screen.getByRole("listitem"));
      });

      expect(openWorkspaceWindowMock).toHaveBeenCalledTimes(1);
      expect(openWorkspaceWindowMock).toHaveBeenCalledWith("c1");
      expect(onActivate).toHaveBeenCalledWith("c1");
    });

    it("[recent-activate] Enter 가 openWorkspaceWindow(c1) 1회와 onActivate(c1) 를 둘 다 태운다", async () => {
      const onActivate = renderOne();

      await act(async () => {
        fireEvent.keyDown(screen.getByRole("listitem"), { key: "Enter" });
      });

      expect(openWorkspaceWindowMock).toHaveBeenCalledTimes(1);
      expect(openWorkspaceWindowMock).toHaveBeenCalledWith("c1");
      expect(onActivate).toHaveBeenCalledWith("c1");
    });
  });
});

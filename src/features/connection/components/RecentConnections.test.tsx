// Purpose: Recent Connections UI 컴포넌트 테스트 — Phase 16 Sprint 167 (2026-04-28)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import RecentConnections, { relativeTime } from "./RecentConnections";
import type { ConnectionConfig } from "@/types/connection";

// ---------------------------------------------------------------------------
// Store mocks
// ---------------------------------------------------------------------------

const mockMruState = {
  recentConnections: [] as Array<{ connectionId: string; lastUsed: number }>,
  removeRecentConnection: vi.fn() as (id: string) => void,
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
  // Reason: AC-167-02 — relativeTime이 1분 미만은 "just now" 반환 (2026-04-28)
  it('returns "just now" for timestamps less than 1 minute ago', () => {
    const now = Date.now();
    expect(relativeTime(now)).toBe("just now");
    expect(relativeTime(now - 30000)).toBe("just now");
  });

  // Reason: AC-167-02 — relativeTime이 1~59분은 "Xm ago" 반환 (2026-04-28)
  it('returns "Xm ago" for timestamps between 1 and 59 minutes ago', () => {
    const now = Date.now();
    expect(relativeTime(now - 5 * 60 * 1000)).toBe("5m ago");
    expect(relativeTime(now - 59 * 60 * 1000)).toBe("59m ago");
  });

  // Reason: AC-167-02 — relativeTime이 1~23시간은 "Xh ago" 반환 (2026-04-28)
  it('returns "Xh ago" for timestamps between 1 and 23 hours ago', () => {
    const now = Date.now();
    expect(relativeTime(now - 2 * 60 * 60 * 1000)).toBe("2h ago");
    expect(relativeTime(now - 23 * 60 * 60 * 1000)).toBe("23h ago");
  });

  // Reason: AC-167-02 — relativeTime이 24시간 이상은 "Xd ago" 반환 (2026-04-28)
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
    mockConnState.connections = [];
  });

  // Reason: AC-167-01 — 빈 MRU 목록 시 hint 표시 (2026-04-28)
  it("shows empty hint when no recent connections", () => {
    render(<RecentConnections />);
    expect(screen.getByText("No recent connections")).toBeInTheDocument();
  });

  // Reason: AC-167-01 — MRU 항목이 connection 이름과 함께 렌더링됨 (2026-04-28)
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

  // Reason: AC-167-02 — 각 항목에 DB type 뱃지 표시 (2026-04-28)
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

  // Reason: AC-167-02 — 상대 시간 표시 (2026-04-28)
  it("shows relative time for each entry", () => {
    const fiveMinAgo = now - 5 * 60 * 1000;
    mockMruState.recentConnections = [
      { connectionId: "c1", lastUsed: fiveMinAgo },
    ];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections />);

    expect(screen.getByText("5m ago")).toBeInTheDocument();
  });

  // Reason: AC-167-03 — 더블클릭 시 onActivate 호출 (2026-04-28)
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

  // Reason: AC-167-03 — Enter 키로 onActivate 호출 (2026-04-28)
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

  // Reason: AC-167-04 — 최대 5개까지만 표시 (2026-04-28)
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

  // Reason: AC-167-01 — 삭제된 connection은 MRU에서 필터링됨 (2026-04-28)
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

  // Reason: AC-167-01 — role=list 접근성 속성 확인 (2026-04-28)
  it("has role=list container with aria-label", () => {
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    render(<RecentConnections />);

    const list = screen.getByRole("list", { name: "Recent connections" });
    expect(list).toBeInTheDocument();
  });

  // Reason: AC-167-03 — onActivate가 제공되지 않아도 에러 없이 렌더링 (2026-04-28)
  it("renders without onActivate prop without errors", () => {
    mockMruState.recentConnections = [{ connectionId: "c1", lastUsed: now }];
    mockConnState.connections = [makeConnection({ id: "c1" })];

    expect(() => render(<RecentConnections />)).not.toThrow();
  });

  // 작성 이유 (2026-05-13, Sprint 290): 사용자가 recent 항목을 개별 삭제할
  // 수 있어야 한다는 요청. mruStore 의 removeRecentConnection 액션을 호출
  // 하는 X 버튼이 실제로 wire 되어 있는지 회귀 가드.
  // 갱신 (2026-05-13, Sprint 296): collapse 책임이 HomePage 의 home-recent
  // footer wrapper 로 이관됨. RecentConnections 는 더 이상 자체 collapse
  // chevron 을 갖지 않는다 — 관련 it 들은 HomePage.test.tsx 의 Sprint 296
  // 회귀 가드로 이동.
  // 작성 이유 (2026-05-13, Sprint 297): trailing 슬롯의 시간 ↔ X swap
  // 패턴 회귀 가드. X 가 호버 시에만 등장하며 시간 텍스트와 같은 슬롯을
  // 점유하므로, 시간 정보는 hover state 와 무관하게 row 의 aria-label
  // 로 보존되어야 한다. X 버튼은 DOM 에 늘 존재해야 (opacity 토글 only)
  // 키보드 사용자도 :focus-visible 로 도달 가능.
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
      // 호버 이벤트 발사 없이도 X 버튼이 query 가능해야 한다 — opacity 만
      // 토글되고 mount 는 항상.
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
});

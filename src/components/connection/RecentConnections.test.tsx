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
    db_type: "postgresql",
    host: "localhost",
    port: 5432,
    user: "postgres",
    has_password: false,
    database: "testdb",
    group_id: null,
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
      makeConnection({ id: "c1", db_type: "postgresql" }),
      makeConnection({ id: "c2", db_type: "mysql" }),
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
});

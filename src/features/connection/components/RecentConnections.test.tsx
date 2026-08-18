// Purpose: Recent Connections UI 컴포넌트 테스트 — Phase 16 Sprint 167 (2026-04-28)

import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "@/types/connection";
import RecentConnections, { relativeTime } from "./RecentConnections";

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
    mockMruState.clearRecentConnections = vi.fn();
    mockConnState.connections = [];
  });

  // 작성 이유 (2026-08-18, #2433): remove 가 잘 안 눌리고 「전체 지우기」가
  // launcher action bar 맨 앞에 있어 목록을 겨냥한 파괴적 동작이 목록보다
  // 먼저 눌렸다. 아래 케이스가 이 PR 의 수용 기준이고 이름의 `[recent]`
  // 토큰으로 센다.
  //
  // jsdom 은 Tailwind 를 계산하지 않아 "얼마나 큰가 / 언제 보이는가" 를
  // computed style 로 못 잰다. 크기와 등장 조건은 className 단언이 유일한
  // 기계 검사이고, 같은 대체 수단을 이 feature 가 이미 쓴다
  // (ConnectionGroup.test.tsx 의 `py-1` / `select-none` 단언).
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
      // 회귀 대상은 p-0.5 + 12px 아이콘 = 16px 이던 옛 과녁이다.
      expect(btn.className).toMatch(/\bh-6\b/);
      expect(btn.className).toMatch(/\bw-6\b/);
      expect(btn.className).not.toMatch(/\bp-0\.5\b/);
    });

    it("[recent] remove 는 hover 와 focus 양쪽에서 드러난다", () => {
      renderOne("Focus DB");
      const btn = screen.getByRole("button", {
        name: /Remove Focus DB from recent connections/,
      });
      // 평소엔 숨고, 행 hover 와 행 focus-within 양쪽에서 켜진다.
      expect(btn.className).toMatch(/\bopacity-0\b/);
      expect(btn.className).toContain("group-hover:opacity-100");
      expect(btn.className).toContain("group-focus-within:opacity-100");
    });

    it("[recent] remove 가 드러나면 같은 슬롯의 시간이 hover·focus 양쪽에서 물러난다", () => {
      renderOne();
      // 시간과 X 는 같은 grid cell 을 점유한다 — 한쪽만 focus 조건을 타면
      // 키보드로 왔을 때 둘이 겹쳐 보인다.
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

      // 목록을 도는 수단: 행마다 tabIndex=0 이라 Tab 이 순서대로 닿는다.
      expect(screen.getByRole("listitem")).toHaveAttribute("tabindex", "0");

      const btn = screen.getByRole("button", {
        name: /Remove K DB from recent connections/,
      });
      btn.focus();
      expect(document.activeElement).toBe(btn);

      // jsdom 은 Enter 의 native button activation 을 실행하지 않으므로 두
      // 축을 나눠 단언한다: 활성화는 click 으로, Enter 가 행의 connect 로
      // 새지 않는 것은 keyDown 으로.
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
      // 옛 자리는 목록 위(launcher action bar)였다. 4 = FOLLOWING.
      expect(
        list.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // 목록 안에 들어가면 listitem 아닌 자식이 접근성 트리에 섞인다.
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

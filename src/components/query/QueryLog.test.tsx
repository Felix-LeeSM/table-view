/**
 * 작성 2026-05-17 (Phase 5 sprint-372) — QueryLog 의 visual/UX 회귀 가드.
 *
 * 사유: sprint-372 가 read source 를 `useQueryHistoryStore.entries` 에서
 * backend `list_history` IPC 로 바꿨다. 본 파일은 그 전환 이후에도
 * 유지되어야 할 visual invariants — 상태 dot 색 (success/error/cancelled),
 * 시간/duration 포매팅, paradigm-aware syntax highlighting (sprint-177 AC),
 * 그리고 toggle visibility / 빈 상태 / search filter — 를 IPC-mock 기반으로
 * 다시 잠근다. `list_history` 호출 wire shape + create/clear event refetch
 * 는 sibling `QueryLog.list-history.test.tsx` 에서 다룬다.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

// Icons mocked so testid 단언이 변동 없이 안정적이다.
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Trash2: () => <span data-testid="icon-trash" />,
  RefreshCw: () => <span data-testid="icon-refresh" />,
}));

import QueryLog from "./QueryLog";
import { resetStateChangedRegistryForTests } from "@lib/events/stateChanged";
import type { HistoryListRow } from "@lib/tauri/history";

/**
 * sprint-177 matcher helper — `QuerySyntax` 가 SQL 을 span tree 로 토큰화하므로
 * RTL 의 `getByText` 가 single text node 만 매칭한다. `font-mono` wrapper
 * span 으로 좁혀 joined `textContent` 가 needle 을 포함하는지 본다.
 */
function getByJoinedText(needle: string): HTMLElement {
  return screen.getByText((_, element) => {
    if (!element || !element.classList.contains("font-mono")) return false;
    return element.textContent?.includes(needle) ?? false;
  });
}
function queryByJoinedText(needle: string): HTMLElement | null {
  return screen.queryByText((_, element) => {
    if (!element || !element.classList.contains("font-mono")) return false;
    return element.textContent?.includes(needle) ?? false;
  });
}

const baseRow = (overrides: Partial<HistoryListRow> = {}): HistoryListRow => ({
  id: 1,
  connectionId: "conn-1",
  paradigm: "rdb",
  queryMode: "sql",
  source: "raw",
  sqlRedacted: "SELECT 1",
  status: "success",
  durationMs: 50,
  executedAt: Date.now() - 10_000,
  ...overrides,
});

/** Mock `list_history` to resolve once with the supplied rows. */
function mockList(rows: HistoryListRow[]): void {
  invokeMock.mockResolvedValueOnce({ rows });
}

function toggleVisible(): void {
  act(() => {
    window.dispatchEvent(new CustomEvent("toggle-query-log"));
  });
}

describe("QueryLog visual + UX invariants (sprint-372 rewrite)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  it("does not render by default", () => {
    render(<QueryLog />);
    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("renders on toggle-query-log event", async () => {
    mockList([]);
    render(<QueryLog />);
    toggleVisible();
    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
  });

  it("shows log rows from the list_history response", async () => {
    mockList([
      baseRow({ id: 1, sqlRedacted: "SELECT * FROM users" }),
      baseRow({ id: 2, sqlRedacted: "DROP TABLE orders", status: "error" }),
    ]);

    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();
      expect(getByJoinedText("DROP TABLE orders")).toBeInTheDocument();
    });
    expect(screen.getByTitle("success")).toBeInTheDocument();
    expect(screen.getByTitle("error")).toBeInTheDocument();
  });

  it("filters rows by search text (client side, on sqlRedacted)", async () => {
    mockList([
      baseRow({ id: 1, sqlRedacted: "SELECT * FROM users" }),
      baseRow({ id: 2, sqlRedacted: "SELECT * FROM orders" }),
    ]);

    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText("Search queries...");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "users" } });
    });

    expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();
    expect(queryByJoinedText("SELECT * FROM orders")).not.toBeInTheDocument();
  });

  it("toggles visibility on the second toggle-query-log event", async () => {
    mockList([]);
    render(<QueryLog />);
    toggleVisible();
    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
    toggleVisible();
    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("closes panel when X button is clicked", async () => {
    mockList([]);
    render(<QueryLog />);
    toggleVisible();
    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();

    const closeBtn = screen.getByRole("button", { name: /close query log/i });
    act(() => {
      closeBtn.click();
    });
    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("shows the empty message when backend returns no rows", async () => {
    mockList([]);
    render(<QueryLog />);
    toggleVisible();
    await waitFor(() => {
      expect(screen.getByText("No queries executed yet")).toBeInTheDocument();
    });
  });

  it("shows 'No matching queries' when the search filter excludes everything", async () => {
    mockList([baseRow({ id: 1, sqlRedacted: "SELECT * FROM users" })]);
    render(<QueryLog />);
    toggleVisible();
    await screen.findByTestId("query-log-row-1");

    const searchInput = screen.getByPlaceholderText("Search queries...");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    });
    expect(screen.getByText("No matching queries")).toBeInTheDocument();
  });

  it("truncates long SQL previews to ~80 chars", async () => {
    const longSql = "A".repeat(100);
    mockList([baseRow({ id: 1, sqlRedacted: longSql })]);
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(getByJoinedText("A".repeat(80) + "...")).toBeInTheDocument();
    });
  });

  it("displays relative time for entries (10s ago)", async () => {
    mockList([baseRow({ id: 1, executedAt: Date.now() - 10_000 })]);
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(screen.getByText("10s ago")).toBeInTheDocument();
    });
  });

  it("displays duration in ms", async () => {
    mockList([baseRow({ id: 1, durationMs: 250 })]);
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(screen.getByText("250ms")).toBeInTheDocument();
    });
  });

  it("shows 'just now' for very recent entries (< 5s)", async () => {
    mockList([baseRow({ id: 1, executedAt: Date.now() - 1000 })]);
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(screen.getByText("just now")).toBeInTheDocument();
    });
  });

  // -----------------------------------------------------------------------
  // Sprint 49 — theme CSS variables for status dots
  // -----------------------------------------------------------------------
  it("uses theme CSS variable for the success status dot", async () => {
    mockList([baseRow({ id: 1, status: "success" })]);
    render(<QueryLog />);
    toggleVisible();
    await screen.findByTestId("query-log-row-1");
    const dot = screen.getByTitle("success");
    expect(dot.className).toContain("bg-success");
  });

  it("uses theme CSS variable for the error status dot", async () => {
    mockList([baseRow({ id: 1, status: "error" })]);
    render(<QueryLog />);
    toggleVisible();
    await screen.findByTestId("query-log-row-1");
    const dot = screen.getByTitle("error");
    expect(dot.className).toContain("destructive");
  });

  // sprint-180 [AC-180-03c] — cancelled status paints calm muted dot.
  it("[AC-180-03c] uses muted-foreground colour for the cancelled status dot", async () => {
    mockList([
      baseRow({
        id: 1,
        status: "cancelled",
        sqlRedacted: "SELECT pg_sleep(?)",
      }),
    ]);
    render(<QueryLog />);
    toggleVisible();
    await screen.findByTestId("query-log-row-1");

    const dot = screen.getByTitle("cancelled");
    expect(dot.className).toContain("bg-muted-foreground");
    expect(dot.className).not.toContain("destructive");
    expect(dot.className).not.toContain("success");
    expect(dot.getAttribute("data-status")).toBe("cancelled");
  });

  // -----------------------------------------------------------------------
  // Sprint 177 — paradigm-aware syntax highlighting
  // -----------------------------------------------------------------------
  describe("paradigm-aware syntax highlighting (sprint-177 invariant)", () => {
    it("[AC-177-01] Mongo entry surfaces the cm-mql-operator marker", async () => {
      mockList([
        baseRow({
          id: 1,
          paradigm: "document",
          queryMode: "find",
          sqlRedacted: '{"$match":{"$eq":1}}',
        }),
      ]);
      const { container } = render(<QueryLog />);
      toggleVisible();
      await screen.findByTestId("query-log-row-1");

      const operator = container.querySelector(".cm-mql-operator");
      expect(operator).not.toBeNull();
      expect(operator?.textContent).toBe('"$match"');
    });

    it("[AC-177-02] RDB entry renders SQL keyword marker without MQL marker", async () => {
      mockList([
        baseRow({
          id: 1,
          paradigm: "rdb",
          queryMode: "sql",
          sqlRedacted: "SELECT * FROM users",
        }),
      ]);
      const { container } = render(<QueryLog />);
      toggleVisible();
      await screen.findByTestId("query-log-row-1");

      const keyword = container.querySelector(".text-syntax-keyword");
      expect(keyword).not.toBeNull();
      expect(keyword?.textContent).toBe("SELECT");
      expect(container.querySelector(".cm-mql-operator")).toBeNull();
    });

    it("[AC-177-03] document paradigm never receives SQL coloring (regression guard)", async () => {
      mockList([
        baseRow({
          id: 1,
          paradigm: "document",
          queryMode: "find",
          sqlRedacted: '{"$match":{"name":"SELECT"}}',
        }),
      ]);
      const { container } = render(<QueryLog />);
      toggleVisible();
      await screen.findByTestId("query-log-row-1");

      expect(container.querySelector(".cm-mql-operator")).not.toBeNull();
      const keywordSpans = container.querySelectorAll(".text-syntax-keyword");
      const selectKeyword = Array.from(keywordSpans).find(
        (el) => el.textContent === "SELECT",
      );
      expect(selectKeyword).toBeUndefined();
    });
  });
});

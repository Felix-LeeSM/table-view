import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import QueryLog from "./QueryLog";
import {
  useQueryHistoryStore,
  type QueryHistoryEntry,
} from "@stores/queryHistoryStore";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Trash2: () => <span data-testid="icon-trash" />,
}));

// Mock ConfirmDialog — render a simple dialog with confirm/cancel buttons
vi.mock("@components/shared/ConfirmDialog", () => ({
  default: ({
    onConfirm,
    onCancel,
    title,
  }: {
    onConfirm: () => void;
    onCancel: () => void;
    title: string;
  }) => (
    <div data-testid="confirm-dialog">
      <span>{title}</span>
      <button data-testid="confirm-ok" onClick={onConfirm}>
        Confirm
      </button>
      <button data-testid="confirm-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

/**
 * Sprint 177 matcher migration helper.
 *
 * Reason (2026-04-30): Sprint 177 wraps SQL previews with `<QuerySyntax>` which
 * tokenises the text into multiple `<span>` children. RTL's default `getByText`
 * only matches a single text node, so the legacy regex queries (e.g.
 * `getByText(/SELECT \* FROM users/)`) stop matching once tokens are split.
 *
 * The accepted Design Bar pattern is to match the `font-mono` wrapper span
 * that `SqlSyntax`/`MongoSyntax` always emit, and assert the joined
 * `textContent` (across token children) contains the expected SQL text. We
 * scope to the wrapper so a function matcher on `getByText` does not also
 * match every ancestor (button → div → ...) whose `textContent` happens to
 * include the needle. This keeps the matcher one-element-deep, matching the
 * shape of the previous regex query.
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

describe("QueryLog", () => {
  beforeEach(() => {
    useQueryHistoryStore.setState({ entries: [] });
    vi.clearAllMocks();
  });

  it("does not render by default", () => {
    render(<QueryLog />);
    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("renders on toggle-query-log event", () => {
    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
  });

  it("shows log entries from history store", () => {
    // Sprint 177: SQL is now tokenized into spans; matcher joins child textContent.
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now - 5000,
          duration: 120,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "DROP TABLE orders",
          executedAt: now - 2000,
          duration: 50,
          status: "error",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();
    expect(getByJoinedText("DROP TABLE orders")).toBeInTheDocument();
    // Check status indicators
    expect(screen.getByTitle("success")).toBeInTheDocument();
    expect(screen.getByTitle("error")).toBeInTheDocument();
  });

  it("filters entries by search text", async () => {
    // Sprint 177: SQL is now tokenized into spans; matcher joins child textContent.
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now - 5000,
          duration: 120,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: now - 2000,
          duration: 50,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const searchInput = screen.getByPlaceholderText("Search queries...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "users" } });
    });

    expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();
    expect(queryByJoinedText("SELECT * FROM orders")).not.toBeInTheDocument();
  });

  it("clicking entry dispatches insert-sql event", async () => {
    // Sprint 177: SQL is tokenized into spans; we click any descendant span and
    // rely on the click bubbling to the parent <button> with the onClick handler.
    const handler = vi.fn();
    window.addEventListener("insert-sql", handler);

    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now,
          duration: 100,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const tokenSpan = getByJoinedText("SELECT * FROM users");
    await act(async () => {
      tokenSpan.click();
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { sql: "SELECT * FROM users" },
      }),
    );

    window.removeEventListener("insert-sql", handler);
  });

  it("clear button shows confirmation dialog before clearing history", async () => {
    // Sprint 177: SQL is tokenized into spans; matcher joins child textContent.
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now,
          duration: 100,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(getByJoinedText("SELECT * FROM users")).toBeInTheDocument();

    // Click clear button — should show confirm dialog, not clear immediately
    const clearBtn = screen.getByRole("button", { name: /clear/i });
    await act(async () => {
      clearBtn.click();
    });

    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("Clear Query History")).toBeInTheDocument();
    // History should NOT be cleared yet
    expect(useQueryHistoryStore.getState().entries).toHaveLength(1);

    // Confirm the dialog
    await act(async () => {
      screen.getByTestId("confirm-ok").click();
    });

    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
  });

  it("clear cancel does not clear history", async () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now,
          duration: 100,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const clearBtn = screen.getByRole("button", { name: /clear/i });
    await act(async () => {
      clearBtn.click();
    });

    // Cancel the dialog
    await act(async () => {
      screen.getByTestId("confirm-cancel").click();
    });

    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().entries).toHaveLength(1);
  });

  it("toggles visibility on second toggle-query-log event", () => {
    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("closes panel when X button is clicked", () => {
    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();

    const closeBtn = screen.getByTestId("icon-x").closest("button")!;
    act(() => {
      closeBtn.click();
    });

    expect(screen.queryByTestId("query-log-panel")).not.toBeInTheDocument();
  });

  it("shows empty message when no queries executed yet", () => {
    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByText("No queries executed yet")).toBeInTheDocument();
  });

  it("shows no matching queries message when search has no results", async () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: now,
          duration: 100,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const searchInput = screen.getByPlaceholderText("Search queries...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    });

    expect(screen.getByText("No matching queries")).toBeInTheDocument();
  });

  it("truncates long SQL strings", () => {
    // Sprint 177: SQL is tokenized into spans; SqlSyntax tokenises an all-`A`
    // string as a single identifier token, so the truncated text appears as
    // the textContent of the rendered preview. Use the joined-text matcher
    // for symmetry with the other Sprint 177 migrations.
    const longSql = "A".repeat(100);
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: longSql,
          executedAt: now,
          duration: 100,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    // The displayed text should be truncated (80 chars + "...")
    const truncatedText = "A".repeat(80) + "...";
    expect(getByJoinedText(truncatedText)).toBeInTheDocument();
  });

  it("displays relative time for entries", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: now - 10000, // 10 seconds ago
          duration: 50,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    // 10s ago should show "10s ago"
    expect(screen.getByText("10s ago")).toBeInTheDocument();
  });

  it("displays duration for entries", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: now,
          duration: 250,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByText("250ms")).toBeInTheDocument();
  });

  it("shows just now for very recent entries", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: now - 1000, // 1 second ago
          duration: 50,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Sprint 49: Theme CSS variables for status dots
  // -----------------------------------------------------------------------
  it("uses theme CSS variable for success status dot", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: now,
          duration: 50,
          status: "success",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const dot = screen.getByTitle("success");
    expect(dot.className).toContain("bg-success");
  });

  it("uses theme CSS variable for error status dot", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "BAD QUERY",
          executedAt: now,
          duration: 50,
          status: "error",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const dot = screen.getByTitle("error");
    expect(dot.className).toContain("destructive");
  });

  // [AC-180-03c] Cancelled entries paint a calm muted-foreground dot,
  // distinct from both the success green and the destructive red. This
  // pins the Sprint 180 Visual Direction quote ("calm secondary, not
  // destructive") at the rendering layer.
  // Date: 2026-04-30 (sprint-180)
  it("[AC-180-03c] uses muted-foreground colour for cancelled status dot", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      entries: [
        {
          id: "h-1",
          sql: "SELECT pg_sleep(60)",
          executedAt: now,
          duration: 1500,
          status: "cancelled",
          connectionId: "conn1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const dot = screen.getByTitle("cancelled");
    // Calm secondary — not destructive (red), not success (green).
    expect(dot.className).toContain("bg-muted-foreground");
    expect(dot.className).not.toContain("destructive");
    expect(dot.className).not.toContain("success");
    // The data-status attribute exposes the cancelled discriminator
    // for downstream test queries / styling hooks.
    expect(dot.getAttribute("data-status")).toBe("cancelled");
  });

  // -----------------------------------------------------------------------
  // Sprint 177: Law of Similarity — paradigm-aware syntax highlighting
  //
  // Reason (2026-04-30): The dock-style QueryLog was the third (and last)
  // executed-query preview surface still emitting plain text. Sprint 177
  // routes each entry through `QuerySyntax`, so a Mongo `find` is coloured
  // with MQL operator highlighting (`cm-mql-operator`) and an RDB `SELECT`
  // is coloured with the SQL keyword treatment (`text-syntax-keyword`).
  // These tests lock the marker-class invariants required by the spec
  // (`docs/sprints/sprint-177/contract.md` §In Scope).
  // -----------------------------------------------------------------------
  describe("Sprint 177 — paradigm-aware syntax highlighting", () => {
    it("[AC-177-01] Mongo entry surfaces the cm-mql-operator marker", () => {
      // Reason (2026-04-30): Mongo paradigm rows must visually match
      // QueryTab + GlobalQueryLogPanel by carrying the MQL operator class.
      useQueryHistoryStore.setState({
        entries: [
          {
            id: "mongo-1",
            sql: '{"$match":{"$eq":1}}',
            executedAt: Date.now(),
            duration: 12,
            status: "success",
            connectionId: "mongo-conn",
            paradigm: "document",
            queryMode: "find",
          },
        ],
      });

      const { container } = render(<QueryLog />);
      act(() => {
        window.dispatchEvent(new CustomEvent("toggle-query-log"));
      });

      const operator = container.querySelector(".cm-mql-operator");
      expect(operator).not.toBeNull();
      // Operator token preserves the surrounding quotes — `"$match"` is the
      // whole string-literal text emitted by `tokenizeMongo` for an operator.
      expect(operator?.textContent).toBe('"$match"');
    });

    it("[AC-177-02] RDB entry renders SQL keyword marker without MQL marker", () => {
      // Reason (2026-04-30): RDB paradigm rows must carry the SQL keyword
      // class (so theming behaves like the editor) AND must NOT carry the
      // Mongo operator class (so the two paradigms remain visually
      // distinguishable per the Law of Similarity).
      useQueryHistoryStore.setState({
        entries: [
          {
            id: "rdb-1",
            sql: "SELECT * FROM users",
            executedAt: Date.now(),
            duration: 30,
            status: "success",
            connectionId: "pg-conn",
            paradigm: "rdb",
            queryMode: "sql",
          },
        ],
      });

      const { container } = render(<QueryLog />);
      act(() => {
        window.dispatchEvent(new CustomEvent("toggle-query-log"));
      });

      const keyword = container.querySelector(".text-syntax-keyword");
      expect(keyword).not.toBeNull();
      expect(keyword?.textContent).toBe("SELECT");
      expect(container.querySelector(".cm-mql-operator")).toBeNull();
    });

    it("[AC-177-03] document paradigm never receives SQL coloring (regression guard)", () => {
      // Reason (2026-04-30): If a Mongo entry were mis-routed to SqlSyntax
      // (e.g. via the legacy fallback at queryHistoryStore.ts:75), an
      // SQL-looking word inside the JSON payload would be coloured as a
      // keyword. We seed a payload whose JSON value is the literal "SELECT"
      // and assert (a) the Mongo path was taken (operator class present)
      // and (b) no `text-syntax-keyword` span has the textContent "SELECT".
      // Note: MongoSyntax also applies `text-syntax-keyword` to JSON
      // literals (true/false/null), so we cannot assert "no keyword span at
      // all" — the assertion is scoped to the SQL keyword text.
      useQueryHistoryStore.setState({
        entries: [
          {
            id: "mongo-2",
            sql: '{"$match":{"name":"SELECT"}}',
            executedAt: Date.now(),
            duration: 8,
            status: "success",
            connectionId: "mongo-conn",
            paradigm: "document",
            queryMode: "find",
          },
        ],
      });

      const { container } = render(<QueryLog />);
      act(() => {
        window.dispatchEvent(new CustomEvent("toggle-query-log"));
      });

      // Mongo path was taken.
      expect(container.querySelector(".cm-mql-operator")).not.toBeNull();

      // No keyword span has the textContent "SELECT" — the SQL tokenizer
      // was NOT invoked on this document-paradigm entry.
      const keywordSpans = container.querySelectorAll(".text-syntax-keyword");
      const selectKeyword = Array.from(keywordSpans).find(
        (el) => el.textContent === "SELECT",
      );
      expect(selectKeyword).toBeUndefined();
    });

    it("[AC-177-04] 50 mixed-paradigm entries render without console errors or warnings", () => {
      // Reason (2026-04-30): Performance / correctness regression guard for
      // span-tree expansion across mixed paradigms. We seed 50 entries with
      // realistic 80+ char payloads (so truncation kicks in mid-token), spy
      // on console.error / console.warn, and assert (a) no warnings, (b)
      // both paradigm marker classes are present (smoke that both renderers
      // ran), (c) the panel rendered without throwing.
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Both seeds are intentionally >80 chars so `truncateSql(entry.sql, 80)`
      // cuts mid-token in BOTH paradigms (RDB 95 chars, Mongo 88 chars). This
      // strengthens the AC-177-04 regression guard: the lenient tokenizers
      // must absorb mid-token truncation for both `SqlSyntax` and
      // `MongoSyntax` without throwing or emitting console warnings.
      const baseRdbSql =
        "SELECT id, name, email FROM users WHERE created_at > NOW() - INTERVAL '30 days' ORDER BY id ASC";
      const baseMongoSql =
        '{"$match":{"status":{"$in":["active","pending"]}},"$sort":{"createdAt":-1},"$limit":100}';

      const now = Date.now();
      const entries: QueryHistoryEntry[] = Array.from(
        { length: 50 },
        (_, i) => {
          const isMongo = i % 2 === 0;
          const paradigm: QueryHistoryEntry["paradigm"] = isMongo
            ? "document"
            : "rdb";
          const queryMode: QueryHistoryEntry["queryMode"] = isMongo
            ? i % 4 === 0
              ? "find"
              : "aggregate"
            : "sql";
          return {
            id: `mix-${i}`,
            sql: isMongo ? baseMongoSql : baseRdbSql,
            executedAt: now - i * 1000,
            duration: 10 + i,
            status: "success",
            connectionId: isMongo ? "mongo-conn" : "pg-conn",
            paradigm,
            queryMode,
          };
        },
      );
      useQueryHistoryStore.setState({ entries });

      let container!: HTMLElement;
      expect(() => {
        const result = render(<QueryLog />);
        container = result.container;
        act(() => {
          window.dispatchEvent(new CustomEvent("toggle-query-log"));
        });
      }).not.toThrow();

      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      // Both paradigm renderers ran for the mixed seed.
      expect(
        container.querySelectorAll(".cm-mql-operator").length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        container.querySelectorAll(".text-syntax-keyword").length,
      ).toBeGreaterThanOrEqual(1);

      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("does not throw when a Mongo entry has malformed / truncated JSON", () => {
      // Reason (2026-04-30): tokenizeMongo is non-throwing per its contract,
      // but we lock the panel-level invariant here — a truncated payload
      // (e.g. mid-object truncation from `truncateSql`) must not crash the
      // QueryLog render.
      useQueryHistoryStore.setState({
        entries: [
          {
            id: "mongo-bad",
            sql: '{"$match":{',
            executedAt: Date.now(),
            duration: 4,
            status: "success",
            connectionId: "mongo-conn",
            paradigm: "document",
            queryMode: "find",
          },
        ],
      });

      expect(() => {
        render(<QueryLog />);
        act(() => {
          window.dispatchEvent(new CustomEvent("toggle-query-log"));
        });
      }).not.toThrow();

      expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
    });
  });
});

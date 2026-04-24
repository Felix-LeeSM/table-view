import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import GlobalQueryLogPanel from "./GlobalQueryLogPanel";
import { useQueryHistoryStore } from "@stores/queryHistoryStore";
import { useConnectionStore } from "@stores/connectionStore";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Trash2: () => <span data-testid="icon-trash" />,
  Copy: () => <span data-testid="icon-copy" />,
  CheckCircle2: () => <span data-testid="icon-check" />,
  XCircle: () => <span data-testid="icon-x-circle" />,
  ChevronDown: () => <span data-testid="icon-chevron" />,
}));

// Mock ConfirmDialog
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

// Mock cn utility
vi.mock("@/lib/utils", () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(" "),
}));

describe("GlobalQueryLogPanel", () => {
  const onClose = vi.fn();

  beforeEach(() => {
    useQueryHistoryStore.setState({
      entries: [],
      globalLog: [],
      searchFilter: "",
      connectionFilter: null,
    });
    useConnectionStore.setState({
      connections: [
        {
          id: "conn-1",
          name: "My DB",
          db_type: "postgresql",
          host: "localhost",
          port: 5432,
          user: "postgres",
          has_password: false,
          database: "testdb",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
        {
          id: "conn-2",
          name: "Other DB",
          db_type: "mysql",
          host: "localhost",
          port: 3306,
          user: "root",
          has_password: false,
          database: "otherdb",
          group_id: null,
          color: null,
          paradigm: "rdb",
        },
      ],
    });
    vi.clearAllMocks();
  });

  it("does not render when visible is false", () => {
    render(<GlobalQueryLogPanel visible={false} onClose={onClose} />);
    expect(
      screen.queryByTestId("global-query-log-panel"),
    ).not.toBeInTheDocument();
  });

  it("renders when visible is true", () => {
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByTestId("global-query-log-panel")).toBeInTheDocument();
  });

  it("shows entry count badge", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "SELECT 2",
          executedAt: Date.now(),
          duration: 30,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    // The count badge renders the entry count next to the "Query Log"
    // title. It uses a distinct bg-muted class; use an accessible lookup
    // that scopes to the panel header rather than searching the whole
    // document (which now also surfaces tokenised `2` spans inside the
    // QuerySyntax preview for the `SELECT 2` entry).
    const title = screen.getByText("Query Log");
    const badge = title.nextElementSibling as HTMLElement | null;
    expect(badge?.textContent).toBe("2");
  });

  it("displays log entries with SQL text", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: Date.now(),
          duration: 120,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    // QuerySyntax splits the SQL across multiple tokenised `<span>`s, so
    // the aggregate text lives on the entry row rather than on a single
    // leaf node. Assert against the row's textContent.
    const row = screen.getByTestId("global-log-entry-h-1");
    expect(row.textContent).toMatch(/SELECT \* FROM users/);
  });

  it("displays connection name badge for entries", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    // "My DB" appears in both the connection filter dropdown and the entry badge
    const allMyDb = screen.getAllByText("My DB");
    expect(allMyDb.length).toBeGreaterThanOrEqual(2);
  });

  it("displays duration badge for entries", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 250,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByText("250ms")).toBeInTheDocument();
  });

  it("shows empty message when no queries executed", () => {
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByText("No queries executed yet")).toBeInTheDocument();
  });

  it("filters entries by search text", async () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: Date.now(),
          duration: 120,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-2",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const searchInput = screen.getByTestId("global-log-search");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "users" } });
    });

    // QuerySyntax splits the SQL across tokenised spans; scope to the
    // surviving entry row and assert via textContent.
    expect(screen.getByTestId("global-log-entry-h-1").textContent).toMatch(
      /SELECT \* FROM users/,
    );
    expect(
      screen.queryByTestId("global-log-entry-h-2"),
    ).not.toBeInTheDocument();
  });

  it("shows no matching queries message when search has no results", async () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: Date.now(),
          duration: 100,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const searchInput = screen.getByTestId("global-log-search");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "nonexistent" } });
    });

    expect(screen.getByText("No matching queries")).toBeInTheDocument();
  });

  it("filters by connection using dropdown", async () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: Date.now(),
          duration: 120,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-2",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const filterSelect = screen.getByTestId("global-log-connection-filter");
    await act(async () => {
      fireEvent.change(filterSelect, { target: { value: "conn-1" } });
    });

    // QuerySyntax splits the SQL across tokenised spans; scope by entry id.
    expect(screen.getByTestId("global-log-entry-h-1").textContent).toMatch(
      /SELECT \* FROM users/,
    );
    expect(
      screen.queryByTestId("global-log-entry-h-2"),
    ).not.toBeInTheDocument();
  });

  it("shows status icons for entries", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
        {
          id: "h-2",
          sql: "BAD QUERY",
          executedAt: Date.now(),
          duration: 10,
          status: "error",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const successIcon = screen.getByTitle("success");
    const errorIcon = screen.getByTitle("error");
    expect(successIcon).toBeInTheDocument();
    expect(errorIcon).toBeInTheDocument();
  });

  it("expands SQL on entry click when SQL is long", async () => {
    const longSql = "A".repeat(100);
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: longSql,
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const row = screen.getByTestId("global-log-entry-h-1");

    // Initially truncated — QuerySyntax renders tokenised spans, so assert
    // against the row's aggregate textContent (which ends in the `...`
    // the truncate helper appends).
    const truncatedText = "A".repeat(80) + "...";
    expect(row.textContent).toContain(truncatedText);
    expect(row.querySelector("pre")).toBeNull();

    // Click to expand
    await act(async () => {
      row.click();
    });

    // After expansion the entry should contain the full SQL and a `<pre>`
    // wrapper holding the QuerySyntax preview.
    expect(row.textContent).toContain(longSql);
    const preElement = row.querySelector("pre");
    expect(preElement).not.toBeNull();
    expect(preElement?.textContent).toBe(longSql);
  });

  it("calls onClose when close button is clicked", async () => {
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const closeBtn = screen.getByLabelText("Close query log");
    await act(async () => {
      closeBtn.click();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clear button shows confirmation dialog", async () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const clearBtn = screen.getByLabelText("Clear global log");
    await act(async () => {
      clearBtn.click();
    });

    expect(screen.getByTestId("confirm-dialog")).toBeInTheDocument();
    expect(screen.getByText("Clear Global Query Log")).toBeInTheDocument();
    // Should NOT be cleared yet
    expect(useQueryHistoryStore.getState().globalLog).toHaveLength(1);

    // Confirm the dialog
    await act(async () => {
      screen.getByTestId("confirm-ok").click();
    });

    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().globalLog).toHaveLength(0);
  });

  it("clear cancel does not clear log", async () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const clearBtn = screen.getByLabelText("Clear global log");
    await act(async () => {
      clearBtn.click();
    });

    await act(async () => {
      screen.getByTestId("confirm-cancel").click();
    });

    expect(screen.queryByTestId("confirm-dialog")).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().globalLog).toHaveLength(1);
  });

  it("copies SQL to clipboard when copy button clicked", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", {
      clipboard: { writeText },
    });

    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT * FROM users",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const copyBtn = screen.getByLabelText("Copy SQL");
    await act(async () => {
      copyBtn.click();
    });

    expect(writeText).toHaveBeenCalledWith("SELECT * FROM users");

    vi.unstubAllGlobals();
  });

  it("displays relative time for entries", () => {
    const now = Date.now();
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-1",
          sql: "SELECT 1",
          executedAt: now - 10000,
          duration: 50,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByText("10s ago")).toBeInTheDocument();
  });

  it("resets local state when panel becomes hidden", () => {
    const { rerender } = render(
      <GlobalQueryLogPanel visible={true} onClose={onClose} />,
    );

    // Type in search
    const searchInput = screen.getByTestId("global-log-search");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Hide the panel
    rerender(<GlobalQueryLogPanel visible={false} onClose={onClose} />);

    // Show it again
    rerender(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    // Search should be reset
    const newSearchInput = screen.getByTestId(
      "global-log-search",
    ) as HTMLInputElement;
    expect(newSearchInput.value).toBe("");
  });

  // ── Sprint 85: paradigm-aware syntax preview ─────────────────────────────

  // AC-03 — rdb entry collapsed row routes through QuerySyntax → SqlSyntax,
  // so SQL keyword token class (`text-syntax-keyword`) appears in the DOM.
  it("renders SQL coloration for rdb entries in the collapsed row (AC-03 rdb)", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-rdb",
          sql: "SELECT 1",
          executedAt: Date.now(),
          duration: 5,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    const row = screen.getByTestId("global-log-entry-h-rdb");
    expect(row.querySelector(".text-syntax-keyword")).not.toBeNull();
    expect(row.querySelector(".cm-mql-operator")).toBeNull();
  });

  // AC-03 — document entry collapsed row routes through QuerySyntax →
  // MongoSyntax, so operator tokens (`$match`) carry the
  // `cm-mql-operator` class. No SQL keyword class should leak in.
  it("renders MQL operator class for document entries in the collapsed row (AC-03 document)", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-doc",
          sql: '{"$match": {}}',
          executedAt: Date.now(),
          duration: 5,
          status: "success",
          connectionId: "conn-1",
          paradigm: "document",
          queryMode: "find",
          database: "mydb",
          collection: "users",
        },
      ],
    });
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    const row = screen.getByTestId("global-log-entry-h-doc");
    const operator = row.querySelector(".cm-mql-operator");
    expect(operator).not.toBeNull();
    expect(operator?.textContent).toBe('"$match"');
  });

  // AC-03 — legacy entry (paradigm undefined) falls back to SqlSyntax.
  it("falls back to SQL coloration when paradigm is undefined (AC-03 legacy)", () => {
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-legacy",
          sql: "SELECT legacy",
          executedAt: Date.now(),
          duration: 5,
          status: "success",
          connectionId: "conn-1",
        } as unknown as ReturnType<
          typeof useQueryHistoryStore.getState
        >["globalLog"][number],
      ],
    });
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    const row = screen.getByTestId("global-log-entry-h-legacy");
    expect(row.querySelector(".text-syntax-keyword")).not.toBeNull();
    expect(row.querySelector(".cm-mql-operator")).toBeNull();
  });

  // AC-04 — expanded `<pre>` body on a document entry also carries the
  // `cm-mql-operator` class, so both the collapsed and expanded views
  // share the same renderer.
  it("carries cm-mql-operator into the expanded body for a document entry (AC-04)", async () => {
    // Sprint 85 entry body needs to exceed 80 chars so the expanded <pre>
    // block renders (the component only opens it when sql.length > 80).
    const longDocSql =
      '{"$match": {"x": "' + "y".repeat(90) + '"}, "$limit": 10}';
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-doc-long",
          sql: longDocSql,
          executedAt: Date.now(),
          duration: 5,
          status: "success",
          connectionId: "conn-1",
          paradigm: "document",
          queryMode: "aggregate",
        },
      ],
    });
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    const row = screen.getByTestId("global-log-entry-h-doc-long");

    await act(async () => {
      row.click();
    });

    const pre = row.querySelector("pre");
    expect(pre).not.toBeNull();
    const operator = pre?.querySelector(".cm-mql-operator");
    expect(operator).not.toBeNull();
    expect(operator?.textContent).toBe('"$match"');
  });

  // AC-05 — long SQL is still truncated to 80 chars in the collapsed row
  // regardless of paradigm. QuerySyntax renders the already-sliced string
  // so the `...` suffix remains visible without falling out of the Mongo
  // tokenisation path.
  it("keeps the 80 char truncate behaviour in the collapsed row (AC-05)", () => {
    const longRdb = "A".repeat(100);
    useQueryHistoryStore.setState({
      globalLog: [
        {
          id: "h-long-rdb",
          sql: longRdb,
          executedAt: Date.now(),
          duration: 5,
          status: "success",
          connectionId: "conn-1",
          paradigm: "rdb",
          queryMode: "sql",
        },
      ],
    });
    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    const row = screen.getByTestId("global-log-entry-h-long-rdb");
    expect(row.textContent).toContain("A".repeat(80) + "...");
  });
});

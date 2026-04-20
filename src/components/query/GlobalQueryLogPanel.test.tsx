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
        },
        {
          id: "h-2",
          sql: "SELECT 2",
          executedAt: Date.now(),
          duration: 30,
          status: "success",
          connectionId: "conn-1",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByText("2")).toBeInTheDocument();
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
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);
    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
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
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-2",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const searchInput = screen.getByTestId("global-log-search");
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "users" } });
    });

    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.queryByText(/SELECT \* FROM orders/)).not.toBeInTheDocument();
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
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: Date.now(),
          duration: 50,
          status: "success",
          connectionId: "conn-2",
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    const filterSelect = screen.getByTestId("global-log-connection-filter");
    await act(async () => {
      fireEvent.change(filterSelect, { target: { value: "conn-1" } });
    });

    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.queryByText(/SELECT \* FROM orders/)).not.toBeInTheDocument();
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
        },
        {
          id: "h-2",
          sql: "BAD QUERY",
          executedAt: Date.now(),
          duration: 10,
          status: "error",
          connectionId: "conn-1",
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
        },
      ],
    });

    render(<GlobalQueryLogPanel visible={true} onClose={onClose} />);

    // Initially truncated
    const truncatedText = "A".repeat(80) + "...";
    expect(screen.getByText(truncatedText)).toBeInTheDocument();

    // Click to expand
    const entry = screen.getByTestId("global-log-entry-h-1");
    await act(async () => {
      entry.click();
    });

    // Now should show full SQL in both the inline span and expanded pre
    const allFullSql = screen.getAllByText(longSql);
    expect(allFullSql.length).toBeGreaterThanOrEqual(1);
    // The expanded pre should be present
    const preElement = allFullSql.find((el) => el.tagName === "PRE");
    expect(preElement).toBeDefined();
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
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import QueryLog from "./QueryLog";
import { useQueryHistoryStore } from "../stores/queryHistoryStore";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
  Trash2: () => <span data-testid="icon-trash" />,
}));

// Mock ConfirmDialog — render a simple dialog with confirm/cancel buttons
vi.mock("./ConfirmDialog", () => ({
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
        },
        {
          id: "h-2",
          sql: "DROP TABLE orders",
          executedAt: now - 2000,
          duration: 50,
          status: "error",
          connectionId: "conn1",
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.getByText(/DROP TABLE orders/)).toBeInTheDocument();
    // Check status indicators
    expect(screen.getByTitle("success")).toBeInTheDocument();
    expect(screen.getByTitle("error")).toBeInTheDocument();
  });

  it("filters entries by search text", async () => {
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
        },
        {
          id: "h-2",
          sql: "SELECT * FROM orders",
          executedAt: now - 2000,
          duration: 50,
          status: "success",
          connectionId: "conn1",
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

    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();
    expect(screen.queryByText(/SELECT \* FROM orders/)).not.toBeInTheDocument();
  });

  it("clicking entry dispatches insert-sql event", async () => {
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
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const entry = screen.getByText(/SELECT \* FROM users/);
    await act(async () => {
      entry.click();
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { sql: "SELECT * FROM users" },
      }),
    );

    window.removeEventListener("insert-sql", handler);
  });

  it("clear button shows confirmation dialog before clearing history", async () => {
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
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    expect(screen.getByText(/SELECT \* FROM users/)).toBeInTheDocument();

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
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    // The displayed text should be truncated (80 chars + "...")
    const truncatedText = "A".repeat(80) + "...";
    expect(screen.getByText(truncatedText)).toBeInTheDocument();
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
        },
      ],
    });

    render(<QueryLog />);

    act(() => {
      window.dispatchEvent(new CustomEvent("toggle-query-log"));
    });

    const dot = screen.getByTitle("success");
    expect(dot.className).toContain("emerald-500");
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
});

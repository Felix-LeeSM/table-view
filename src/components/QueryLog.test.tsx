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

  it("clear button clears history", async () => {
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

    const clearBtn = screen.getByRole("button", { name: /clear/i });
    await act(async () => {
      clearBtn.click();
    });

    expect(screen.queryByText(/SELECT \* FROM users/)).not.toBeInTheDocument();
    expect(useQueryHistoryStore.getState().entries).toHaveLength(0);
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
});

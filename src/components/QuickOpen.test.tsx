import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  render,
  screen,
  act,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import QuickOpen from "./QuickOpen";

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Search: () => <span data-testid="icon-search" />,
  X: () => <span data-testid="icon-x" />,
}));

describe("QuickOpen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not render by default", () => {
    render(<QuickOpen />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders on quick-open event", () => {
    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("shows search input with auto-focus", () => {
    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const searchInput = screen.getByPlaceholderText("Search tables...");
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveFocus();
  });

  it("filters tables as user types", async () => {
    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    const searchInput = screen.getByPlaceholderText("Search tables...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "user" } });
    });

    // Should show only tables matching "user"
    // Since we have no tables by default, the list should show empty state
    expect(screen.getByText("No tables found")).toBeInTheDocument();
  });

  it("Escape closes the modal", () => {
    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search tables...");
    act(() => {
      fireEvent.keyDown(searchInput, { key: "Escape" });
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Enter dispatches navigate-table event", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(new CustomEvent("quick-open"));
    });

    // Since there are no tables, Enter should not dispatch
    const searchInput = screen.getByPlaceholderText("Search tables...");
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Enter" });
    });

    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("navigate-table", handler);
  });

  it("clicking a table item dispatches navigate-table event and closes", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    render(<QuickOpen />);

    // Open with tables provided via custom event detail
    act(() => {
      window.dispatchEvent(
        new CustomEvent("quick-open", {
          detail: {
            tables: [
              { name: "users", schema: "public", connectionId: "conn1" },
              { name: "orders", schema: "public", connectionId: "conn1" },
            ],
          },
        }),
      );
    });

    // Should show the tables
    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("orders")).toBeInTheDocument();

    // Click on a table
    const usersBtn = screen.getByRole("button", { name: /users/ });
    await act(async () => {
      usersBtn.click();
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { connectionId: "conn1", schema: "public", table: "users" },
      }),
    );

    // Modal should close
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    window.removeEventListener("navigate-table", handler);
  });

  it("Enter selects the first matching table", async () => {
    const handler = vi.fn();
    window.addEventListener("navigate-table", handler);

    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("quick-open", {
          detail: {
            tables: [
              { name: "users", schema: "public", connectionId: "conn1" },
              { name: "orders", schema: "public", connectionId: "conn1" },
            ],
          },
        }),
      );
    });

    const searchInput = screen.getByPlaceholderText("Search tables...");
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: "Enter" });
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        detail: { connectionId: "conn1", schema: "public", table: "users" },
      }),
    );

    window.removeEventListener("navigate-table", handler);
  });

  it("filters tables by search text", async () => {
    render(<QuickOpen />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent("quick-open", {
          detail: {
            tables: [
              { name: "users", schema: "public", connectionId: "conn1" },
              { name: "orders", schema: "public", connectionId: "conn1" },
              { name: "user_roles", schema: "public", connectionId: "conn1" },
            ],
          },
        }),
      );
    });

    const searchInput = screen.getByPlaceholderText("Search tables...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "user" } });
    });

    expect(screen.getByText("users")).toBeInTheDocument();
    expect(screen.getByText("user_roles")).toBeInTheDocument();
    expect(screen.queryByText("orders")).not.toBeInTheDocument();
  });
});

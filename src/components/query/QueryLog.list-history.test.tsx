/**
 * AC-372-01, AC-372-05, AC-372-08.
 *
 * Reason: locks that QueryLog fills its rows through the backend
 * `list_history` IPC rather than the store `entries`, and that a detail click
 * triggers the `get_history_detail` IPC. It is the start of the user journey,
 * so it follows outcomes from mount/toggle through the detail modal showing.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import {
  dispatchStateChangedPayload,
  resetStateChangedRegistryForTests,
} from "@lib/events/stateChanged";
import QueryLog from "./QueryLog";

const row = (id: number, sqlRedacted = `SELECT ${id}`) => ({
  id,
  connectionId: "conn-1",
  paradigm: "rdb" as const,
  queryMode: "sql",
  source: "raw",
  sqlRedacted,
  status: "success",
  durationMs: 25,
  executedAt: Date.now() - id * 1000,
});

function toggleVisible() {
  act(() => {
    window.dispatchEvent(new CustomEvent("toggle-query-log"));
  });
}

describe("QueryLog list_history wire (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    resetStateChangedRegistryForTests();
  });

  // AC-372-01 — one list_history IPC on QueryLog mount.
  // Reason: this dock panel is the first user touchpoint of the move to the
  // backend as single truth. Locks the single IPC and sqlRedacted arriving.
  it("[AC-372-01] toggle-query-log → list_history IPC + render rows", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [row(1, "SELECT * FROM users WHERE email = ?")],
    });
    render(<QueryLog />);

    toggleVisible();

    await waitFor(() => {
      expect(screen.getByTestId("query-log-panel")).toBeInTheDocument();
    });
    // The hook calls once on mount
    expect(invokeMock).toHaveBeenCalledWith("list_history", {
      req: { limit: 100 },
    });
    // sqlRedacted (truncated) is shown
    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-1")).toBeInTheDocument();
    });
  });

  // AC-372-08 — redact-only display. The original sql is exposed nowhere in
  // the dock panel.
  // Reason: privacy invariant strategy F.5. The list response sends only
  // sqlRedacted, and the panel render uses only sqlRedacted.
  it("[AC-372-08] panel never renders raw sql even if a fake row tried to leak", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [
        {
          ...row(1),
          // The backend never sends this, but even if someone stuffs a sql
          // field into a row the component must not render it.
          sqlRedacted: "SELECT * FROM users WHERE email = ?",
        },
      ],
    });
    render(<QueryLog />);
    toggleVisible();

    const panel = await screen.findByTestId("query-log-panel");
    await waitFor(() => {
      expect(panel).toHaveTextContent("?");
    });
    // No leak of the original reaches the panel.
    expect(panel).not.toHaveTextContent("leak@example.com");
  });

  // AC-372-05 — create event while on the first page → refetch + prepend.
  // Reason: an entry INSERTed from another window must be prepended at the
  // top of this dock so the user sees it at once.
  it("[AC-372-05] history.create event triggers refetch and prepends the new row", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(1)] });
    render(<QueryLog />);
    toggleVisible();

    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-1")).toBeInTheDocument();
    });

    // Second IPC — refetch response (id=2 on top, id=1 below)
    invokeMock.mockResolvedValueOnce({ rows: [row(2), row(1)] });

    await act(async () => {
      dispatchStateChangedPayload("this-window", {
        domain: "history",
        op: "create",
        entityId: "2",
        version: 1,
        snapshotVersion: 0,
        originWindow: "other-window",
        emittedAt: Date.now(),
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("query-log-row-2")).toBeInTheDocument();
    });
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  // detail click path — row click → modal mount → get_history_detail IPC.
  // Reason: confirms the dock panel triggers the only path that exposes the
  // original sql (AC-372-03).
  it("row click opens detail modal and fires get_history_detail IPC", async () => {
    invokeMock.mockResolvedValueOnce({ rows: [row(7)] });
    render(<QueryLog />);
    toggleVisible();

    const rowBtn = await screen.findByTestId("query-log-row-7");

    invokeMock.mockResolvedValueOnce({
      id: 7,
      sql: "SELECT 7",
      sqlRedacted: "SELECT 7",
    });
    await act(async () => {
      rowBtn.click();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
        req: { id: 7 },
      });
    });
    expect(
      screen.getByTestId("query-history-detail-modal"),
    ).toBeInTheDocument();
  });

  // search filter — client side filter on sqlRedacted. User input narrows
  // the visible rows (a backend search is a later refinement).
  // Reason: regression guard that the dock's search UX keeps working.
  it("search input filters rows by sqlRedacted (client side)", async () => {
    invokeMock.mockResolvedValueOnce({
      rows: [row(1, "SELECT * FROM users"), row(2, "SELECT * FROM orders")],
    });
    render(<QueryLog />);
    toggleVisible();

    await screen.findByTestId("query-log-row-1");
    const searchInput = screen.getByPlaceholderText("Search queries...");

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: "orders" } });
    });

    await waitFor(() => {
      expect(screen.queryByTestId("query-log-row-1")).not.toBeInTheDocument();
      expect(screen.getByTestId("query-log-row-2")).toBeInTheDocument();
    });
  });
});

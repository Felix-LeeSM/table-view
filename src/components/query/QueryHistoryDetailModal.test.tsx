/**
 * AC-372-03 + AC-372-08.
 *
 * Reason: the detail modal is the only escape hatch from the redact-only
 * display invariant — mounting it calls the `get_history_detail(id)` IPC and
 * the response `sql` must land on screen. This test follows the user flow
 * path to its last outcome (is the sql text visible) and locks it.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import QueryHistoryDetailModal from "./QueryHistoryDetailModal";

describe("QueryHistoryDetailModal (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  // AC-372-03 — modal mount → get_history_detail(id) once + sql display.
  // Reason: the list response has no sql, so a detail click is the only path
  // that exposes the original. Locks both the invoke args and the response
  // sql reaching the DOM.
  it("[AC-372-03] mount calls get_history_detail and shows original sql", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 7,
      source: "raw",
      sql: "SELECT * FROM users WHERE email = 'leak@example.com'",
      sqlRedacted: "SELECT * FROM users WHERE email = ?",
    });

    render(<QueryHistoryDetailModal id={7} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
        "leak@example.com",
      );
    });

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("get_history_detail", {
      req: { id: 7 },
    });

    // The redacted form is shown alongside.
    expect(
      screen.getByTestId("query-history-detail-sql-redacted"),
    ).toHaveTextContent("?");
  });

  // Loading indicator → gone once the fetch response arrives.
  // Reason: guarantees the UX sequence where the user briefly sees the
  // "Loading…" text and the sql soon replaces it.
  it("shows loading then swaps to detail on resolve", async () => {
    let resolveFn: (v: unknown) => void = () => {};
    invokeMock.mockReturnValueOnce(
      new Promise((res) => {
        resolveFn = res;
      }),
    );

    render(<QueryHistoryDetailModal id={3} onClose={vi.fn()} />);

    expect(
      screen.getByTestId("query-history-detail-loading"),
    ).toBeInTheDocument();

    resolveFn({
      id: 3,
      source: "raw",
      sql: "SELECT 1",
      sqlRedacted: "SELECT 1",
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("query-history-detail-loading"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
      "SELECT 1",
    );
  });

  // backend NotFound → error path. The modal shows the message in an alert
  // role.
  // Reason: when the detail row is race-deleted the user sees a diagnostic
  // message instead of a blank screen.
  it("surfaces backend reject in an alert", async () => {
    invokeMock.mockRejectedValueOnce(new Error("Not found: history 999"));

    render(<QueryHistoryDetailModal id={999} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Not found/);
    });
  });

  // Close button → onClose call. The parent un-mounts the modal.
  // Reason: the modal escape path behaves consistently.
  it("invokes onClose when Close button is clicked", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 1,
      source: "raw",
      sql: "SELECT 1",
      sqlRedacted: "SELECT 1",
    });
    const onClose = vi.fn();
    render(<QueryHistoryDetailModal id={1} onClose={onClose} />);

    await waitFor(() => {
      expect(
        screen.getByTestId("query-history-detail-sql"),
      ).toBeInTheDocument();
    });

    const closeBtn = screen.getByTestId("query-history-detail-close");
    closeBtn.click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only redacted SQL for file analytics history details", async () => {
    invokeMock.mockResolvedValueOnce({
      id: 12,
      source: "file-analytics",
      sql: "SELECT '/Users/felix/private/sales.csv' AS path FROM \"sales_csv\"",
      sqlRedacted: 'SELECT ? AS path FROM "sales_csv"',
    });

    render(<QueryHistoryDetailModal id={12} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("query-history-detail-sql")).toHaveTextContent(
        'SELECT ? AS path FROM "sales_csv"',
      );
    });

    expect(document.body).not.toHaveTextContent(
      "/Users/felix/private/sales.csv",
    );
    expect(
      screen.queryByTestId("query-history-detail-sql-redacted"),
    ).not.toBeInTheDocument();
  });
});

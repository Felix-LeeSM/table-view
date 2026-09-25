/**
 * AC-372-04.
 *
 * Reason: locks the last outcome of the `clear_history` user flow path
 * (does the toast carry `deletedCount`?). Verifies the confirm step, the
 * N-rows response formatting, and the error path. The backend wire shape
 * belongs to `src/lib/tauri/history.test.ts` (lego; invoke
 * "clear_history", no req).
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useToastStore } from "@stores/toastStore";
import ClearHistoryButton from "./ClearHistoryButton";

describe("ClearHistoryButton (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  // AC-372-04 — confirm → IPC → toast "N rows cleared".
  // Reason: a single user flow path. After the confirm dialog, 1 IPC +
  // 1 toast (the message carries `deletedCount`).
  it("[AC-372-04] confirm dialog → clear_history → toast with deletedCount", async () => {
    invokeMock.mockResolvedValueOnce({ deletedCount: 12 });
    render(<ClearHistoryButton />);

    // Trigger → the confirm dialog opens.
    act(() => {
      screen.getByTestId("clear-history-button").click();
    });
    const confirmBtn = screen.getByRole("button", {
      name: /clear all history/i,
    });

    await act(async () => {
      confirmBtn.click();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("clear_history");
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // 1 toast, and `deletedCount` appears in the message.
    await waitFor(() => {
      const ts = useToastStore.getState().toasts;
      expect(ts).toHaveLength(1);
      expect(ts[0]?.variant).toBe("success");
      expect(ts[0]?.message).toMatch(/12 rows cleared/);
    });
  });

  // 1 row → "1 row cleared" (singular). Plural-formatting regression
  // guard. Reason: smooth, i18n-ish wording for the user.
  it("formats singular row count with 'row' (no s)", async () => {
    invokeMock.mockResolvedValueOnce({ deletedCount: 1 });
    render(<ClearHistoryButton />);

    act(() => {
      screen.getByTestId("clear-history-button").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /clear all history/i }).click();
    });

    await waitFor(() => {
      expect(useToastStore.getState().toasts[0]?.message).toMatch(
        /1 row cleared/,
      );
    });
  });

  // backend reject → error toast.
  // Reason: when the clear fails the user gets a diagnostic message,
  // not a silent failure.
  it("surfaces backend reject as an error toast", async () => {
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    render(<ClearHistoryButton />);

    act(() => {
      screen.getByTestId("clear-history-button").click();
    });
    await act(async () => {
      screen.getByRole("button", { name: /clear all history/i }).click();
    });

    await waitFor(() => {
      const ts = useToastStore.getState().toasts;
      expect(ts).toHaveLength(1);
      expect(ts[0]?.variant).toBe("error");
      expect(ts[0]?.message).toMatch(/disk full/);
    });
  });

  // confirm cancel → 0 IPC calls.
  // Reason: an escape path for a mis-click. The lock is 0 backend calls.
  it("does not call IPC when the user cancels the confirm dialog", async () => {
    render(<ClearHistoryButton />);

    act(() => {
      screen.getByTestId("clear-history-button").click();
    });
    const cancelBtn = screen.getByRole("button", { name: /cancel/i });
    await act(async () => {
      cancelBtn.click();
    });

    expect(invokeMock).not.toHaveBeenCalled();
  });
});

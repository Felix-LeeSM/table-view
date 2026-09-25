/**
 * #1566 — Reveal Logs.
 *
 * Reason: locks the last outcome of the user flow path (button click →
 * one `open_log_dir` IPC → error toast on failure). The backend wire
 * shape is the job of the `src-tauri/src/commands/open_log_dir.rs` unit
 * tests.
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import { useToastStore } from "@stores/toastStore";
import RevealLogsButton from "./RevealLogsButton";

describe("RevealLogsButton (#1566)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  // Happy path — click reveals the log folder via a single IPC call.
  it("invokes open_log_dir once on click", async () => {
    invokeMock.mockResolvedValueOnce("/data/table-view/logs");
    render(<RevealLogsButton />);

    await act(async () => {
      screen.getByTestId("reveal-logs-button").click();
    });

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("open_log_dir");
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  // Error recovery — backend reject (no file explorer / IO) surfaces as
  // a toast
  // instead of a silent failure.
  it("surfaces backend reject as an error toast", async () => {
    invokeMock.mockRejectedValueOnce(new Error("no file explorer"));
    render(<RevealLogsButton />);

    await act(async () => {
      screen.getByTestId("reveal-logs-button").click();
    });

    await waitFor(() => {
      const ts = useToastStore.getState().toasts;
      expect(ts).toHaveLength(1);
      expect(ts[0]?.variant).toBe("error");
      expect(ts[0]?.message).toMatch(/no file explorer/);
    });
  });
});

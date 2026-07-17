/**
 * 작성 2026-07-17 (#1566 — Reveal Logs).
 *
 * 사유: 사용자 user flow path 의 마지막 outcome (버튼 클릭 → `open_log_dir`
 * IPC 1회 발사 → 실패 시 error toast) 까지 lock. backend wire shape 은
 * `src-tauri/src/commands/open_log_dir.rs` 단위 테스트가 책임.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import RevealLogsButton from "./RevealLogsButton";
import { useToastStore } from "@stores/toastStore";

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

  // 에러 복구 — backend reject (no file explorer / IO) surfaces as a toast
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

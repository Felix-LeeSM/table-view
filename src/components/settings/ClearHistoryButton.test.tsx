/**
 * 작성 2026-05-17 (Phase 5 sprint-372 / AC-372-04).
 *
 * 사유: clear_history 의 user flow path 마지막 outcome (toast 가
 * deletedCount 와 함께 뜨는가) 까지 lock. confirm 단계 + 응답 N rows
 * formatting + error path 3개를 검증한다. backend 의 wire shape 은
 * `src/lib/tauri/history.test.ts` 와 lego (invoke "clear_history" no req).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

import ClearHistoryButton from "./ClearHistoryButton";
import { useToastStore } from "@lib/toast";

describe("ClearHistoryButton (sprint-372)", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  // AC-372-04 — confirm → IPC → toast "N rows cleared".
  // 작성 2026-05-17. 사유: 사용자 단일 user flow path. confirm dialog
  // 를 통과한 뒤 IPC 1회 + toast 1개 (deletedCount 가 메시지에 들어감).
  it("[AC-372-04] confirm dialog → clear_history → toast with deletedCount", async () => {
    invokeMock.mockResolvedValueOnce({ deletedCount: 12 });
    render(<ClearHistoryButton />);

    // 트리거 → confirm dialog 열림
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

    // toast 1개 + deletedCount 가 메시지에 등장.
    await waitFor(() => {
      const ts = useToastStore.getState().toasts;
      expect(ts).toHaveLength(1);
      expect(ts[0]?.variant).toBe("success");
      expect(ts[0]?.message).toMatch(/12 rows cleared/);
    });
  });

  // 1 row → "1 row cleared" (singular). plural formatting 회귀 가드.
  // 작성 2026-05-17. 사유: 사용자에게 매끄러운 i18n-ish 표현.
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
  // 작성 2026-05-17. 사유: clear 가 실패해도 user 가 silent failure 가
  // 아니라 진단 메시지를 받는다.
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

  // confirm cancel → IPC 0회.
  // 작성 2026-05-17. 사유: 실수 클릭에 대한 escape path. backend 호출
  // 0 이 lock.
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

/**
 * 작성 2026-05-16 (Phase 1 sprint-356) — AC-356-05 / AC-356-06.
 *
 * Linux Secret Service / kwallet 미가용 환경에서 backend 가 `Path C` 로 떨어졌을 때
 * 사용자에게 한 번만 "디스크 암호화 권장" 안내 toast 를 띄우는 컴포넌트. Sentinel 은
 * file sidecar (`.keyring-fallback-dismissed`) — SQLite migration 전 단계라 SQLite
 * meta 미존재. 본 컴포넌트는 backend 와 통신해 `dismissed` 여부를 IPC 로 묻고
 * 사용자가 dismiss 했을 때 그 sentinel 을 set 한다.
 *
 * 시나리오:
 *   1. fallbackActive == false → toast 표시 0.
 *   2. fallbackActive == true + dismissed == false → 1회 toast, role="alert".
 *   3. 사용자 Dismiss 버튼 클릭 → sentinel 쓰기 호출 + toast 즉시 사라짐.
 *   4. dismissed == true (이전 boot 에서 set 됨) → toast 표시 0.
 *   5. dismiss IPC 실패해도 UI 는 hide (다음 boot 에서 재시도 — best-effort).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { KeyringFallbackToast } from "./KeyringFallbackToast";

// IPC mock — backend tauri invoke 는 vitest 환경에서 호출 불가.
const mockSetDismissed = vi.fn();

vi.mock("@/lib/keyringFallback", () => ({
  setKeyringFallbackDismissed: (...args: unknown[]) =>
    mockSetDismissed(...args),
}));

describe("KeyringFallbackToast (Q22 sprint-356)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetDismissed.mockResolvedValue(undefined);
  });

  it("renders nothing when fallback is not active (Path A/B success)", () => {
    render(<KeyringFallbackToast fallbackActive={false} dismissed={false} />);
    expect(
      screen.queryByRole("alert", { name: /keyring/i }),
    ).not.toBeInTheDocument();
    // No dismiss button either.
    expect(
      screen.queryByRole("button", { name: /dismiss/i }),
    ).not.toBeInTheDocument();
  });

  it("renders an alert when fallback is active and not yet dismissed (AC-356-05)", () => {
    render(<KeyringFallbackToast fallbackActive={true} dismissed={false} />);
    const alert = screen.getByRole("alert");
    expect(alert).toBeInTheDocument();
    expect(alert.textContent).toMatch(/encryption|disk|keyring|fallback/i);
  });

  it("renders nothing when sentinel marks the toast as already dismissed (AC-356-06)", () => {
    render(<KeyringFallbackToast fallbackActive={true} dismissed={true} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("invokes the IPC sentinel write and hides itself on Dismiss click (AC-356-06)", async () => {
    render(<KeyringFallbackToast fallbackActive={true} dismissed={false} />);
    const dismiss = screen.getByRole("button", { name: /dismiss/i });
    fireEvent.click(dismiss);
    await waitFor(() => expect(mockSetDismissed).toHaveBeenCalledTimes(1));
    expect(mockSetDismissed).toHaveBeenCalledWith();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("still hides the toast when the dismiss IPC rejects (best-effort)", async () => {
    mockSetDismissed.mockRejectedValueOnce(new Error("backend offline"));
    render(<KeyringFallbackToast fallbackActive={true} dismissed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    await waitFor(() => expect(mockSetDismissed).toHaveBeenCalled());
    // Hide regardless — next boot will pick up the same sentinel state and
    // retry the toast if the sidecar write failed.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

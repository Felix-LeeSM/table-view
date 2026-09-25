/**
 * Written 2026-05-16 — AC-356-05 / AC-356-06.
 *
 * The component shows the user a one-time notice recommending disk
 * encryption when the backend falls back to `Path C` because the Linux Secret
 * Service / kwallet is unavailable. The sentinel is a file sidecar
 * (`.keyring-fallback-dismissed`): this stage precedes the SQLite migration,
 * so the SQLite `meta` table is not there to use. The component takes
 * `dismissed` as a prop and sets that sentinel over IPC when the user
 * dismisses.
 *
 * Scenarios:
 *   1. fallbackActive == false → no toast.
 *   2. fallbackActive == true + dismissed == false → one toast, role="alert".
 *   3. The user clicks the Dismiss button → the sentinel write is called and
 *      the toast disappears immediately.
 *   4. dismissed == true (set on an earlier boot) → no toast.
 *   5. The UI hides even if the dismiss IPC fails (retried on the next boot —
 *      best-effort).
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KeyringFallbackToast } from "./KeyringFallbackToast";

// IPC mock — the backend tauri invoke cannot run in the vitest environment.
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

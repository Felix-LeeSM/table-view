// AC-359-08: wire-shape assertions for the `cancel.ts` wrapper + verifying
// the frontend parses the backend `CancelError` 3-bucket classification
// correctly.
//
// Also verifies `releaseTabConnection` calls the IPC
// `release_tab_connection` with the exact payload (the foundation of the
// tab unmount cleanup).

import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import {
  cancelQueryNative,
  parseCancelError,
  releaseTabConnection,
} from "./cancel";

describe("parseCancelError", () => {
  it("parses typed AppError::Cancel AlreadyCompleted envelope", () => {
    expect(
      parseCancelError({
        type: "Cancel",
        payload: { type: "AlreadyCompleted" },
      }),
    ).toEqual({ type: "AlreadyCompleted" });
  });

  it("parses typed AppError::Cancel PermissionDenied envelope", () => {
    expect(
      parseCancelError({
        type: "Cancel",
        payload: {
          type: "PermissionDenied",
          message: "role cannot kill",
        },
      }),
    ).toEqual({
      type: "PermissionDenied",
      message: "role cannot kill",
    });
  });

  it("parses typed AppError::Cancel NetworkError envelope", () => {
    expect(
      parseCancelError({
        type: "Cancel",
        payload: {
          type: "NetworkError",
          message: "broken pipe",
        },
      }),
    ).toEqual({
      type: "NetworkError",
      message: "broken pipe",
    });
  });

  it("parses JSON-string typed AppError::Cancel envelope defensively", () => {
    const raw =
      '{"type":"Cancel","payload":{"type":"NetworkError","message":"reset"}}';
    expect(parseCancelError(raw)).toEqual({
      type: "NetworkError",
      message: "reset",
    });
  });

  it("falls back to NetworkError on non-JSON error string", () => {
    // Plain-text error path — conservatively classified as NetworkError
    // so it surfaces to the user as a toast.
    expect(parseCancelError("plain string error")).toEqual({
      type: "NetworkError",
      message: "plain string error",
    });
  });

  it("does not parse Database error strings containing cancel-looking JSON", () => {
    const raw = 'Database error: {"type":"AlreadyCompleted"}';
    expect(parseCancelError(raw)).toEqual({
      type: "NetworkError",
      message: raw,
    });
  });

  it("does not parse AppError::Database JSON payload as a cancel class", () => {
    const raw = {
      type: "Database",
      payload: '{"type":"AlreadyCompleted"}',
    };
    expect(parseCancelError(raw)).toEqual({
      type: "NetworkError",
      message: '{"type":"AlreadyCompleted"}',
    });
  });

  it("handles non-string input by stringifying", () => {
    // Regression guard — stays safe even if invoke throws a non-string object.
    expect(parseCancelError({ toString: () => "obj-err" })).toEqual({
      type: "NetworkError",
      message: "obj-err",
    });
  });
});

describe("cancelQueryNative", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes the cancel_query_native IPC with camelCase payload", async () => {
    invokeMock.mockResolvedValueOnce(undefined);
    await cancelQueryNative("conn-1", 12345);
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("cancel_query_native", {
      connectionId: "conn-1",
      serverPid: 12345,
    });
  });

  it("rethrows the IPC error as a typed CancelError (AlreadyCompleted)", async () => {
    invokeMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "AlreadyCompleted" },
    });
    // The rejects matcher verifies the thrown value itself.
    await expect(cancelQueryNative("c", 1)).rejects.toEqual({
      type: "AlreadyCompleted",
    });
  });

  it("rethrows the IPC error as PermissionDenied", async () => {
    invokeMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "PermissionDenied", message: "forbidden" },
    });
    await expect(cancelQueryNative("c", 1)).rejects.toEqual({
      type: "PermissionDenied",
      message: "forbidden",
    });
  });

  it("rethrows the IPC error as NetworkError", async () => {
    invokeMock.mockRejectedValueOnce({
      type: "Cancel",
      payload: { type: "NetworkError", message: "reset" },
    });
    await expect(cancelQueryNative("c", 1)).rejects.toEqual({
      type: "NetworkError",
      message: "reset",
    });
  });
});

describe("releaseTabConnection", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("invokes release_tab_connection with camelCase payload and returns the boolean", async () => {
    // Backend returns true when the entry existed. Idempotency of the tab
    // unmount cleanup — a second call is a silent no-op returning false.
    invokeMock.mockResolvedValueOnce(true);
    const removed = await releaseTabConnection("conn-1", "tab-7");
    expect(removed).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("release_tab_connection", {
      connectionId: "conn-1",
      tabId: "tab-7",
    });
  });

  it("propagates the false-on-absent contract", async () => {
    invokeMock.mockResolvedValueOnce(false);
    const removed = await releaseTabConnection("conn-1", "tab-7");
    expect(removed).toBe(false);
  });

  it("forwards backend errors unchanged (validation, etc.)", async () => {
    // Validation failures such as an empty tab id surface as-is as a
    // backend Result::Err — the wrapper must not swallow them.
    invokeMock.mockRejectedValueOnce(
      "Validation error: Tab ID cannot be empty",
    );
    await expect(releaseTabConnection("c", "")).rejects.toEqual(
      "Validation error: Tab ID cannot be empty",
    );
  });
});

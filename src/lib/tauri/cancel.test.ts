// 작성 2026-05-16 (Phase 2 sprint-359) — AC-359-08:
// `cancel.ts` wrapper 의 wire-shape 단언 + frontend 가 backend
// `CancelError` 의 3-bucket 분류를 정확히 파싱한다.
//
// 추가로 `releaseTabConnection` 이 IPC `release_tab_connection` 을
// 정확한 payload 로 호출한다 (tab unmount cleanup 의 토대).

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
    // Plain-text 에러 path — 사용자에게 toast 로 보이도록 보수적
    // NetworkError 분류.
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
    // 회귀 가드 — invoke 가 객체를 throw 하는 path 가 있어도 안전.
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
    // expect.rejects matcher 는 thrown value 자체를 검증한다.
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
    // backend 가 entry 가 존재했으면 true 반환. tab unmount cleanup 의
    // 멱등성 — 두 번째 호출은 false 로 silent no-op.
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
    // empty tab id 같은 validation 실패는 backend Result::Err 로 그대로
    // surface — wrapper 가 swallow 하면 안 됨.
    invokeMock.mockRejectedValueOnce(
      "Validation error: Tab ID cannot be empty",
    );
    await expect(releaseTabConnection("c", "")).rejects.toEqual(
      "Validation error: Tab ID cannot be empty",
    );
  });
});

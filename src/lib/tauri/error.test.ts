import { describe, expect, it } from "vitest";
import {
  getDbMismatchInfo,
  getTauriErrorMessage,
  normalizeTauriError,
} from "./error";

describe("normalizeTauriError", () => {
  it("normalizes typed DbMismatch envelopes", () => {
    const raw = {
      type: "DbMismatch",
      message: "Database mismatch: expected 'db1', but found 'db2'",
      payload: { expected: "db1", actual: "db2" },
    };

    expect(normalizeTauriError(raw)).toMatchObject({
      type: "DbMismatch",
      message: "Database mismatch: expected 'db1', but found 'db2'",
      payload: { expected: "db1", actual: "db2" },
    });
    expect(getDbMismatchInfo(raw)).toEqual({ expected: "db1", actual: "db2" });
  });

  it("normalizes JSON-stringified DbMismatch envelopes", () => {
    const raw = JSON.stringify({
      type: "DbMismatch",
      payload: { expected: "db1", actual: "db2" },
    });

    expect(getTauriErrorMessage(raw)).toBe(
      "Database mismatch: expected 'db1', but found 'db2'",
    );
    expect(getDbMismatchInfo(raw)).toEqual({ expected: "db1", actual: "db2" });
  });

  it("keeps legacy Display-string DbMismatch compatibility", () => {
    const raw = "Database mismatch: expected 'db1', but found 'db2'";

    expect(getTauriErrorMessage(raw)).toBe(raw);
    expect(getDbMismatchInfo(raw)).toEqual({ expected: "db1", actual: "db2" });
  });

  it("does not leak the internal 'backend pool' term in DbMismatch messages", () => {
    // Regression guard for issue #1059 — the user-facing mismatch message
    // must not expose the internal architecture term.
    const raw = {
      type: "DbMismatch",
      payload: { expected: "db1", actual: "db2" },
    };
    const message = getTauriErrorMessage(raw);
    expect(message).not.toContain("backend pool");
  });

  it("normalizes Cancel envelopes without requiring a message field", () => {
    const raw = {
      type: "Cancel",
      payload: { type: "PermissionDenied", message: "role cannot kill" },
    };

    expect(normalizeTauriError(raw)).toMatchObject({
      type: "Cancel",
      message: "Cancel: permission denied (role cannot kill)",
    });
    expect(getDbMismatchInfo(raw)).toBeNull();
  });

  it("falls back to ordinary Error messages", () => {
    const err = new Error("Connection error: refused");

    expect(normalizeTauriError(err)).toMatchObject({
      type: "Unknown",
      message: "Connection error: refused",
    });
    expect(getDbMismatchInfo(err)).toBeNull();
  });

  it("falls back to ordinary strings", () => {
    expect(getTauriErrorMessage("plain failure")).toBe("plain failure");
  });

  it("falls back to a usable message for unknown objects", () => {
    expect(getTauriErrorMessage({ code: "E_FAIL" })).toBe('{"code":"E_FAIL"}');
  });
});

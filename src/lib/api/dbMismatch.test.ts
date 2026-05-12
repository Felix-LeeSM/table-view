// Sprint 267 (2026-05-12) — frontend 가 Sprint 266 backend 의 DbMismatch
// 메시지를 구조적으로 분간해 자동 sync (verifyActiveDb) flow 를 발동시킬 수
// 있도록 helper 추가. parseDbMismatch 는 단일 책임: 메시지 모양만 판별.
import { describe, it, expect } from "vitest";
import { parseDbMismatch } from "./dbMismatch";

describe("parseDbMismatch", () => {
  it("extracts expected and actual from Sprint 266 backend format", () => {
    const msg = "Database mismatch: expected 'db1', backend pool has 'db2'";
    expect(parseDbMismatch(msg)).toEqual({
      expected: "db1",
      actual: "db2",
    });
  });

  it("returns null for unrelated error messages", () => {
    expect(parseDbMismatch("syntax error at or near 'FORM'")).toBeNull();
    expect(parseDbMismatch("Connection error: refused")).toBeNull();
  });

  it("returns null for malformed mismatch shapes", () => {
    // expected 만 있고 actual 누락 → DbMismatch variant 가 아님.
    expect(parseDbMismatch("Database mismatch: expected 'db1'")).toBeNull();
  });
});

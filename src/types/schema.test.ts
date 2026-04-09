import { describe, it, expect } from "vitest";
import { validateRawSql } from "./schema";

describe("validateRawSql", () => {
  it("returns null for empty string", () => {
    expect(validateRawSql("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(validateRawSql("   ")).toBeNull();
  });

  it("returns null for a safe WHERE condition", () => {
    expect(validateRawSql("id = 13")).toBeNull();
  });

  it("returns null for a complex safe condition", () => {
    expect(validateRawSql("id = 13 AND name LIKE '%test%'")).toBeNull();
  });

  it("returns error when semicolon is present", () => {
    expect(validateRawSql("id = 1; DROP TABLE users")).toBe(
      "Raw WHERE clause must not contain semicolons",
    );
  });

  it("returns error for DROP keyword", () => {
    expect(validateRawSql("DROP TABLE users")).toBe(
      "Raw WHERE clause must not start with DROP",
    );
  });

  it("returns error for DELETE keyword", () => {
    expect(validateRawSql("DELETE FROM users")).toBe(
      "Raw WHERE clause must not start with DELETE",
    );
  });

  it("returns error for INSERT keyword", () => {
    expect(validateRawSql("INSERT INTO users VALUES (1)")).toBe(
      "Raw WHERE clause must not start with INSERT",
    );
  });

  it("returns error for UPDATE keyword", () => {
    expect(validateRawSql("UPDATE users SET name = 'x'")).toBe(
      "Raw WHERE clause must not start with UPDATE",
    );
  });

  it("returns error for ALTER keyword", () => {
    expect(validateRawSql("ALTER TABLE users ADD COLUMN x int")).toBe(
      "Raw WHERE clause must not start with ALTER",
    );
  });

  it("returns error for CREATE keyword", () => {
    expect(validateRawSql("CREATE TABLE evil (id int)")).toBe(
      "Raw WHERE clause must not start with CREATE",
    );
  });

  it("returns error for TRUNCATE keyword", () => {
    expect(validateRawSql("TRUNCATE TABLE users")).toBe(
      "Raw WHERE clause must not start with TRUNCATE",
    );
  });

  it("returns error for GRANT keyword", () => {
    expect(validateRawSql("GRANT ALL ON users TO public")).toBe(
      "Raw WHERE clause must not start with GRANT",
    );
  });

  it("returns error for REVOKE keyword", () => {
    expect(validateRawSql("REVOKE ALL ON users FROM public")).toBe(
      "Raw WHERE clause must not start with REVOKE",
    );
  });

  it("handles lowercase dangerous keywords", () => {
    expect(validateRawSql("drop table users")).toBe(
      "Raw WHERE clause must not start with DROP",
    );
  });

  it("handles mixed-case dangerous keywords", () => {
    expect(validateRawSql("DeLeTe FROM users")).toBe(
      "Raw WHERE clause must not start with DELETE",
    );
  });

  it("allows keywords in the middle of the clause", () => {
    // "id = 1 AND DROP" — starts with "id", not a dangerous keyword
    expect(validateRawSql("id = 1 AND DROP")).toBeNull();
  });

  it("semicolon check takes priority over dangerous keyword check", () => {
    // Has semicolon → semicolon error, not dangerous keyword error
    expect(validateRawSql("DROP TABLE users;")).toBe(
      "Raw WHERE clause must not contain semicolons",
    );
  });
});

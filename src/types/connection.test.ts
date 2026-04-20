import { describe, it, expect } from "vitest";
import {
  parseConnectionUrl,
  createEmptyDraft,
  DATABASE_DEFAULTS,
} from "./connection";

describe("parseConnectionUrl", () => {
  it("parses postgresql URL", () => {
    const result = parseConnectionUrl(
      "postgresql://admin:pass123@db.example.com:5432/mydb",
    );
    expect(result).toEqual({
      db_type: "postgresql",
      host: "db.example.com",
      port: 5432,
      user: "admin",
      password: "pass123",
      database: "mydb",
    });
  });

  it("parses postgres:// shorthand", () => {
    const result = parseConnectionUrl("postgres://user:pw@host/testdb");
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("postgresql");
  });

  it("parses mysql URL", () => {
    const result = parseConnectionUrl("mysql://root:secret@localhost:3306/app");
    expect(result).toEqual({
      db_type: "mysql",
      host: "localhost",
      port: 3306,
      user: "root",
      password: "secret",
      database: "app",
    });
  });

  it("uses default port when not specified", () => {
    const result = parseConnectionUrl("postgresql://user:pw@host/mydb");
    expect(result!.port).toBe(DATABASE_DEFAULTS.postgresql);
  });

  it("handles URL-encoded credentials", () => {
    const result = parseConnectionUrl(
      "postgresql://user%40domain:p%40ss%3Aw@host/db",
    );
    expect(result!.user).toBe("user@domain");
    expect(result!.password).toBe("p@ss:w");
  });

  it("returns null for unsupported protocol", () => {
    const result = parseConnectionUrl("http://example.com/path");
    expect(result).toBeNull();
  });

  it("returns null for invalid URL", () => {
    expect(parseConnectionUrl("")).toBeNull();
    expect(parseConnectionUrl("not-a-url")).toBeNull();
  });

  it("returns empty database for root path", () => {
    const result = parseConnectionUrl("postgresql://u:p@h/");
    expect(result!.database).toBe("");
  });
});

describe("createEmptyDraft", () => {
  it("returns default postgresql draft", () => {
    const conn = createEmptyDraft();
    expect(conn.db_type).toBe("postgresql");
    expect(conn.port).toBe(5432);
    expect(conn.host).toBe("localhost");
    expect(conn.id).toBe("");
    expect(conn.password).toBe("");
  });
});

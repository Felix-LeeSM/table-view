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
      paradigm: "rdb",
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
      paradigm: "rdb",
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

  it("populates paradigm as rdb for the default draft (Sprint 65)", () => {
    const conn = createEmptyDraft();
    expect(conn.paradigm).toBe("rdb");
  });
});

describe("parseConnectionUrl paradigm tagging (Sprint 65)", () => {
  it("tags mongodb URLs with the document paradigm", () => {
    const result = parseConnectionUrl(
      "mongodb://user:pass@localhost:27017/app",
    );
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("mongodb");
    expect(result!.paradigm).toBe("document");
  });

  it("tags redis URLs with the kv paradigm", () => {
    const result = parseConnectionUrl("redis://localhost:6379");
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("redis");
    expect(result!.paradigm).toBe("kv");
  });
});

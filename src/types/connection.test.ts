import { describe, it, expect } from "vitest";
import {
  parseConnectionUrl,
  parseSqliteFilePath,
  createEmptyDraft,
  DATABASE_DEFAULTS,
  DATABASE_DEFAULT_FIELDS,
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

// ---------------------------------------------------------------------------
// Sprint 138 — DBMS-aware defaults + SQLite path fallback
// ---------------------------------------------------------------------------
describe("DATABASE_DEFAULT_FIELDS (Sprint 138)", () => {
  it("PG defaults: port=5432, user=postgres, database=postgres", () => {
    expect(DATABASE_DEFAULT_FIELDS.postgresql).toEqual({
      port: 5432,
      user: "postgres",
      database: "postgres",
    });
  });

  it("MySQL defaults: port=3306, user=root, database=''", () => {
    expect(DATABASE_DEFAULT_FIELDS.mysql).toEqual({
      port: 3306,
      user: "root",
      database: "",
    });
  });

  it("SQLite defaults: port=0, user='', database=''", () => {
    expect(DATABASE_DEFAULT_FIELDS.sqlite).toEqual({
      port: 0,
      user: "",
      database: "",
    });
  });

  it("Mongo defaults: port=27017, user='', database=''", () => {
    expect(DATABASE_DEFAULT_FIELDS.mongodb).toEqual({
      port: 27017,
      user: "",
      database: "",
    });
  });

  it("Redis defaults: port=6379, user='', database='0'", () => {
    expect(DATABASE_DEFAULT_FIELDS.redis).toEqual({
      port: 6379,
      user: "",
      database: "0",
    });
  });

  it("only PG defaults user to 'postgres' (regression guard for #4)", () => {
    expect(DATABASE_DEFAULT_FIELDS.postgresql.user).toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mysql.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.sqlite.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mongodb.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.redis.user).not.toBe("postgres");
  });
});

describe("parseSqliteFilePath / sqlite URL fallback (Sprint 138)", () => {
  it("treats absolute paths as SQLite drafts", () => {
    const result = parseSqliteFilePath("/data/app.sqlite");
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("sqlite");
    expect(result!.database).toBe("/data/app.sqlite");
    expect(result!.host).toBe("");
    expect(result!.port).toBe(0);
    expect(result!.paradigm).toBe("rdb");
  });

  it("trims surrounding whitespace", () => {
    const result = parseSqliteFilePath("  /tmp/local.db   ");
    expect(result!.database).toBe("/tmp/local.db");
  });

  it("rejects empty / whitespace-only input", () => {
    expect(parseSqliteFilePath("")).toBeNull();
    expect(parseSqliteFilePath("   ")).toBeNull();
  });

  it("parseConnectionUrl accepts sqlite:/path URLs", () => {
    const result = parseConnectionUrl("sqlite:/data/app.sqlite");
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("sqlite");
    expect(result!.database).toBe("/data/app.sqlite");
  });
});

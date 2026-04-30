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
// Sprint 178 — Postel's Law scheme aliases (mongodb+srv, mariadb) + edge
// cases (encoded password regression, IPv6 host preservation, malformed
// URL → null contract). Each test names its AC + a date so future readers
// can trace the rationale (per feedback_test_documentation.md, 2026-04-28).
// ---------------------------------------------------------------------------
describe("parseConnectionUrl Sprint 178 scheme aliases + edge cases", () => {
  // AC-178-01 (parser leg) — Mongo SRV transport. Frontend preserves the
  // SRV cluster hostname as-is (the backend resolves SRV at connect time
  // per spec §C.4 / contract Edge Cases). Date 2026-04-30.
  it("parses mongodb+srv URL → db_type=mongodb, paradigm=document, default port", () => {
    const result = parseConnectionUrl(
      "mongodb+srv://user:secret@cluster.example.com/mydb",
    );
    expect(result).not.toBeNull();
    expect(result!.db_type).toBe("mongodb");
    expect(result!.paradigm).toBe("document");
    expect(result!.host).toBe("cluster.example.com");
    expect(result!.user).toBe("user");
    expect(result!.password).toBe("secret");
    expect(result!.database).toBe("mydb");
    // SRV URLs typically omit port; we fall back to the mongodb default.
    expect(result!.port).toBe(DATABASE_DEFAULTS.mongodb);
  });

  // AC-178-01 (parser leg) — MariaDB is wire-compatible with MySQL; the
  // alias maps it onto the existing MySQL adapter without introducing a
  // new `DatabaseType` variant. Date 2026-04-30.
  it("parses mariadb URL → db_type=mysql, paradigm=rdb, all fields populated", () => {
    const result = parseConnectionUrl("mariadb://root:pw@localhost:3306/app");
    expect(result).toEqual({
      db_type: "mysql",
      host: "localhost",
      port: 3306,
      user: "root",
      password: "pw",
      database: "app",
      paradigm: "rdb",
    });
  });

  // AC-178-01 (parser leg) — encoded password survives through the new
  // alias schemes (regression coverage for `decodeURIComponent`). Date
  // 2026-04-30.
  it("decodes URL-encoded password for mongodb+srv", () => {
    const result = parseConnectionUrl(
      "mongodb+srv://user:p%40ss%21word@cluster.example.com/db",
    );
    expect(result!.password).toBe("p@ss!word");
  });

  it("decodes URL-encoded password for mariadb", () => {
    const result = parseConnectionUrl("mariadb://root:my%23pw@host:3306/app");
    expect(result!.password).toBe("my#pw");
  });

  // AC-178-04 (parser leg) — malformed URL pastes return null so the UI
  // handler can leave the host field untouched without surfacing an
  // alert. Date 2026-04-30.
  it("returns null for postgres:// (empty host)", () => {
    expect(parseConnectionUrl("postgres://")).toBeNull();
  });

  it("returns null for mysql://@ (empty host with @)", () => {
    expect(parseConnectionUrl("mysql://@")).toBeNull();
  });

  it("returns null for mongodb+srv:// (empty host)", () => {
    expect(parseConnectionUrl("mongodb+srv://")).toBeNull();
  });

  it("returns null for mariadb://@/ (empty host with trailing slash)", () => {
    expect(parseConnectionUrl("mariadb://@/")).toBeNull();
  });

  // AC-178-03 (parser leg) — bracketed IPv6 in URL parses without
  // bracket-stripping; the WHATWG URL parser preserves `[::1]` in
  // `hostname`. Guards against future regressions if the parser is
  // refactored to manually strip brackets. Date 2026-04-30.
  it("preserves bracketed IPv6 hostname in postgres://[::1]:5432/db", () => {
    const result = parseConnectionUrl("postgres://[::1]:5432/db");
    expect(result).not.toBeNull();
    expect(result!.host).toBe("[::1]");
    expect(result!.port).toBe(5432);
    expect(result!.database).toBe("db");
  });

  // AC-178-01 (parser leg) — host:port-only inputs are NOT URLs; the
  // parser must reject them so the form-mode paste handler doesn't
  // mistakenly populate fields from a non-URL string. The host:port
  // shorthand is handled separately by the on-blur splitter. Date
  // 2026-04-30.
  it("returns null for host:port-only input (not a URL)", () => {
    expect(parseConnectionUrl("localhost:5432")).toBeNull();
  });

  // AC-178-01 (parser leg) — unrecognised scheme does not silently fall
  // through; same contract as the existing unsupported-protocol test.
  // Date 2026-04-30.
  it("returns null for unrecognised scheme like cockroachdb://", () => {
    expect(parseConnectionUrl("cockroachdb://u:p@h:26257/db")).toBeNull();
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

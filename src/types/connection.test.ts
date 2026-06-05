import { describe, it, expect } from "vitest";
import {
  parseConnectionUrl,
  parseSqliteFilePath,
  createEmptyDraft,
  isSupportedDatabaseType,
  DATABASE_DEFAULTS,
  DATABASE_DEFAULT_FIELDS,
  DATABASE_TYPE_LABELS,
  SUPPORTED_DATABASE_TYPES,
} from "./connection";

describe("parseConnectionUrl", () => {
  it("parses postgresql URL", () => {
    const result = parseConnectionUrl(
      "postgresql://admin:pass123@db.example.com:5432/mydb",
    );
    expect(result).toEqual({
      dbType: "postgresql",
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
    expect(result!.dbType).toBe("postgresql");
  });

  it("parses mysql URL", () => {
    const result = parseConnectionUrl("mysql://root:secret@localhost:3306/app");
    expect(result).toEqual({
      dbType: "mysql",
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
    expect(conn.dbType).toBe("postgresql");
    expect(conn.port).toBe(5432);
    expect(conn.host).toBe("localhost");
    expect(conn.id).toBe("");
    expect(conn.password).toBe("");
  });

  it("populates paradigm as rdb for the default draft (Sprint 65)", () => {
    const conn = createEmptyDraft();
    expect(conn.paradigm).toBe("rdb");
  });

  // Sprint 345 (2026-05-15) — createEmptyDraft 의 dbType 이 postgresql 이라
  // database 도 PG default ('postgres') 로 prefill. 사용자가 폼 열자마자
  // submit 해도 빈 database 가 backend 로 가지 않는다.
  it("prefills database with PG default for the initial postgresql draft", () => {
    const conn = createEmptyDraft();
    expect(conn.database).toBe("postgres");
  });
});

describe("parseConnectionUrl paradigm tagging (Sprint 65)", () => {
  it("tags mongodb URLs with the document paradigm", () => {
    const result = parseConnectionUrl(
      "mongodb://user:pass@localhost:27017/app",
    );
    expect(result).not.toBeNull();
    expect(result!.dbType).toBe("mongodb");
    expect(result!.paradigm).toBe("document");
  });

  it("tags redis URLs with the kv paradigm", () => {
    const result = parseConnectionUrl("redis://localhost:6379");
    expect(result).not.toBeNull();
    expect(result!.dbType).toBe("redis");
    expect(result!.paradigm).toBe("kv");
    expect(result!.database).toBe("0");
  });

  it("parses rediss URLs as Redis and preserves explicit database index", () => {
    const result = parseConnectionUrl(
      "rediss://user:pw@cache.example.com:6380/4",
    );
    expect(result).toEqual({
      dbType: "redis",
      host: "cache.example.com",
      port: 6380,
      user: "user",
      password: "pw",
      database: "4",
      tlsEnabled: true,
      paradigm: "kv",
    });
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
  it("parses mongodb+srv URL → dbType=mongodb, paradigm=document, default port", () => {
    const result = parseConnectionUrl(
      "mongodb+srv://user:secret@cluster.example.com/mydb",
    );
    expect(result).not.toBeNull();
    expect(result!.dbType).toBe("mongodb");
    expect(result!.paradigm).toBe("document");
    expect(result!.host).toBe("cluster.example.com");
    expect(result!.user).toBe("user");
    expect(result!.password).toBe("secret");
    expect(result!.database).toBe("mydb");
    // SRV URLs typically omit port; we fall back to the mongodb default.
    expect(result!.port).toBe(DATABASE_DEFAULTS.mongodb);
  });

  // AC-178-01 (parser leg) — MariaDB is wire-compatible with MySQL but
  // keeps a distinct DatabaseType so fixtures and UI labels stay DBMS-specific.
  it("parses mariadb URL → dbType=mariadb, paradigm=rdb, all fields populated", () => {
    const result = parseConnectionUrl("mariadb://root:pw@localhost:3306/app");
    expect(result).toEqual({
      dbType: "mariadb",
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

  it("recognizes mssql/sqlserver/sqlsrv URLs as unsupported typed drafts", () => {
    for (const scheme of ["mssql", "sqlserver", "sqlsrv"]) {
      const result = parseConnectionUrl(`${scheme}://sa:pw@host:1433/master`);
      expect(result).toMatchObject({
        dbType: "mssql",
        host: "host",
        port: 1433,
        user: "sa",
        database: "master",
        paradigm: "rdb",
      });
    }
  });

  it("recognizes oracle URLs as unsupported typed drafts", () => {
    const result = parseConnectionUrl(
      "oracle://system:pw@localhost:1521/FREEPDB1",
    );
    expect(result).toMatchObject({
      dbType: "oracle",
      host: "localhost",
      port: 1521,
      user: "system",
      database: "FREEPDB1",
      paradigm: "rdb",
    });
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

  // Sprint 345 (2026-05-15) — MySQL/Mongo database default 추가 (이전엔 ''
  // 였음). 빈 채로 connect 시 surprise UX 가 발생해 paradigm 별 system db
  // 로 prefill. 사용자가 수정 가능. ConnectionDialog 는 빈 submit 도 reject.
  it("MySQL defaults: port=3306, user=root, database='mysql'", () => {
    expect(DATABASE_DEFAULT_FIELDS.mysql).toEqual({
      port: 3306,
      user: "root",
      database: "mysql",
    });
  });

  it("MariaDB defaults mirror MySQL connection fields", () => {
    expect(DATABASE_DEFAULT_FIELDS.mariadb).toEqual({
      port: 3306,
      user: "root",
      database: "mysql",
    });
  });

  it("SQLite defaults: port=0, user='', database=''", () => {
    expect(DATABASE_DEFAULT_FIELDS.sqlite).toEqual({
      port: 0,
      user: "",
      database: "",
    });
  });

  it("DuckDB defaults: port=0, user='', database=''", () => {
    expect(DATABASE_DEFAULT_FIELDS.duckdb).toEqual({
      port: 0,
      user: "",
      database: "",
    });
  });

  it("MSSQL defaults: port=1433, user=sa, database=master", () => {
    expect(DATABASE_DEFAULT_FIELDS.mssql).toEqual({
      port: 1433,
      user: "sa",
      database: "master",
    });
  });

  it("Oracle defaults: port=1521, user=system, database=FREEPDB1", () => {
    expect(DATABASE_DEFAULT_FIELDS.oracle).toEqual({
      port: 1521,
      user: "system",
      database: "FREEPDB1",
    });
  });

  // Sprint 345 (2026-05-15) — Mongo default 가 'admin'. Mongo native 의
  // system db 라 어디든 항상 존재하고, DbSwitcher 가 runtime swap.
  it("Mongo defaults: port=27017, user='', database='admin'", () => {
    expect(DATABASE_DEFAULT_FIELDS.mongodb).toEqual({
      port: 27017,
      user: "",
      database: "admin",
    });
  });

  it("Redis defaults: port=6379, user='', database='0'", () => {
    expect(DATABASE_DEFAULT_FIELDS.redis).toEqual({
      port: 6379,
      user: "",
      database: "0",
    });
  });

  it("Valkey defaults: port=6379, user='', database='0'", () => {
    expect(DATABASE_DEFAULT_FIELDS.valkey).toEqual({
      port: 6379,
      user: "",
      database: "0",
    });
  });

  it("only PG defaults user to 'postgres' (regression guard for #4)", () => {
    expect(DATABASE_DEFAULT_FIELDS.postgresql.user).toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mysql.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mariadb.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.sqlite.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.duckdb.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mssql.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.mongodb.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.redis.user).not.toBe("postgres");
    expect(DATABASE_DEFAULT_FIELDS.valkey.user).not.toBe("postgres");
  });
});

// ---------------------------------------------------------------------------
// Sprint 276 / 281 — legacy connection 생성 allow-list. Current profile
// support source 는 `DATA_SOURCE_PROFILES` 이고, connection 생성 UI 노출은
// `capabilities.connection.test` 와 이 list 가 정렬되어야 한다.
// Date 2026-05-13.
// ---------------------------------------------------------------------------
describe("SUPPORTED_DATABASE_TYPES (Sprint 281)", () => {
  it("exposes runtime-backed connection types", () => {
    expect([...SUPPORTED_DATABASE_TYPES]).toEqual([
      "postgresql",
      "mysql",
      "mariadb",
      "sqlite",
      "duckdb",
      "mongodb",
      "redis",
      "valkey",
      "elasticsearch",
      "opensearch",
    ]);
  });

  it("isSupportedDatabaseType matches the SUPPORTED list", () => {
    expect(isSupportedDatabaseType("postgresql")).toBe(true);
    expect(isSupportedDatabaseType("mysql")).toBe(true);
    expect(isSupportedDatabaseType("mariadb")).toBe(true);
    expect(isSupportedDatabaseType("sqlite")).toBe(true);
    expect(isSupportedDatabaseType("duckdb")).toBe(true);
    expect(isSupportedDatabaseType("mongodb")).toBe(true);
    expect(isSupportedDatabaseType("redis")).toBe(true);
    expect(isSupportedDatabaseType("valkey")).toBe(true);
    expect(isSupportedDatabaseType("elasticsearch")).toBe(true);
    expect(isSupportedDatabaseType("opensearch")).toBe(true);
    expect(isSupportedDatabaseType("mssql")).toBe(false);
    expect(isSupportedDatabaseType("oracle")).toBe(false);
  });

  it("DATABASE_TYPE_LABELS covers every DatabaseType variant", () => {
    // 모든 variant 에 라벨이 있어야 한다 — unsupported 어댑터의 거부
    // 메시지에서도 사용되므로.
    expect(DATABASE_TYPE_LABELS.postgresql).toBe("PostgreSQL");
    expect(DATABASE_TYPE_LABELS.mysql).toBe("MySQL");
    expect(DATABASE_TYPE_LABELS.mariadb).toBe("MariaDB");
    expect(DATABASE_TYPE_LABELS.sqlite).toBe("SQLite");
    expect(DATABASE_TYPE_LABELS.duckdb).toBe("DuckDB");
    expect(DATABASE_TYPE_LABELS.mssql).toBe("Microsoft SQL Server");
    expect(DATABASE_TYPE_LABELS.oracle).toBe("Oracle");
    expect(DATABASE_TYPE_LABELS.mongodb).toBe("MongoDB");
    expect(DATABASE_TYPE_LABELS.redis).toBe("Redis");
    expect(DATABASE_TYPE_LABELS.valkey).toBe("Valkey");
    expect(DATABASE_TYPE_LABELS.elasticsearch).toBe("Elasticsearch");
    expect(DATABASE_TYPE_LABELS.opensearch).toBe("OpenSearch");
  });
});

describe("parseSqliteFilePath / sqlite URL fallback (Sprint 138)", () => {
  it("treats absolute paths as SQLite drafts", () => {
    const result = parseSqliteFilePath("/data/app.sqlite");
    expect(result).not.toBeNull();
    expect(result!.dbType).toBe("sqlite");
    expect(result!.database).toBe("/data/app.sqlite");
    expect(result!.host).toBe("");
    expect(result!.port).toBe(0);
    expect((result as { readOnly?: boolean }).readOnly).toBe(false);
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
    expect(result!.dbType).toBe("sqlite");
    expect(result!.database).toBe("/data/app.sqlite");
    expect((result as { readOnly?: boolean }).readOnly).toBe(false);
  });
});

describe("DuckDB file connection metadata (Sprint 455)", () => {
  it("declares DuckDB as a supported file-backed RDBMS identity", () => {
    expect(DATABASE_TYPE_LABELS.duckdb).toBe("DuckDB");
    expect(DATABASE_DEFAULTS.duckdb).toBe(0);
    expect(DATABASE_DEFAULT_FIELDS.duckdb).toEqual({
      port: 0,
      user: "",
      database: "",
    });
    expect(isSupportedDatabaseType("duckdb")).toBe(true);
  });

  it("parses duckdb:/ paths as file-backed RDB drafts with read-only defaulted off", () => {
    const result = parseConnectionUrl("duckdb:/data/analytics/lake.duckdb");

    expect(result).toMatchObject({
      dbType: "duckdb",
      host: "",
      port: 0,
      user: "",
      password: "",
      database: "/data/analytics/lake.duckdb",
      readOnly: false,
      paradigm: "rdb",
    });
  });
});

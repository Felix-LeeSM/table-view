import { describe, expect, it } from "vitest";

import {
  classifyDriverError,
  type DriverErrorCategory,
} from "./driverErrorHints";

// Purpose: lock the raw driver error → category mapping table and its
//          precedence (issue #1056) — GitHub milestone 22.30 (2026-07-03).
// Each needle is a raw string sampled from a real driver (pg/mysql/mssql/
// oracle/redis/mongo/ES + OS). The mapping lives in one place (a pure
// function) that the frontend paths reuse.
describe("classifyDriverError", () => {
  // Reason: absorb every DBMS's "connection refused" wording into one action
  //         hint (2026-07-03).
  const connectionRefused = [
    "Connection error: connection refused (os error 61)", // pg (macOS)
    "Connection error: Connection refused (os error 111)", // linux ECONNREFUSED
    "error communicating with the server: Connection refused (os error 61)", // sqlx mysql
    "IO error: Connection refused (os error 61)", // tiberius mssql
    "Connection refused", // redis client
    "No connection could be made because the target machine actively refused it", // windows
    "ECONNREFUSED 127.0.0.1:5432",
  ];

  // Reason: an auth failure must lead the user to check credentials — absorbs
  //         every DBMS dialect (2026-07-03).
  const authFailed = [
    'Connection error: password authentication failed for user "app"', // pg 28P01
    "Connection error: Access denied for user 'app'@'10.0.0.1' (using password: YES)", // mysql 1045
    "Login failed for user 'sa'.", // mssql 18456
    "ORA-01017: invalid username/password; logon denied", // oracle
    "WRONGPASS invalid username-password pair or user is disabled", // redis
    "NOAUTH Authentication required", // redis
    "Authentication failed.", // mongo code 18
    "Search authentication error: bad credentials", // AppError::SearchAuthentication
  ];

  // Reason: only connection-phase timeouts lead to network/firewall/
  //         reachability checks (2026-07-03). Query-phase timeouts (lock
  //         contention/statement/request) are not here — the negative case
  //         below forces null.
  const timeout = [
    "Connection error: connection timed out (os error 60)", // macOS ETIMEDOUT
    "Connection error: connection timed out (os error 110)", // linux ETIMEDOUT
    "Server selection timeout: No available servers", // mongo — connection phase (no server found)
  ];

  // Reason: an unresolved host leads to typo / DNS / VPN checks (2026-07-03).
  const unknownHost = [
    "Connection error: failed to lookup address information: nodename nor servname provided, or not known", // macOS getaddrinfo
    "Connection error: failed to lookup address information: Name or service not known", // linux getaddrinfo
    "Temporary failure in name resolution",
    "no such host",
    "could not resolve host: db.internal",
    "getaddrinfo ENOTFOUND db.internal",
  ];

  // Reason: permission denied means connected but lacking privileges for the
  //         operation — leads to DBA approval (2026-07-03).
  //         Shares its key with #1060 (dedicated permission-denied state).
  const permissionDenied = [
    'Database error: permission denied for table "users"', // pg 42501
    "Database error: SELECT command denied to user 'app'@'%' for table 'orders'", // mysql 1142
    "The SELECT permission was denied on the object 'orders'", // mssql
    "ORA-01031: insufficient privileges", // oracle
    "not authorized on admin to execute command", // mongo code 13
    "Search permission error: action indices:data/read is unauthorized", // AppError::SearchPermission
  ];

  // Reason: #1723 — raw errors where the describe that sqlx runs to read
  //         result metadata (column types) blows up because a proxy/pooler in
  //         front distorts it. They must not be mistaken for a problem in the
  //         user's SQL, so they are absorbed into a "could not read metadata +
  //         suspect a proxy" hint (2026-07-24).
  const introspectionFailed = [
    'Database error: error returned from database: Index was outside the bounds of the array.; query: "SELECT ... pg_catalog.pg_attribute ..." (sqlx_postgres::connection::describe:492)', // pg describe via proxy
    "Failed to describe statement (sqlx_sqlite::connection::describe:120)", // describe path of another sqlx driver
  ];

  const table: Array<[DriverErrorCategory, string[]]> = [
    ["connectionRefused", connectionRefused],
    ["authFailed", authFailed],
    ["timeout", timeout],
    ["unknownHost", unknownHost],
    ["permissionDenied", permissionDenied],
    ["introspectionFailed", introspectionFailed],
  ];

  for (const [category, samples] of table) {
    for (const sample of samples) {
      it(`classifies ${JSON.stringify(sample)} as ${category}`, () => {
        expect(classifyDriverError(sample)?.category).toBe(category);
      });
    }
  }

  // Reason: i18n keys derive from the category — errors namespace convention
  //         (#1074) (2026-07-03).
  it("derives errors-namespace i18n keys from the category", () => {
    const hint = classifyDriverError("connection refused (os error 61)");
    expect(hint).toEqual({
      category: "connectionRefused",
      titleKey: "errors:hint.connectionRefused.title",
      hintKey: "errors:hint.connectionRefused.hint",
    });
  });

  // Reason: matching is case-insensitive — drivers differ in casing
  //         (2026-07-03).
  it("matches case-insensitively", () => {
    expect(classifyDriverError("CONNECTION REFUSED")?.category).toBe(
      "connectionRefused",
    );
    expect(classifyDriverError("Access Denied For User 'x'")?.category).toBe(
      "authFailed",
    );
  });

  // Reason: precedence — mongo carries the root cause (refused) inside a
  //         timeout wrapper, as in "server selection timeout ... Connection
  //         refused". The refused hint is more actionable for the user and
  //         must win (2026-07-03).
  it("prefers connectionRefused over timeout when both appear (mongo wrapper)", () => {
    const msg =
      "Server selection timeout: No available servers. Topology Kind: Unknown, Error: Connection refused (os error 61)";
    expect(classifyDriverError(msg)?.category).toBe("connectionRefused");
  });

  // Reason: auth failure takes precedence over permission denied — mysql uses
  //         "denied" for both (2026-07-03).
  it("prefers authFailed over permissionDenied", () => {
    expect(
      classifyDriverError("Access denied for user 'app'@'%'")?.category,
    ).toBe("authFailed");
  });

  // Reason: a query-phase timeout must not be misclassified as a connection
  //         error — "check network/VPN/firewall" advice misleads for lock
  //         contention / statement / request timeouts (#1227 review,
  //         2026-07-03). With the bare "timeout"/"timed out" needles removed,
  //         only connection-phase markers match.
  it("does not classify query-phase timeouts as connection errors", () => {
    expect(
      classifyDriverError(
        "Lock wait timeout exceeded; try restarting transaction",
      ), // mysql lock contention
    ).toBeNull();
    expect(
      classifyDriverError("canceling statement due to statement timeout"), // pg statement_timeout
    ).toBeNull();
    expect(
      classifyDriverError("Search timeout error: request timed out"), // ES search request timeout
    ).toBeNull();
  });

  // Reason: classify on the index-OOB needle alone — both table samples carry
  //         a `connection::describe` frame, so nothing covered whether
  //         `index was outside the bounds of the array` alone, without a
  //         describe string, matches introspectionFailed. Locks the case where
  //         a proxy returns only the raw .NET IndexOutOfRangeException text,
  //         without a describe frame. Follow-up to issue #1723 (2026-07-24).
  it("classifies a bare index-OOB message (no connection::describe frame) as introspectionFailed", () => {
    const msg =
      'Database error: error returned from database: Index was outside the bounds of the array.; query: "SELECT id, name FROM users"';
    // Keep the condition standalone — with a describe frame mixed in, this
    // sample would no longer test the index needle.
    expect(msg.toLowerCase()).not.toContain("connection::describe");
    expect(classifyDriverError(msg)?.category).toBe("introspectionFailed");
  });

  // Reason: fail-open — leave unmapped raw text as it is (null) and do not
  //         force a classification (2026-07-03).
  it("returns null for unmatched messages (fail-open)", () => {
    expect(classifyDriverError('syntax error at or near "SELCT"')).toBeNull();
    expect(classifyDriverError('relation "foo" does not exist')).toBeNull();
    expect(classifyDriverError("")).toBeNull();
  });
});

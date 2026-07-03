import { describe, it, expect } from "vitest";

import {
  classifyDriverError,
  type DriverErrorCategory,
} from "./driverErrorHints";

// Purpose: driver 원문 에러 → 카테고리 매핑 표와 우선순위를 잠근다 (issue #1056)
//          — Phase 22 milestone 22.30 (2026-07-03).
// 각 needle 은 실제 드라이버(pg/mysql/mssql/oracle/redis/mongo/ES + OS)의
// 원문 문자열 표본이다. 매핑을 한 곳(순수 함수)에 두고 프론트 3경로가 재사용한다.
describe("classifyDriverError", () => {
  // Reason: 전 DBMS 의 "연결 거부" 표현을 하나의 행동 힌트로 흡수 (2026-07-03).
  const connectionRefused = [
    "Connection error: connection refused (os error 61)", // pg (macOS)
    "Connection error: Connection refused (os error 111)", // linux ECONNREFUSED
    "error communicating with the server: Connection refused (os error 61)", // sqlx mysql
    "IO error: Connection refused (os error 61)", // tiberius mssql
    "Connection refused", // redis client
    "No connection could be made because the target machine actively refused it", // windows
    "ECONNREFUSED 127.0.0.1:5432",
  ];

  // Reason: 인증 실패는 자격증명 확인을 유도해야 한다 — 전 DBMS 방언 흡수 (2026-07-03).
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

  // Reason: 타임아웃은 네트워크/방화벽/도달성 점검을 유도 (2026-07-03).
  const timeout = [
    "Connection error: connection timed out (os error 60)", // macOS ETIMEDOUT
    "Connection error: connection timed out (os error 110)", // linux ETIMEDOUT
    "Search timeout error: request timed out",
    "Server selection timeout: No available servers", // mongo (no refused inside)
    "operation timed out",
  ];

  // Reason: 호스트 미해석은 오타/ DNS/VPN 점검을 유도 (2026-07-03).
  const unknownHost = [
    "Connection error: failed to lookup address information: nodename nor servname provided, or not known", // macOS getaddrinfo
    "Connection error: failed to lookup address information: Name or service not known", // linux getaddrinfo
    "Temporary failure in name resolution",
    "no such host",
    "could not resolve host: db.internal",
    "getaddrinfo ENOTFOUND db.internal",
  ];

  // Reason: 권한 거부는 연결은 됐으나 작업 권한 부족 — DBA 승인 유도 (2026-07-03).
  //         #1060 (permission denied 전용 상태) 와 같은 키를 공유한다.
  const permissionDenied = [
    'Database error: permission denied for table "users"', // pg 42501
    "Database error: SELECT command denied to user 'app'@'%' for table 'orders'", // mysql 1142
    "The SELECT permission was denied on the object 'orders'", // mssql
    "ORA-01031: insufficient privileges", // oracle
    "not authorized on admin to execute command", // mongo code 13
    "Search permission error: action indices:data/read is unauthorized", // AppError::SearchPermission
  ];

  const table: Array<[DriverErrorCategory, string[]]> = [
    ["connectionRefused", connectionRefused],
    ["authFailed", authFailed],
    ["timeout", timeout],
    ["unknownHost", unknownHost],
    ["permissionDenied", permissionDenied],
  ];

  for (const [category, samples] of table) {
    for (const sample of samples) {
      it(`classifies ${JSON.stringify(sample)} as ${category}`, () => {
        expect(classifyDriverError(sample)?.category).toBe(category);
      });
    }
  }

  // Reason: i18n 키는 카테고리에서 파생 — errors namespace 규약 (#1074) (2026-07-03).
  it("derives errors-namespace i18n keys from the category", () => {
    const hint = classifyDriverError("connection refused (os error 61)");
    expect(hint).toEqual({
      category: "connectionRefused",
      titleKey: "errors:hint.connectionRefused.title",
      hintKey: "errors:hint.connectionRefused.hint",
    });
  });

  // Reason: 매칭은 대소문자 무관 — 드라이버마다 casing 이 다르다 (2026-07-03).
  it("matches case-insensitively", () => {
    expect(classifyDriverError("CONNECTION REFUSED")?.category).toBe(
      "connectionRefused",
    );
    expect(classifyDriverError("Access Denied For User 'x'")?.category).toBe(
      "authFailed",
    );
  });

  // Reason: 우선순위 — mongo 는 "server selection timeout ... Connection refused"
  //         처럼 timeout 래퍼 안에 root cause(refused)를 담는다. 사용자에게
  //         더 실행가능한 refused 힌트가 이겨야 한다 (2026-07-03).
  it("prefers connectionRefused over timeout when both appear (mongo wrapper)", () => {
    const msg =
      "Server selection timeout: No available servers. Topology Kind: Unknown, Error: Connection refused (os error 61)";
    expect(classifyDriverError(msg)?.category).toBe("connectionRefused");
  });

  // Reason: 인증 실패가 권한 거부보다 우선 — mysql 은 "denied" 를 둘 다 쓴다 (2026-07-03).
  it("prefers authFailed over permissionDenied", () => {
    expect(
      classifyDriverError("Access denied for user 'app'@'%'")?.category,
    ).toBe("authFailed");
  });

  // Reason: fail-open — 매핑 없는 원문은 그대로(null) 두고 억지 분류 금지 (2026-07-03).
  it("returns null for unmatched messages (fail-open)", () => {
    expect(classifyDriverError('syntax error at or near "SELCT"')).toBeNull();
    expect(classifyDriverError('relation "foo" does not exist')).toBeNull();
    expect(classifyDriverError("")).toBeNull();
  });
});

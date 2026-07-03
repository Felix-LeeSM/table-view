/**
 * Driver error hinting — 원문 드라이버 에러 문자열을 사람이 읽는 요약 + 행동
 * 힌트로 분류하는 순수 함수 레이어 (issue #1056).
 *
 * 왜 프론트 순수 함수인가:
 *   - 드라이버 문자열 패턴은 자주 추가/수정된다 (DBMS 추가·드라이버 버전업).
 *   - i18n (#1074) 과 에러 표면화가 프론트에서 만난다.
 *   - 백엔드는 원문 전달만 유지(변경 최소) — 진단 가치(원문)를 보존한다.
 *
 * 매핑은 여기 한 곳뿐이다. 연결·쿼리·search 3경로가 이 함수를 재사용한다.
 * 매칭 실패 시 `null` (fail-open) — 억지 분류하지 않고 원문을 그대로 보여준다.
 */

/**
 * 카테고리 SOT. union 과 (테스트의 exhaustiveness 순회에 쓰는) 목록이 한 배열에서
 * 파생된다 — 카테고리 추가 시 locale/테스트 누락이 강제로 드러난다.
 */
export const DRIVER_ERROR_CATEGORIES = [
  "connectionRefused",
  "authFailed",
  "timeout",
  "unknownHost",
  "permissionDenied",
] as const;

export type DriverErrorCategory = (typeof DRIVER_ERROR_CATEGORIES)[number];

export interface DriverErrorHint {
  category: DriverErrorCategory;
  /** i18n 키 — `errors:hint.<category>.title` (사람이 읽는 요약). */
  titleKey: string;
  /** i18n 키 — `errors:hint.<category>.hint` (행동 지침). */
  hintKey: string;
}

/**
 * 카테고리 → 원문 needle 목록. **배열 순서가 우선순위다** (먼저 매칭되면 이긴다).
 * needle 은 소문자, `includes` 부분일치.
 *
 * 우선순위 근거:
 *   - authFailed > permissionDenied: mysql 은 "denied" 를 둘 다 쓴다
 *     ("Access denied for user" 인증 vs "command denied to user" 권한).
 *   - connectionRefused > timeout: mongo 는 "Server selection timeout ...
 *     Error: Connection refused" 처럼 timeout 래퍼 안에 root cause(refused)를
 *     담는다 — 사용자에게 더 실행가능한 refused 힌트가 이겨야 한다.
 */
const PATTERNS: ReadonlyArray<
  readonly [DriverErrorCategory, readonly string[]]
> = [
  [
    "authFailed",
    [
      "password authentication failed", // pg 28P01
      "access denied for user", // mysql 1045
      "login failed for user", // mssql 18456
      "ora-01017", // oracle invalid username/password
      "invalid username/password", // oracle (code 미포함 변형)
      "wrongpass", // redis
      "noauth", // redis auth required
      "authentication required", // redis / generic
      "authentication failed", // mongo code 18 / generic
      "authentication error", // AppError::SearchAuthentication prefix
      "bad credentials", // ES / generic
    ],
  ],
  [
    "permissionDenied",
    [
      "permission denied", // pg 42501 "permission denied for ..."
      "command denied to user", // mysql 1142
      "permission was denied", // mssql "The SELECT permission was denied"
      "not authorized", // mongo code 13
      "insufficient privilege", // oracle text
      "ora-01031", // oracle insufficient privileges
      "permission error", // AppError::SearchPermission prefix
    ],
  ],
  [
    "unknownHost",
    [
      "failed to lookup address information", // rust std / sqlx
      "nodename nor servname", // macOS getaddrinfo
      "name or service not known", // linux getaddrinfo
      "name resolution", // "Temporary failure in name resolution"
      "no such host", // windows / generic
      "could not resolve host", // libcurl / generic
      "getaddrinfo", // node / generic ENOTFOUND
    ],
  ],
  [
    "connectionRefused",
    [
      "connection refused", // pg/mysql/mssql/redis/mongo (+ "(os error 61/111)")
      "actively refused", // windows
      "econnrefused", // node / generic
      // bare IO error. os error 코드는 플랫폼 의존이지만 메시지는 유저 머신에서
      // 생성돼 그 머신의 매핑을 따른다. 61=macOS ECONNREFUSED(linux 는 ENODATA),
      // 111=linux ECONNREFUSED — 교차 플랫폼 오탐 여지는 실무상 없음.
      "os error 61",
      "os error 111",
    ],
  ],
  [
    // 연결-phase 타임아웃만. bare "timeout"/"timed out" 는 쿼리-phase 타임아웃
    // (mysql Lock wait timeout / pg statement timeout / ES request timeout)까지
    // 물어 "네트워크 점검" 힌트로 오분류하므로 연결 단계 마커만 남긴다 (#1227).
    "timeout",
    [
      "connection timed out", // TCP connect ETIMEDOUT (보통 "(os error 60/110)" 동반)
      "server selection timeout", // mongo — 연결 단계(서버 못 찾음)
      // bare IO error. 60=macOS ETIMEDOUT, 110=linux ETIMEDOUT (플랫폼 의존,
      // 위 refused 주석과 동일 근거로 유저 머신 매핑을 따른다).
      "os error 60",
      "os error 110",
    ],
  ],
];

export function classifyDriverError(message: string): DriverErrorHint | null {
  const haystack = message.toLowerCase();
  for (const [category, needles] of PATTERNS) {
    if (needles.some((needle) => haystack.includes(needle))) {
      return {
        category,
        titleKey: `errors:hint.${category}.title`,
        hintKey: `errors:hint.${category}.hint`,
      };
    }
  }
  return null;
}

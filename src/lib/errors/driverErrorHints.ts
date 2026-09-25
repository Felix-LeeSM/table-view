/**
 * Driver error hinting — a pure-function layer that classifies raw driver
 * error strings into a human-readable summary plus an actionable
 * hint (issue #1056).
 *
 * Why a pure frontend function:
 *   - Driver string patterns are added/changed often (new DBMS, driver
 *     upgrades).
 *   - i18n (#1074) and error surfacing meet in the frontend.
 *   - The backend only forwards the raw string (minimal change) — preserving
 *     its diagnostic value.
 *
 * The mapping lives only here. The connection, query, and search paths all
 * reuse this function. On a match failure it returns `null` (fail-open) —
 * no forced classification; the raw string is shown as-is.
 */

/**
 * Category SOT. The union and the list (used by the exhaustiveness iteration
 * in tests) both derive from one array — adding a category forcibly exposes
 * missing locale/test entries.
 */
export const DRIVER_ERROR_CATEGORIES = [
  "connectionRefused",
  "authFailed",
  "timeout",
  "unknownHost",
  "permissionDenied",
  "introspectionFailed",
] as const;

export type DriverErrorCategory = (typeof DRIVER_ERROR_CATEGORIES)[number];

export interface DriverErrorHint {
  category: DriverErrorCategory;
  /** i18n key — `errors:hint.<category>.title` (human-readable summary). */
  titleKey: string;
  /** i18n key — `errors:hint.<category>.hint` (action guidance). */
  hintKey: string;
}

/**
 * Category → raw-text needle list. **Array order is the priority** (the first
 * match wins). Needles are lowercase, `includes` substring matches.
 *
 * Priority rationale:
 *   - authFailed > permissionDenied: mysql uses "denied" for both
 *     ("Access denied for user" = auth vs "command denied to user" =
 *     permission).
 *   - connectionRefused > timeout: mongo wraps the root cause (refused)
 *     inside a timeout wrapper, as in "Server selection timeout ...
 *     Error: Connection refused" — the more actionable refused hint must
 *     win for the user.
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
      "invalid username/password", // oracle (variant without a code)
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
      // bare IO error. The os error code is platform-dependent, but the
      // message is produced on the user's machine and follows that machine's
      // mapping. 61=macOS ECONNREFUSED (linux is ENODATA),
      // 111=linux ECONNREFUSED — no realistic cross-platform false positive.
      "os error 61",
      "os error 111",
    ],
  ],
  [
    // Connect-phase timeouts only. bare "timeout"/"timed out" would also
    // catch query-phase timeouts (mysql Lock wait timeout / pg statement
    // timeout / ES request timeout) and misclassify them as a "check the
    // network" hint, so only connect-stage markers stay (#1227).
    "timeout",
    [
      "connection timed out", // TCP connect ETIMEDOUT (usually with "(os error 60/110)")
      "server selection timeout", // mongo — connect stage (server not found)
      // bare IO error. 60=macOS ETIMEDOUT, 110=linux ETIMEDOUT (platform-
      // dependent; same rationale as the refused comment above — follows the
      // user machine's mapping).
      "os error 60",
      "os error 110",
    ],
  ],
  [
    // describe/introspection failure (#1723). sqlx runs an extended-protocol
    // describe to read result column metadata (types, etc.); when an
    // upstream proxy/pooler (pgbouncer etc.) mangles that describe response,
    // it blows up inside sqlx (`connection::describe`) — a connection/proxy
    // layer problem, not a user SQL problem. Absorb it into a "could not
    // read metadata + suspect the proxy" hint instead of the raw text. Least
    // specific, so lowest priority — if connection/auth/permission markers
    // are present too, those win.
    "introspectionFailed",
    [
      "connection::describe", // sqlx describe path: `sqlx_postgres::connection::describe:492`
      "index was outside the bounds of the array", // proxy mangled the describe response
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

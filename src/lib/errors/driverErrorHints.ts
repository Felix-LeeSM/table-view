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

export type DriverErrorCategory =
  | "connectionRefused"
  | "authFailed"
  | "timeout"
  | "unknownHost"
  | "permissionDenied";

export interface DriverErrorHint {
  category: DriverErrorCategory;
  /** i18n 키 — `errors:hint.<category>.title` (사람이 읽는 요약). */
  titleKey: string;
  /** i18n 키 — `errors:hint.<category>.hint` (행동 지침). */
  hintKey: string;
}

/**
 * 카테고리 → 원문 needle 목록. **순서가 우선순위다** (먼저 매칭되면 이긴다).
 * needle 은 소문자, `includes` 부분일치. GREEN 커밋에서 채운다.
 */
const PATTERNS: ReadonlyArray<
  readonly [DriverErrorCategory, readonly string[]]
> = [];

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

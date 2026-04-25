# Sprint 113: 36 테마 자동 WCAG AA 대비 검증 스크립트 (#A11Y-4)

**Source**: `docs/ui-evaluation-results.md` #A11Y-4
**Depends on**: —
**Verification Profile**: command

## Goal

36 테마 × 주요 색 조합에 대해 WCAG AA 4.5:1 대비 비율을 자동 검증하는 CI 스크립트를 도입해 테마 추가/변경 시 회귀를 즉시 가시화한다.

## Acceptance Criteria

1. `scripts/check-theme-contrast.ts` (또는 등가) 가 36 테마 × 주요 색 조합에 대해 AA 4.5:1 비율을 검증해 미달 시 exit code 1.
2. `pnpm test` 또는 `pnpm ci` 흐름에 위 스크립트가 포함된다.
3. 미달 케이스 발생 시 어떤 테마/조합이 미달인지 명확히 출력된다.
4. 신규 테마 추가 시 자동으로 검증 대상에 포함된다 (테마 메타에서 동적으로 수집).

## Components to Create/Modify

- `scripts/check-theme-contrast.ts` (신규).
- `package.json`: 스크립트 명령 등록.
- CI 설정: 스크립트 실행 단계 추가.

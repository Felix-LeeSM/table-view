# Sprint 112: native select → Select 정규화 (#DS-2)

**Source**: `docs/ui-evaluation-results.md` #DS-2
**Depends on**: —
**Verification Profile**: mixed

## Goal

코드베이스의 native `<select>` 사용처를 모두 design system `Select` 컴포넌트로 정규화해 시각/접근성 일관성을 확보한다.

## Acceptance Criteria

1. 코드베이스의 native `<select>` 모두 `Select` 컴포넌트로 정규화된다.
2. eslint 또는 grep 단언으로 신규 native `<select>` 도입을 막는 가드가 추가된다 (lint rule 또는 CI 체크).
3. 모든 정규화된 위치의 옵션 선택 동작이 회귀 없이 유지된다.
4. 키보드 네비게이션과 ARIA 속성이 `Select` 컴포넌트의 기본 동작으로 일관 적용된다.

## Components to Create/Modify

- 그 외 native select 사용처 전수: `Select` 로 교체.
- lint rule 또는 CI 스크립트: native select 도입 차단.
- 관련 테스트.

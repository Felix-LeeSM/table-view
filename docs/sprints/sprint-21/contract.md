# Sprint Contract: Sprint 21

## Summary

- Goal: 스키마 트리에 테이블 검색/필터 입력 추가
- Owner: Orchestrator
- Verification Profile: `mixed` (command + E2E)

## In Scope

- 스키마 확장 시 테이블 목록 상단에 검색 입력 표시
- 입력 시 대소문자 구분 없이 테이블 이름 필터링
- Clear 버튼(X)으로 필터 초기화
- 빈 결과 시 "No matching tables" 메시지
- E2E 테스트 작성

## Out of Scope

- 컨텍스트 메뉴, 편집 기능
- Views/Functions/Procedures 검색 (데이터가 없으므로)

## Invariants

- 414 기존 테스트 통과
- 기존 SchemaTree 동작 유지
- 다크/라이트 테마 지원

## Acceptance Criteria

- `AC-01`: 스키마 확장 시 Tables 카테고리 아래에 검색 입력이 표시됨
- `AC-02`: 입력 시 테이블 이름이 대소문자 구분 없이 필터링됨
- `AC-03`: 검색 입력에 Clear 버튼(X)이 있고 클릭 시 필터 초기화
- `AC-04`: 매칭 결과가 없으면 "No matching tables" 메시지 표시

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트
4. E2E 테스트 파일에 검색 관련 테스트 추가

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes

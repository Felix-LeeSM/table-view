# Sprint Contract: sprint-43

## Summary

- Goal: 임시 탭(Preview Tab) 시스템을 사용자 기대에 맞게 재구현
- Audience: Generator → Evaluator
- Owner: harness
- Verification Profile: `mixed`

## In Scope

- 임시 탭에서 정식 탭으로 자동 승격 트리거 재설정
- 탭 바에서 임시 탭 더블클릭으로 수동 승격
- 임시 탭 교체 로직 검증

## Out of Scope

- 데이터 그리드 UX 개선 (Sprint 44)
- 단축키 추가 (Sprint 45)
- 쿼리 에디터 수정 (Sprint 41 완료)
- UUID 표시 수정 (Sprint 42 완료)

## Invariants

- 정식 탭은 다른 테이블 클릭 시 유지됨
- 이미 열린 테이블 재클릭 시 해당 탭 활성화
- 기존 테스트 모두 통과
- 쿼리 탭은 preview 시스템의 영향을 받지 않음

## Acceptance Criteria

- `AC-01`: 테이블 클릭 시 임시 탭으로 열림 (이탤릭체 + opacity-70)
- `AC-02`: 임시 탭에서 정렬, 필터, 페이지 변경 시 자동 승격 (isPreview → false)
- `AC-03`: 임시 탭에서 인라인 편집 진입(셀 더블클릭) 시 자동 승격
- `AC-04`: 임시 탭에서 행 추가/삭제 버튼 클릭 시 자동 승격
- `AC-05`: 탭 바에서 임시 탭 더블클릭 시 수동 승격
- `AC-06`: 스크롤만 하는 경우 임시 탭 유지 (승격되지 않음)
- `AC-07`: 다른 테이블 클릭 시 기존 임시 탭이 교체됨
- `AC-08`: 정식 탭은 다른 테이블 클릭 시 유지되며 새 임시 탭이 추가로 열림

## Design Bar / Quality Bar

- 기존 코드 패턴 준수
- 각 AC에 대응하는 테스트 작성

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 전체 테스트 통과
2. `pnpm tsc --noEmit` — 타입 에러 0건
3. `pnpm lint` — ESLint 에러 0건

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목에 대응하는 테스트
- tabStore, DataGrid, TabBar 관련 테스트

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`

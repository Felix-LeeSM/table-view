# Sprint Contract: Sprint 52

## Summary

- Goal: Duplicate Row 툴바 버튼 추가 및 Column Drag Reorder 구현
- Audience: Generator, Evaluator
- Owner: harness
- Verification Profile: `command`

## In Scope

- DataGridToolbar에 Duplicate Row 버튼 추가 (선택 행이 있을 때 활성화)
- 컬럼 헤더 드래그 앤 드롭으로 컬럼 순서 변경 (시각적 전용)
- 드래그 중 시각적 피드백 (opacity, 드롭 인디케이터)
- 정렬, 필터, 인라인 편집과 reordered columns 호환
- 페이지 전환/새로고침 시 기본 순서로 초기화

## Out of Scope

- BLOB viewer (Sprint 53)
- SQL Uglify / Format selection (Sprint 53)
- Schema tree visuals (Sprint 54)
- 실제 DB 스키마 ALTER (순서 변경은 뷰 전용)

## Invariants

- 기존 768개 테스트 통과
- selectedRowIds / handleSelectRow / handleDuplicateRow 인터페이스 변경 없음
- Rust 백엔드 변경 없음

## Acceptance Criteria

- AC-01: DataGridToolbar에 Duplicate Row 버튼이 표시된다 (선택 행이 있을 때 활성화)
- AC-02: Duplicate Row 버튼 클릭 시 handleDuplicateRow가 호출된다
- AC-03: 컬럼 헤더를 드래그하면 컬럼 순서가 시각적으로 변경된다
- AC-04: 드래그 중인 컬럼 헤더에 opacity 감소 효과가 적용된다
- AC-05: 드롭 위치에 수직선 인디케이터가 표시된다
- AC-06: 재정렬된 컬럼 순서에서 정렬 클릭이 올바른 컬럼을 정렬한다
- AC-07: 재정렬된 컬럼 순서에서 인라인 편집이 올바른 컬럼에 UPDATE를 적용한다
- AC-08: 페이지 전환 또는 테이블 변경 시 컬럼 순서가 기본(스키마 순서)으로 초기화된다
- AC-09: 단위 테스트가 컬럼 드래그 reorder 로직을 커버한다

## Verification Plan

### Required Checks
1. `pnpm tsc --noEmit`
2. `pnpm vitest run`
3. `pnpm lint`
4. `pnpm build`

## Exit Criteria
- Open P1/P2 findings: 0
- Required checks passing: yes

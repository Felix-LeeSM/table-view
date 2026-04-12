# Sprint Contract: Sprint 24

## Summary

- Goal: Structure 패널 Indexes/Constraints 탭에 인덱스 생성/삭제, 제약조건 추가/삭제 UI + SQL 미리보기
- Owner: Orchestrator
- Verification Profile: `mixed`

## In Scope

- Indexes 탭에 "Create Index" 버튼
- Create Index 폼: index_name, columns (다중 선택), index_type, is_unique
- 인덱스 행에 hover 시 삭제(휴지통) 아이콘
- 삭제 시 DROP INDEX SQL 미리보기 확인 모달
- Constraints 탭에 "Add Constraint" 버튼
- Add Constraint 폼: constraint_name, type (PK/FK/Unique/Check), type별 필드
  - PK/Unique: columns
  - FK: columns, reference_table, reference_columns
  - Check: expression
- 제약조건 행에 hover 시 삭제(휴지통) 아이콘
- 삭제 시 DROP CONSTRAINT SQL 미리보기 확인 모달
- 백엔드 IPC 래퍼 (createIndex, dropIndex, addConstraint, dropConstraint) 이미 존재

## Out of Scope

- 컬럼 편집 UI (Sprint 23 완료)
- DataGrid 인라인 셀 편집 (Sprint 25+)
- 인덱스 수정 (rename 등) — 삭제 후 재생성 워크플로우로 충분

## Invariants

- 450 프론트엔드 테스트 + 145 Rust 테스트 통과
- 기존 StructurePanel 동작 유지 (Columns 탭 편집 기능)
- 다크/라이트 테마
- pnpm lint, tsc --noEmit, cargo fmt/clippy 통과

## Acceptance Criteria

- `AC-01`: Indexes 탭에 "Create Index" 버튼이 표시됨
- `AC-02`: "Create Index" 클릭 시 인덱스 생성 폼 모달이 열림 (name, columns, type, unique)
- `AC-03`: 폼 제출 시 `preview_only: true`로 SQL 미리보기 후 확인 시 실행
- `AC-04`: 각 인덱스 행 hover 시 삭제 아이콘 표시, 클릭 시 삭제 확인 모달
- `AC-05`: Constraints 탭에 "Add Constraint" 버튼이 표시됨
- `AC-06`: "Add Constraint" 클릭 시 제약조건 추가 폼 모달 (type별 동적 필드)
- `AC-07`: 폼 제출 시 SQL 미리보기 후 확인 시 실행
- `AC-08`: 각 제약조건 행 hover 시 삭제 아이콘 표시, 클릭 시 삭제 확인 모달

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트

# Sprint Contract: Sprint 23

## Summary

- Goal: Structure 패널에서 컬럼 추가/편집/삭제 UI + SQL 미리보기(코드 리뷰) 기능
- Owner: Orchestrator
- Verification Profile: `mixed`

## In Scope

- Structure 패널 Columns 탭에 "Add Column" 버튼
- 컬럼 행에 hover 시 편집/삭제 아이콘 버튼
- 편집 시 컬럼 필드(name, type, nullable, default) 인라인 편집 가능
- 변경 사항 "pending" 추적 + "Review SQL" 버튼
- Review SQL 모달에서 ALTER TABLE SQL 미리보기
- 확인 시 SQL 실행 후 컬럼 목록 새로고침

## Out of Scope

- 인덱스 생성/삭제 UI (Sprint 24)
- 제약조건 추가/삭제 UI (Sprint 24)
- DataGrid 인라인 셀 편집 (Sprint 25+)

## Invariants

- 424 프론트엔드 테스트 + 145 Rust 테스트 통과
- 기존 StructurePanel 동작 유지 (컬럼/인덱스/제약조건 탭)
- 다크/라이트 테마
- pnpm lint, tsc --noEmit, cargo fmt/clippy 통과

## Acceptance Criteria

- `AC-01`: "Add Column" 버튼이 Structure Columns 탭에 표시되고 클릭 시 편집 가능한 빈 행 추가
- `AC-02`: 각 컬럼 행에 hover 시 편집(연필) 및 삭제(휴지통) 아이콘 표시
- `AC-03`: 편집 아이콘 클릭 시 name/type/nullable/default 필드가 인라인 편집 가능해짐
- `AC-04`: 변경 사항이 "pending"으로 추적되고 "Review SQL (N)" 버튼이 툴바에 표시됨
- `AC-05`: "Review SQL" 클릭 시 모달에서 생성된 ALTER TABLE SQL 미리보기
- `AC-06`: 확인 시 SQL 실행 후 컬럼 목록 새로고침, 취소 시 pending 초기화

## Verification Plan

1. `pnpm vitest run` — 모든 테스트 통과
2. `pnpm tsc --noEmit` — 타입 체크
3. `pnpm lint` — 린트
4. E2E 테스트에 컬럼 편집 관련 테스트 추가

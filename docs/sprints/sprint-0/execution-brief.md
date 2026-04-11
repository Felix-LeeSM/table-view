# Sprint Execution Brief: sprint-0

## Objective

DataGrid 컴포넌트의 단일 컬럼 정렬 기능을 다중 컬럼 정렬로 확장합니다. 사용자는 Click으로 단일 정렬을 수행하거나 Shift+Click으로 여러 컬럼을 동시에 정렬할 수 있습니다.

## Task Why

이것은 Phase 2(스키마 탐색)의 마지막 남은 항목입니다. PLAN.md에 따르면 Phase 2는 "다중 컬럼 정렬 지원"이 완료되어야 done 상태가 됩니다. 이 Sprint가 완료되면 Phase 3(Query Editor)로 진행할 수 있습니다.

## Scope Boundary

- **IN**: DataGrid.tsx의 정렬 상태/핸들러/렌더링, postgres.rs의 ORDER BY 파싱, 관련 테스트
- **OUT**: Query Editor 관련 기능 (Sprint 1+), 새로운 Tauri 명령 (기존 `query_table_data` 사용)

## Invariants

1. Click 동작은 기존과 동일해야 함 (ASC → DESC → none 사이클)
2. 페이지네이션/필터와 정렬이 동시에 작동해야 함
3. 모든 기존 테스트 통과 (회귀 없음)
4. TypeScript strict mode, Rust clippy 준수

## Done Criteria

1. Click으로 컬럼 헤더 클릭 시 기존 정렬 초기화 후 해당 컬럼 ASC → DESC → none 사이클
2. Shift+Click으로 컬럼 추가 (ASC) → 방향 토글 (DESC) → 제거
3. 정렬된 헤더에 화살표(↑/↓)와 순위 번호(1, 2, 3...) 표시
4. `queryTableData`에 `"col1 ASC, col2 DESC"` 형태 전달
5. Rust 백엔드가 콤마 분리 ORDER BY 올바르게 파싱 및 적용

## Verification Plan

- Profile: `browser`
- Required checks:
  1. `pnpm test` — 프론트엔드 테스트 통과
  2. `cargo test` — 백엔드 테스트 통과
  3. `cargo fmt --check` — 포맷 검증
  4. `cargo clippy --all-targets --all-features -- -D warnings` — 린트 통과
  5. `pnpm build` — 빌드 성공
- Required evidence:
  - DataGrid.test.tsx에서 새로운 다중 정렬 테스트 통과 로그
  - schema_integration.rs에서 다중 컬럼 ORDER BY 테스트 통과 로그
  - 실행 중인 앱에서 다중 정렬 동작 스크린샷 또는 설명

## Evidence To Return

- Changed files with purpose:
  - 각 파일이 왜 변경되었는지 설명
- Checks run and outcomes:
  - 실행한 테스트 명령어와 결과 (pass/fail, 커버리지)
- Done criteria coverage with evidence:
  - AC-01~AC-05 각각을 만족한다는 구체적 증거
- Assumptions made during implementation:
  - 구현 중 가정한 사항 명시
- Residual risk or verification gaps:
  - 검증되지 않은 부분이나 잠재적 리스크

## References

- Contract: `docs/sprints/sprint-0/contract.md`
- Findings: (Evaluator가 작성할 예정)
- Relevant files:
  - `/home/felix/study/table-view/src/components/DataGrid.tsx`
  - `/home/felix/study/table-view/src-tauri/src/db/postgres.rs` (335-352줄)
  - `/home/felix/study/table-view/src/types/schema.ts`

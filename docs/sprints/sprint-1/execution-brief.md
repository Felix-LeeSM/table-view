# Sprint Execution Brief: sprint-1

## Objective

임의 SQL을 실행하고 결과를 반환하는 Tauri 명령(`execute_query`)과 실행 중인 쿼리를 중단하는 명령(`cancel_query`)을 구현합니다. 이는 Phase 3(Query Editor)의 백엔드 기반입니다.

## Task Why

Query Editor 기능을 위해서는 테이블 브라우저(`query_table_data`)와 달리 임의 SQL을 실행할 수 있는 백엔드 명령이 필요합니다. 또한 장시간 실행되는 쿼리를 중단할 수 있는 취소 메커니즘도 필요합니다.

## Scope Boundary

- **IN**: Backend Tauri 명령, Rust 모델, 쿼리 실행/취소 로직, PostgreSQL 어댑터 메서드
- **OUT**: Frontend UI (Sprint 2), CodeMirror (Sprint 2), 다중 탭 상태 (Sprint 3)

## Invariants

1. 기존 `query_table_data` 명령 동작 유지 (회귀 없음)
2. Pool 락 패턴: 쿼리 실행 중 전체 pool을 락하지 않음 (pool clone 후 락 해제)
3. 모든 에러가 `AppError::Database`로 반환
4. `tokio_util::sync::CancellationToken` 사용
5. `cargo fmt`, `cargo clippy` 준수

## Done Criteria

1. `execute_query` 명령이 SELECT 쿼리를 실행하고 컬럼/행/시간 반환
2. `execute_query` 명령이 DML을 실행하고 rows_affected 반환
3. `execute_query` 명령이 DDL을 실행하고 성공 메시지 반환
4. `cancel_query` 명령이 실행 중인 쿼리 중단
5. 에러가 `AppError::Database`로 반환
6. 실행 시간(ms)이 항상 반환

## Verification Plan

- Profile: `api`
- Required checks:
  1. `cargo test` — 백엔드 테스트 통과
  2. `cargo fmt --check` — 포맷 검증
  3. `cargo clippy --all-targets --all-features -- -D warnings` — 린트 통과
  4. `cargo check` — 컴파일 체크
- Required evidence:
  - query_integration.rs에서 SELECT/DML/DDL/취소 테스트 통과 로그
  - 새 모델의 Serialize/Deserialize 동작 확인

## Evidence To Return

- Changed files with purpose:
  - 각 파일이 왜 변경되었는지 설명
- Checks run and outcomes:
  - 실행한 테스트 명령어와 결과
- Done criteria coverage with evidence:
  - AC-01~AC-06 각각을 만족한다는 구체적 증거
- Assumptions made during implementation:
  - 구현 중 가정한 사항
- Residual risk or verification gaps:
  - 검증되지 않은 부분이나 잠재적 리스크

## References

- Contract: `docs/sprints/sprint-1/contract.md`
- Findings: (Evaluator가 작성할 예정)
- Relevant files:
  - `/home/felix/study/table-view/src-tauri/src/db/postgres.rs`
  - `/home/felix/study/table-view/src-tauri/src/commands/connection.rs`
  - `/home/felix/study/table-view/src-tauri/src/lib.rs`

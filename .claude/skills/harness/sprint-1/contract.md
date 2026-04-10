# Sprint Contract: sprint-1

## Summary

- Goal: Backend 쿼리 실행 명령(`execute_query`, `cancel_query`) 구현 + 쿼리 취소 지원
- Audience: Generator (제작자), Evaluator (평가자)
- Owner: Harness Orchestrator
- Verification Profile: `api`

## In Scope

- 새 Tauri 명령 `execute_query(connectionId, sql, queryId)`:
  - 임의 SQL 실행 (SELECT, DML, DDL)
  - 동적 컬럼 메타데이터 반환 (name, type)
  - 행 데이터를 JSON으로 반환
  - 실행 시간 측정 및 반환
  - 쿼리 타입 감지 (Select/Dml/Ddl)
- 새 Tauri 명령 `cancel_query(queryId)`:
  - 실행 중인 쿼리 중단
  - CancellationToken 사용
- 새 모델: `QueryResult`, `QueryColumn`, `QueryType`
- `AppState` 확장: `query_tokens: Mutex<HashMap<String, CancellationToken>>`
- `tokio-util` 의존성 추가

## Out of Scope

- Frontend Query Tab 구현 (Sprint 2)
- CodeMirror 에디터 (Sprint 2)
- 다중 탭 상태 관리 (Sprint 3)
- 자동완성 (Sprint 4)

## Invariants

- 기존 `query_table_data` 명령 동작 유지 (회귀 없음)
- 모든 에러가 `AppError::Database`로 반환되어야 함
- SQL injection 방지: 파라미터화된 쿼리 사용 (사용자 SQL은 검증 필요)
- `cargo fmt`, `cargo clippy` 통과
- 모든 새 코드에 테스트 필수

## Acceptance Criteria

- `AC-01`: `execute_query` 명령이 SELECT 쿼리를 실행하고 컬럼 메타데이터, 행 데이터, 실행 시간을 반환
- `AC-02`: `execute_query` 명령이 DML 쿼리(INSERT/UPDATE/DELETE)를 실행하고 `rows_affected`를 반환
- `AC-03`: `execute_query` 명령이 DDL 쿼리(CREATE/ALTER/DROP)를 실행하고 성공 메시지를 반환
- `AC-04`: `cancel_query` 명령이 실행 중인 쿼리를 중단하고 성공 확인을 반환
- `AC-05`: 쿼리 에러(문법 오류, 권한 오류 등)가 `AppError::Database`로 반환됨
- `AC-06`: 모든 성공적인 쿼리의 실행 시간(ms)이 반환됨

## Design Bar / Quality Bar

- Rust async/await 패턴 준수
- `tokio_util::sync::CancellationToken` 사용
- Pool 락 패턴: 쿼리 실행 중 락 유지하지 않음 (pool clone 후 즉시 락 해제)
- 에러 처리: `thiserror` 패턴 따르기
- 테스트: SELECT, DML, DDL, 취소 시나리오 커버

## Verification Plan

### Required Checks

1. `cargo test` — 모든 백엔드 테스트 통과 (새 query_integration.rs 포함)
2. `cargo fmt --check` — Rust 코드 포맷 검증
3. `cargo clippy --all-targets --all-features -- -D warnings` — Rust 린트 통과
4. `cargo check` — 컴파일 체크

### Required Evidence

- Generator must provide:
  - 변경된 파일 목록과 변경 목적
  - 실행한 테스트 명령어와 결과
  - 각 AC를 만족한다는 구체적 증거 (테스트 로그 등)
- Evaluator must cite:
  - 각 pass/fail 결정에 대한 구체적 증거
  - 누락되거나 부족한 증거에 대한 finding

## Test Script / Repro Script

1. `cd src-tauri && cargo test` — 모든 테스트 실행
2. 통합 테스트 확인:
   - `SELECT 1, 'hello'` → 2개 컬럼, 1개 행 반환 확인
   - `INSERT INTO test_table VALUES (1)` → rows_affected = 1 반환 확인
   - `CREATE TABLE test_temp (id INT)` → Ddl 반환 확인
   - 긴 실행 시간 쿼리 실행 후 `cancel_query` → 중단 확인

## Ownership

- Generator: Sprint 1 구현 전담
- Write scope:
  - `src-tauri/src/models/query.rs` (new) — QueryResult, QueryColumn, QueryType
  - `src-tauri/src/commands/query.rs` (new) — execute_query, cancel_query 명령
  - `src-tauri/src/commands/connection.rs` — AppState 확장
  - `src-tauri/src/db/postgres.rs` — execute_query 메서드
  - `src-tauri/src/lib.rs` — 명령 등록
  - `src-tauri/Cargo.toml` — tokio-util 의존성
  - `src-tauri/tests/query_integration.rs` (new) — 통합 테스트
- Merge order: 없음 (단일 Sprint)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`

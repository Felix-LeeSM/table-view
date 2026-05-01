# Sprint 183 — Findings

Sprint: `sprint-183` (Phase 22 / TablePlus 패리티 #3 — RDB multi-statement
transaction wrap). Date: 2026-05-01.

## 1. 트랜잭션 시멘틱 결정 (savepoint 거부)

**결정**: `BEGIN → 순차 exec → 모두 성공 시 COMMIT, 첫 실패 시 ROLLBACK`.
`SAVEPOINT` 사용 안 함. 부분 성공 시멘틱은 거부 — "all or nothing".

**이유**:
- 사용자 멘탈 모델 단순화. Sprint 87 의 SQL Preview Dialog 가 보여주는
  N개 statement 는 "이 commit 이 성공하든 실패하든 한 묶음" 으로 인식
  되어야 자연스럽다. savepoint 로 statement 별 partial-success 를
  허용하면 "이 행은 성공, 저 행은 실패" 라는 새 UI 모드를 도입해야
  한다 — 본 sprint 의 범위를 넘는다.
- 트랜잭션 도입 동기 자체가 *부분 적용 방지* 였다 (Pre-Sprint-183 동작
  의 가장 큰 결함). savepoint 는 그 동기를 정면으로 거스른다.

**트레이드오프**: 사용자가 큰 batch (N=1000+) 에서 마지막 statement 가
실패하면 처음부터 다시 시도해야 한다. 그러나 본 commit 파이프라인의
실제 batch 크기는 보통 N≤10 (한 화면 분량 인라인 편집) — 이 비용은
실용상 무시할 수 있다.

## 2. BEGIN/ROLLBACK/cancel 협력 shape

**구조**:
```
work = async {
    let mut tx = pool.begin().await?;
    for (idx, stmt) in statements.iter().enumerate() {
        match sqlx::query(stmt).execute(&mut *tx).await {
            Ok(res) => results.push(...),
            Err(e) => {
                let _ = tx.rollback().await;  // best-effort
                return Err(AppError::Database(format!(
                    "statement {} of {} failed: {}", idx + 1, total, e
                )));
            }
        }
    }
    tx.commit().await?;
    Ok(results)
};

if let Some(token) = cancel_token {
    tokio::select! {
        result = work => result,
        _ = token.cancelled() => Err(AppError::Database("Query cancelled".into())),
    }
} else { work.await }
```

**핵심 결정 3 가지**:
1. `tx.rollback()` 결과는 의도적으로 무시 (`let _ = ...`). 원본 sqlx
   에러가 사용자-가시 메시지로 살아남도록.
2. 에러 메시지에 `"statement K of N failed: <원본>"` 포함 — frontend 의
   `/statement (\d+) of \d+ failed/` 정규식이 statement index 를 추출해
   inline 셀 하이라이트 (failedKey) 를 복원할 수 있게.
3. cancel 시 `tokio::select!` 가 `work` future 를 drop 하면 sqlx 의
   `Transaction` Drop impl 이 **자동으로 ROLLBACK** 을 emit. 즉 명시적
   `tx.rollback()` 호출은 정상 에러 경로에만 두면 충분하고, cancel
   경로는 RAII 에 위임한다.

## 3. 에러 메시지 표준 문구 결정

**결정**: 정확히 `"Commit failed — all changes rolled back: <원본>"`
(em-dash, 공백 포함).

**이유**:
- Sprint 94 의 토스트 wording 과 동일 어휘 ("Commit failed:") 를 유지하면
  서, atomic 시멘틱을 "all changes rolled back" 으로 명시적 단언.
- "executed: K, failed at: K+1 of N" 옛 wording 을 완전 폐기 — 트랜잭션
  하에서 실행된 부분이라는 개념 자체가 사라졌으므로 잔재로 남으면 사용자
  혼동을 유발.
- 회귀 테스트가 정규식 `/Commit failed — all changes rolled back/` 와
  `/(?:executed|failed at): \d/` 부정 단언으로 두 방향에서 wording 을
  핀.

## 4. Mongo 분기 보존 이유

**결정**: `useDataGridEdit.handleExecuteCommit` 의
`paradigm === "document"` 블록은 `git diff` 0. Mongo multi-document
transaction 은 본 sprint 범위 외.

**이유**:
- Mongo multi-document transaction 은 *replica set* 또는 sharded
  cluster 환경을 요구. standalone Mongo 는 지원 안 함. 본 프로젝트의
  e2e harness (single-node docker compose) 가 그 환경을 제공하지 않으므로
  설계/검증 비용이 sprint 1 개를 초과.
- TablePlus 패리티 우선순위 분석 결과, RDB 의 부분-적용 결함이 사용자가
  실제로 만나는 빈도가 훨씬 높다 (`useDataGridEdit` 의 RDB 분기가 commit
  파이프라인의 메인 경로). Mongo 트랜잭션은 별도 sprint 에서 별도 ADR
  (replica-set 의존성) 과 함께 다룬다.

회귀 가드: `useDataGridEdit.document.test.ts` 의 [AC-183-09a] —
`expect(mockExecuteQueryBatch).not.toHaveBeenCalled()`.

## 5. AC → 테스트 매핑

| AC | 검증 위치 | 형태 |
|----|-----------|------|
| AC-183-01 | `src-tauri/src/db/mod.rs:202-218` | trait default impl |
| AC-183-02 | `src-tauri/src/db/postgres.rs:604-687` (inherent) + `:2014-2020` (trait override) | impl |
| AC-183-03 | `src-tauri/src/commands/rdb/query.rs:121-198` (`execute_query_batch`) | Tauri command |
| AC-183-04 | `src/lib/tauri.ts:265-276` (`executeQueryBatch`) | IPC wrapper |
| AC-183-05 | `src/components/datagrid/useDataGridEdit.ts` `handleExecuteCommit` (RDB branch) | hook |
| AC-183-06 | `src/components/query/EditableQueryResultGrid.tsx:199-222` (`handleExecute`) | component |
| AC-183-07a | `src-tauri/src/db/postgres.rs` tests `test_execute_sql_batch_empty_returns_empty_vec` | Rust unit test |
| AC-183-07b | `src-tauri/src/db/postgres.rs` tests `test_execute_sql_batch_validation_rejects_empty_statement` | Rust unit test |
| AC-183-08a | `src/components/datagrid/useDataGridEdit.commit-error.test.ts` `[AC-183-08a]` | Vitest |
| AC-183-08b | 같은 파일 `[AC-183-08b]` (simple + 3-stmt rollback) | Vitest |
| AC-183-08c | `src/components/query/EditableQueryResultGrid.test.tsx` `[AC-183-08c]` (happy + failure) | Vitest |
| AC-183-08d | 같은 파일 `[AC-183-08d]` Cmd+S regression | Vitest |
| AC-183-09 / 09a | `src/components/datagrid/useDataGridEdit.document.test.ts` Mongo branch assertion | Vitest |

## 6. Operator runbook (manual smoke)

본 sprint 는 PG 트랜잭션 시멘틱이 핵심이라 fake adapter cover 가치가
낮다 (mod.rs:645 `FakeCancellableRdb`). 다음 4 시나리오를 사람이 실제
PG 와 함께 확인:

1. **Success batch (N=2)**: PG 연결 → `users` 테이블 (PK 있는) 의 두 행
   편집 → Cmd+S → SQL Preview → Commit. 토스트 `2 changes committed.`,
   두 행 모두 반영.
2. **Failure mid-batch (N=2)**: 같은 절차로 두 번째 행을 PK 충돌이나
   not-null 위반으로 만들고 Commit. 토스트 `Commit failed — all changes
   rolled back: statement 2 of 2 failed: ...`. 데이터 refetch 후 두 행
   다 *원본* 그대로 (Pre-183 라면 첫 행은 적용된 상태였을 것).
3. **Cancel mid-batch (N=10)**: 큰 batch (열 행 편집) 를 만든 후 Commit
   클릭 직후 `cancel_query` 트리거 (개발자 도구 또는 cancel UI). 토스트
   `Query cancelled`. 데이터 refetch 후 모든 행 원본 (sqlx Transaction
   Drop 이 ROLLBACK 자동 emit).
4. **Connection-loss mid-batch**: PG 컨테이너를 batch 도중 정지. 토스트
   `Commit failed — all changes rolled back: <connection 에러>`. 재연결
   후 데이터 원본 유지 (DB 측 PG 가 자체 연결 종료 시 미커밋 트랜잭션
   ROLLBACK).

## 7. Evidence index

- Rust unit test stdout: `cargo test --lib test_execute_sql_batch` →
  ```
  test db::postgres::tests::test_execute_sql_batch_empty_returns_empty_vec ... ok
  test db::postgres::tests::test_execute_sql_batch_validation_rejects_empty_statement ... ok
  test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 326 filtered out;
  ```
- Rust full suite: `cargo test --lib` → `326 passed; 0 failed; 2 ignored`.
- `cargo clippy --all-targets --all-features -- -D warnings` → no
  warnings.
- `cargo fmt --check` → no diff.
- Vitest full suite: `170 files, 2541 tests passed`.
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.

Static greps (Verification Plan §8):
- `git diff src-tauri/src/db/mod.rs` — only adds `execute_sql_batch`
  default. No existing trait method touched.
- `git diff src-tauri/src/db/postgres.rs` — adds inherent
  `execute_query_batch`, trait override, and 2 unit tests. Existing
  `execute_query` body unchanged.
- `git diff src-tauri/src/commands/rdb/query.rs` — adds
  `execute_query_batch`. Existing `execute_query` body unchanged.
- `git diff src/components/datagrid/useDataGridEdit.ts` — Mongo branch
  unchanged. RDB branch swapped to single batch call.
- `grep -RnE 'executed: \\$\\{|failed at:'
  src/components/datagrid/useDataGridEdit.ts
  src/components/query/EditableQueryResultGrid.tsx` → 0 matches.
- `grep -RnE 'all changes rolled back'
  src/components/datagrid/useDataGridEdit.ts
  src/components/query/EditableQueryResultGrid.tsx` → 2 matches.
- `grep -RnE 'it\\.(skip|todo)|xit\\(' src/components/datagrid/...test.ts
  src/components/query/EditableQueryResultGrid.test.tsx` → 0 matches.
- `grep -RnE '#\\[ignore\\]' src-tauri/src/db/postgres.rs` → 0 new
  ignores (the 2 pre-existing ignores in `mod.rs` stay).

## 8. Assumptions

- PostgreSQL 13+ (sqlx postgres feature 의 기본 가정).
- 사용자가 한 commit 에 N=1000+ statement 를 실은 경우는 매우 드물다.
  PG protocol limit (≈1GB) 도달 시 PG 자체 에러로 fail-loud.
- pool 의 single client lease 가 batch 수행 동안 다른 요청에 의해 lease
  되지 않음 (sqlx `Pool::begin` 시멘틱 가정).

## 9. Residual risk

- **Mongo 부분 적용**: 본 sprint 가 RDB 만 cover. Mongo 분기는 여전히
  `dispatchMqlCommand` 루프로 부분 적용 가능. 별도 sprint 가 replica-set
  요구사항과 함께 다룸 (위험 등록부 `docs/RISKS.md` 갱신 권장 — 본
  sprint 범위 외).
- **Isolation level UI 부재**: 본 sprint 는 PG 기본 (read committed) 사용.
  사용자가 serializable 등을 원할 때 UI 없음. 별도 sprint.
- **batch 크기 제한 부재**: 사용자가 명시적으로 고질량 commit 을 실행
  하면 PG protocol limit 또는 statement_timeout 에서 실패. fail-loud
  로 충분하나, 명시적 frontend 검증을 추가하면 더 친절. 별도 sprint.

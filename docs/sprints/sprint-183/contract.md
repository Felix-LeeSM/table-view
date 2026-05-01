# Sprint Contract: sprint-183

## Summary

- **Goal**: Phase 22 / TablePlus 패리티 #3 — RDB 인라인 편집 commit 의
  **트랜잭션 wrap**. 현재 `useDataGridEdit.handleExecuteCommit` (RDB 분기,
  `src/components/datagrid/useDataGridEdit.ts:724-876`) 와
  `EditableQueryResultGrid.handleExecute`
  (`src/components/query/EditableQueryResultGrid.tsx:199-216`) 는 SQL
  preview 의 N개 statement 를 `executeQuery` 단일-statement 명령으로
  **순차 호출** 한다 — 한 statement 가 실패하면 그 앞의 statement 는
  이미 commit 된 채로 끝난다 (`Commit failed (executed: K, failed at: K+1
  of N)` 토스트가 그 사실을 그대로 노출). 본 sprint 는 백엔드에 batch
  Tauri command 를 추가해 **단일 transaction (BEGIN/COMMIT/ROLLBACK)** 으로
  실행하고 두 frontend 호출 지점을 새 IPC 로 전환한다. Phase 22 의 게이트
  패턴 (Preview SQL → Commit / Discard) 자체는 그대로 — 사용자가 보는
  화면은 동일하고, 실패 시의 *부분 적용* 만 사라진다.
- **Audience**: Generator (single agent) — implements; Evaluator — verifies AC.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (browser + command).

## In Scope

- `AC-183-01`: **`RdbAdapter::execute_sql_batch` trait method**
  (`src-tauri/src/db/mod.rs`). 시그니처:
  ```rust
  fn execute_sql_batch<'a>(
      &'a self,
      statements: &'a [String],
      cancel: Option<&'a CancellationToken>,
  ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>>;
  ```
  기본 구현 (`default fn`) 은 `Err(AppError::Unsupported("This adapter
  does not support batched transactions".into()))` 를 반환. SQLite/MySQL
  adapter 가 도입될 때 각자 override. PG 만 본 sprint 에서 실제 구현.

- `AC-183-02`: **`PostgresAdapter::execute_sql_batch` 실제 구현**
  (`src-tauri/src/db/postgres.rs`). 동작:
  1. 풀에서 클라이언트 1개 lease.
  2. `BEGIN` 실행.
  3. `statements` 를 입력 순서대로 실행. 첫 실패 시 `ROLLBACK` 후 원본
     에러를 `AppError::Database` 로 전파 (실패한 statement index +
     원본 메시지를 메시지 본문에 포함, 예:
     `"statement 2 of 3 failed: <pg error>"`).
  4. 모두 성공하면 `COMMIT`. 결과 `Vec<RdbQueryResult>` 를 입력 순서로
     반환.
  5. cancellation token 협력 — `tokio::select!` 로 `BEGIN` ~ 마지막
     statement 까지 cancel 가능. cancel 되면 `ROLLBACK` 시도 (실패해도
     원래 cancel 에러를 우선 전파). 기존 `execute_sql` 의
     cancel 협력 패턴과 동일 shape.

- `AC-183-03`: **`execute_query_batch` Tauri command**
  (`src-tauri/src/commands/rdb/query.rs`). 시그니처:
  ```rust
  #[tauri::command]
  pub async fn execute_query_batch(
      state: State<'_, AppState>,
      connection_id: String,
      statements: Vec<String>,
      query_id: String,
  ) -> Result<Vec<QueryResult>, AppError>
  ```
  검증: `statements` 비어있으면 `AppError::Validation("Query batch cannot
  be empty")`, 각 statement 의 trim 이 비면 같은 종류 에러
  (`"Statement N is empty"`). cancel-token 등록/제거는 기존
  `execute_query` 와 동일. `active.as_rdb()?.execute_sql_batch(...)`
  로 dispatch. `src-tauri/src/lib.rs` (또는 `commands/mod.rs`) 의
  `invoke_handler` 에 등록. 실패 시 `tracing::warn!` 로 batch size 와
  failed index 까지 로깅.

- `AC-183-04`: **`src/lib/tauri.ts` IPC wrapper**.
  ```ts
  export async function executeQueryBatch(
    connectionId: string,
    statements: string[],
    queryId: string,
  ): Promise<QueryResult[]>
  ```
  타입은 기존 `executeQuery` 와 동일 패턴. `core.invoke<QueryResult[]>(
  "execute_query_batch", { connectionId, statements, queryId })`.

- `AC-183-05`: **`useDataGridEdit.handleExecuteCommit` (RDB 분기) 전환**.
  현재 `for (let i = 0; i < statements.length; i++)` 루프
  (`src/components/datagrid/useDataGridEdit.ts:775-819`) 를 단일
  `executeQueryBatch(connectionId, statements.map(s => s.sql),
  edit-${Date.now()})` 호출로 교체. catch 분기는 다음 시멘틱으로
  단순화:
  - 실패 — 백엔드가 이미 ROLLBACK 했으므로 *어떤* statement 도
    적용되지 않았다. `commitError.message` 를
    `"Commit failed — all changes rolled back: <message>"` 로 변경
    (기존 `executed: N, failed at: K of M` 형식 폐기). `failedKey` 는
    백엔드 에러 메시지에서 statement index 추출 가능 시 사용
    (`/statement (\d+) of \d+ failed/` 정규식), 추출 실패 시 `undefined`.
  - 성공 토스트는 그대로 (`${statementCount} changes committed`).
  - **Mongo 분기 (`paradigm === "document"`) 는 무수정** — Sprint 87 의
    `dispatchMqlCommand` 루프 그대로 (Mongo 는 기본적으로 multi-document
    transaction 을 본 단계에서 도입하지 않음, out-of-scope).

- `AC-183-06`: **`EditableQueryResultGrid.handleExecute` 전환**.
  `for (const sql of sqlPreview)` 루프
  (`src/components/query/EditableQueryResultGrid.tsx:199-216`) 를
  `executeQueryBatch(connectionId, sqlPreview, raw-edit-${Date.now()})`
  단일 호출로 교체. catch 의 `executeError` 메시지는
  `"Commit failed — all changes rolled back: <message>"` 로 갱신.
  Sprint 182 의 PendingChangesTray / PK 가드 / Cmd+S 코드 무수정.

- `AC-183-07`: **Rust unit tests** (`src-tauri/src/db/postgres.rs`
  하단 `#[cfg(test)] mod tests`). 통합 테스트는 host PG 의존성이
  높으므로 본 sprint 는 다음 두 단위 테스트로 cover:
  1. `test_execute_sql_batch_empty_returns_empty_vec` — 빈 슬라이스 입력
     은 즉시 `Ok(vec![])` 반환 (BEGIN/COMMIT 호출 없음 — 무의미한
     트랜잭션 비용 절감).
  2. `test_execute_sql_batch_validation_rejects_empty_statement` —
     statements 중 하나가 trim 후 빈 문자열이면 BEGIN 시작 전에
     `AppError::Validation` 반환.
  Postgres 와 통신하는 실제 BEGIN/COMMIT/ROLLBACK 동작은
  `src-tauri/src/db/mod.rs` 의 `FakeCancellableRdb` (line 645) 를 확장하지
  않고 **operator runbook (findings.md)** 에 docker-compose 기반 manual
  smoke 4 케이스 (success / fail-mid / cancel-mid / connection-loss) 로
  대체. (이유: 본 트레잇 메서드는 PG-specific 트랜잭션 시멘틱이 핵심이라
  fake 로 cover 해도 회귀 가치가 낮음.)

- `AC-183-08`: **Frontend Vitest** —
  `src/components/datagrid/useDataGridEdit.test.tsx` (이미 commit 시
  나리오 다수) 와 `src/components/query/EditableQueryResultGrid.test.tsx`
  의 *기존* commit 케이스가 새 mock (`executeQueryBatch`) 으로 통과하도록
  업데이트. 추가 케이스:
  - `[AC-183-08a] useDataGridEdit RDB commit calls executeQueryBatch once
    with all statements (not executeQuery N times)`
  - `[AC-183-08b] useDataGridEdit RDB commit failure → commitError.message
    matches /Commit failed — all changes rolled back/ (no "executed: K, failed
    at: K+1" wording)`
  - `[AC-183-08c] EditableQueryResultGrid commit calls executeQueryBatch
    once + on failure surfaces "all changes rolled back" message`
  - `[AC-183-08d] (regression) Cmd+S still triggers commit; commit-flash
    still fires; SQL preview Dialog still renders the same per-statement
    SQL list.`

- `AC-183-09`: **회귀 가드 (Mongo 무영향)**.
  `useDataGridEdit.handleExecuteCommit` 의 `paradigm === "document"`
  분기는 git diff 0 (Mongo 는 별도 sprint).
  `MqlPreviewModal.test.tsx` (있다면) 의 모든 assertion 무수정 통과.

## Out of Scope

- **Mongo multi-document transaction** — `dispatchMqlCommand` 루프 그대로.
  Mongo 트랜잭션은 별도 sprint 에서 (replica set 요구사항이 host 환경에
  강한 가정을 도입하므로).
- **SQLite / MySQL adapter** — 본 sprint 에서 production 구현체는
  PG 하나 (`src-tauri/src/db/postgres.rs:1933`) 뿐. 다른 adapter 가
  도입될 때 각자 `execute_sql_batch` 를 override.
- **Isolation level UI** — 트랜잭션은 PG 기본값 (read committed) 사용.
  사용자가 `BEGIN ISOLATION LEVEL ...` 를 고를 수 있는 UI 는 별도 sprint.
- **INSERT 통합** — `pendingNewRows` 의 INSERT 문 빌더는 Sprint 184
  스코프. 본 sprint 는 기존 SQL preview pipeline 이 만든 statements 를
  그대로 batch 로 전환만 한다.
- **Multi-row bulk transaction outside commit pipeline** — 사용자가
  raw query editor 에서 직접 `BEGIN; ...; COMMIT;` 를 입력해 실행하는
  경로는 영향 없음 (기존 `executeQuery` 가 PG 의 multi-statement 지원에
  의존하면서 그대로 동작).
- **Cancellation during partial COMMIT** — PG 트랜잭션 cancellation
  semantics 는 PG 측에 위임. 우리는 `tokio::select!` 로 cancel 신호를
  받으면 `ROLLBACK` 을 best-effort 로 시도하고 cancel 에러를 전파한다.
- **e2e** — 본 sprint 는 IPC + 트랜잭션 시멘틱 변경. e2e 추가는
  Sprint 184 의 INSERT 통합과 함께.
- **Sprint 175~182 산출물** — touched 0 (단, AC-183-05/06/08 에 따라
  use site 코드 + 테스트 mock 만 수정).
- **`Paradigm` 타입** (`src/types/connection.ts`) — 무수정.

### Files allowed to modify

- `src-tauri/src/db/mod.rs` — `RdbAdapter` 트레잇에 `execute_sql_batch`
  default impl 추가. 기존 메서드 시그니처 무수정.
- `src-tauri/src/db/postgres.rs` — `PostgresAdapter::execute_sql_batch`
  override + 단위 테스트 2건 추가. 기존 `execute_sql` / `execute_query`
  본체 무수정.
- `src-tauri/src/commands/rdb/query.rs` — `execute_query_batch` 추가.
  기존 `execute_query` 본체 무수정.
- `src-tauri/src/lib.rs` (또는 invoke_handler 정의 위치) —
  `execute_query_batch` 등록 1줄 추가.
- `src/lib/tauri.ts` — `executeQueryBatch` 함수 추가.
- `src/components/datagrid/useDataGridEdit.ts` — RDB commit 분기만 batch
  로 전환. Mongo 분기 / Cmd+S / commit-flash / pendingEdits 관리 코드는
  무수정.
- `src/components/datagrid/useDataGridEdit.test.tsx` — `executeQuery`
  mock → `executeQueryBatch` mock 업데이트, AC-183-08a/b 추가.
- `src/components/query/EditableQueryResultGrid.tsx` — `handleExecute`
  만 batch 로 전환. PendingChangesTray / PK 가드 / Sprint 182 산출물 무수정.
- `src/components/query/EditableQueryResultGrid.test.tsx` —
  AC-183-08c/d 추가. 기존 assertion 무수정.
- `docs/sprints/sprint-183/contract.md` (this file).
- `docs/sprints/sprint-183/findings.md` (new).
- `docs/sprints/sprint-183/handoff.md` (new).

## Invariants

- **`RdbAdapter::execute_sql` 시그니처 / 본체 무변동.** 기존 single-stmt
  실행 경로는 그대로. batch 는 명시적으로 별 메서드.
- **Tauri command `execute_query` 시그니처 / 본체 무변동.** 기존 호출
  지점 (스키마 introspection, 사용자 raw query 등) 영향 0.
- **Mongo paradigm 의 commit 동작 무변동** — `useDataGridEdit` 의
  `paradigm === "document"` 분기 git diff 0.
- **Sprint 87 `MqlPreviewModal` / `dispatchMqlCommand`** — 무수정.
- **Sprint 98 commit-flash, Sprint 93 `commitError`, Sprint 94 commit
  토스트** — 외형 (배지 + 토스트 message body 키워드) 변하지 않음.
  메시지의 *세부 문구* 는 본 sprint 가 변경 (executed/failed-at →
  rolled back) — 이는 명시적 AC.
- **strict TS / ESLint**: `any` 금지, `pnpm tsc --noEmit` zero,
  `pnpm lint` zero.
- **신규 런타임 의존성 0**. `package.json` / `Cargo.toml` 미변경.
- **`it.skip` / `it.todo` / `xit` 0건** (skip-zero gate). Rust 측
  `#[ignore]` 0건.
- **PendingChangesTray (Sprint 182)** — git diff 0.

## Acceptance Criteria

- `AC-183-01` — `RdbAdapter::execute_sql_batch` 트레잇 메서드가 default
  `Unsupported` 구현으로 추가됨. PG 외 adapter 가 추가될 때 (out-of-scope)
  자동 fallback.
- `AC-183-02` — `PostgresAdapter::execute_sql_batch` 가 BEGIN → 순차
  exec → 모두 성공 시 COMMIT, 첫 실패 시 ROLLBACK + 에러 전파. cancel
  signal 시 ROLLBACK 시도 후 cancel 에러 전파.
- `AC-183-03` — `execute_query_batch` Tauri command 가 frontend 에서
  invoke 가능하고, 빈 statements / 빈 단일 statement 입력에 validation
  에러를 반환.
- `AC-183-04` — `executeQueryBatch` 가 `src/lib/tauri.ts` 에 export 됨.
- `AC-183-05` — `useDataGridEdit.handleExecuteCommit` (RDB 분기) 가
  `executeQueryBatch` 를 단 한 번 호출. 실패 시 `commitError.message`
  가 정규식 `/Commit failed — all changes rolled back/` 매칭.
- `AC-183-06` — `EditableQueryResultGrid.handleExecute` 가
  `executeQueryBatch` 를 단 한 번 호출. 실패 시 `executeError` 메시지가
  같은 정규식 매칭.
- `AC-183-07` — Rust 단위 테스트 2건 (빈 입력 / 빈 statement 검증) 통과.
- `AC-183-08` — Frontend Vitest 4 케이스 (08a~d) 통과.
- `AC-183-09` — `useDataGridEdit.handleExecuteCommit` 의
  `paradigm === "document"` 분기 git diff 0.

## Design Bar / Quality Bar

- **트랜잭션은 BEGIN/COMMIT/ROLLBACK 의 3 verb 만.** PostgreSQL 의
  `SAVEPOINT` 사용 금지 (부분 성공 시멘틱은 본 sprint 가 명시적으로
  거부 — "all or nothing").
- **batch 크기 제한 없음.** 사용자가 한 번의 commit 에 N 행을 편집하면
  N 개 statement 가 들어간다 (현재 그대로). 추후 SQL 길이 합이 PG
  protocol 한계 (보통 1GB) 를 넘기면 명시적 검증을 추가하지만 본 sprint
  에서는 (a) 그 limit 에 도달하는 commit 이 매우 드물고 (b) PG 가 자체
  에러를 줄 것이므로 fail-loud 전략을 따른다.
- **에러 메시지 표준 문구**: 정확히
  `Commit failed — all changes rolled back: <원본 메시지>` (em-dash,
  공백 포함). 변경 시 회귀 테스트와 함께 업데이트.
- **statement index 추출 패턴**: backend 가 `"statement N of M failed: ..."`
  를 메시지에 포함시키므로 frontend 에서 `/statement (\d+) of \d+ failed/`
  로 추출. 추출 성공 시 `failedKey` 에 매핑하여 inline 하이라이트 유지.
- **테스트 명명**: `[AC-183-0X]` prefix. 각 신규 테스트에
  `// AC-183-0X — <reason>; date 2026-05-01.` 코멘트 (auto-memory
  `feedback_test_documentation.md`).
- **커버리지**: 신규 라인 70% 이상. `executeQueryBatch` 호출 site +
  `commitError` 메시지 분기는 100%.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test --lib execute_sql_batch` — Rust 단위
   테스트 2건 green.
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — zero warnings.
3. `cd src-tauri && cargo fmt --check` — diff 0.
4. `pnpm vitest run src/components/datagrid/useDataGridEdit.test.tsx
   src/components/query/EditableQueryResultGrid.test.tsx` — 신규 + 회귀
   green.
5. `pnpm vitest run` — 전체 suite green (회귀 0).
6. `pnpm tsc --noEmit` — zero errors.
7. `pnpm lint` — zero errors.
8. **Static (Generator-recorded, Evaluator re-runs)**:
   - `git diff src-tauri/src/db/mod.rs` — 트레잇에 `execute_sql_batch`
     default 만 추가; 기존 메서드 시그니처 무변동.
   - `git diff src-tauri/src/db/postgres.rs` — `execute_sql_batch`
     override + tests 만 추가; 기존 `execute_sql` 본체 무변동.
   - `git diff src-tauri/src/commands/rdb/query.rs` — `execute_query`
     본체 무변동, `execute_query_batch` 만 추가.
   - `git diff src/components/datagrid/useDataGridEdit.ts` —
     `paradigm === "document"` 블록 (lines 725~763 부근) git diff 0,
     RDB 블록만 변경.
   - `grep -RnE "executed: \\$\\{|failed at:" src/components/datagrid/
     useDataGridEdit.ts src/components/query/EditableQueryResultGrid.tsx`
     — 0건 (옛 메시지 잔재 없음).
   - `grep -RnE "all changes rolled back" src/components/datagrid/
     useDataGridEdit.ts src/components/query/EditableQueryResultGrid.tsx`
     — 두 곳 모두 출현.
   - `grep -RnE 'it\\.(skip|todo)|xit\\(' src/components/datagrid/
     useDataGridEdit.test.tsx src/components/query/
     EditableQueryResultGrid.test.tsx` — 0건.
   - `grep -RnE '#\\[ignore\\]' src-tauri/src/db/postgres.rs` — 0건.
9. **Operator browser smoke** (선택 — sandbox 에서 실행 불가하면
   findings.md 의 "Operator runbook" 으로 기록):
   1. `pnpm tauri dev`.
   2. PG 연결 → DataGrid 에서 PK 있는 테이블 선택 → 2 행 편집 → Cmd+S
      → SQL Preview → Commit → 토스트 `2 changes committed` + 두 행 모두
      반영.
   3. 같은 절차로 2 행 편집하되 두 번째 행을 PK 충돌 등 위반으로 만든다
      → Commit → 토스트 `Commit failed — all changes rolled back: ...`
      → 데이터 다시 fetch → **두 행 다 원본 그대로** (전 sprint 라면 첫
      행은 적용된 상태).
   4. EditableQueryResultGrid (raw query) 같은 시나리오 반복 — 같은
      관찰.
   5. Mongo 연결 → 문서 편집 → Commit → 기존과 동일하게 동작 (회귀 0).

### Required Evidence

- Generator:
  - 변경 파일 목록 (purpose 한 줄씩).
  - Vitest stdout — `[AC-183-0X]` 케이스 가시.
  - `cargo test --lib` stdout — Rust 단위 테스트 2건 통과.
  - `findings.md` 섹션: 트랜잭션 시멘틱 결정 (savepoint 거부 이유) /
    BEGIN/ROLLBACK/cancel 협력 shape / 에러 메시지 표준 문구 결정 /
    Mongo 분기 보존 이유 / AC→테스트 매핑 / operator runbook (manual
    smoke 4 시나리오) / evidence index.
  - `handoff.md`: AC 별 evidence 행 (한 행 = 한 AC).
- Evaluator: AC 별 통과 evidence 인용 + 위 #1~#8 재실행 + invariant
  `git diff` 확인.

## Test Requirements

### Unit Tests (필수)

- **Rust** (`src-tauri/src/db/postgres.rs` 하단 `#[cfg(test)] mod tests`):
  - `[AC-183-07a] test_execute_sql_batch_empty_returns_empty_vec`
  - `[AC-183-07b] test_execute_sql_batch_validation_rejects_empty_statement`
- **`useDataGridEdit.test.tsx`** (AC-183-08):
  - `[AC-183-08a] RDB commit invokes executeQueryBatch once with all
    statement strings (not executeQuery N times)`
  - `[AC-183-08b] RDB commit failure surfaces "Commit failed — all changes
    rolled back" in commitError.message and toast`
  - `[AC-183-09a] (regression) document paradigm commit still iterates
    dispatchMqlCommand — no batch call on Mongo path`
- **`EditableQueryResultGrid.test.tsx`** (AC-183-08):
  - `[AC-183-08c] handleExecute invokes executeQueryBatch once + on
    failure surfaces "all changes rolled back" in executeError`
  - `[AC-183-08d] (regression) Cmd+S → commit-flash → SQL preview Dialog
    renders all statements unchanged`

### Coverage Target

- 신규 라인: 70% 이상.
- `execute_query_batch` Tauri command + `executeQueryBatch` IPC wrapper:
  100% (분기 자체가 단순).

### Scenario Tests (필수)

- [x] Happy path — N statement 모두 성공 → COMMIT → success 토스트.
- [x] 빈/누락 입력 — 빈 statements / 한 항목 trim 후 빈 → Validation
  에러 + 트랜잭션 시작 안 함.
- [x] 에러 복구 — K 번째 statement 실패 → ROLLBACK → 모든 행 원본
  유지 + 사용자에게 "all changes rolled back" 토스트 + 모달 잔존.
- [x] 동시성 — 같은 connection 에서 두 commit 이 빠르게 연속 → 백엔드는
  active connection 의 mutex 하에 순차 처리 (PG pool 의 client lease
  semantics) — 본 sprint 가 새 동시성 path 도입하지 않음.
- [x] 상태 전이 — pending edits → preview → commit → (성공 시 빈
  pending + refetch) / (실패 시 모달 잔존 + commitError 노출).
- [x] 회귀 — Mongo paradigm commit 동작 무변동 (AC-183-09).

## Test Script / Repro Script

1. `pnpm install`.
2. `cd src-tauri && cargo test --lib` (또는 Rust 측 전체 suite).
3. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings`.
4. `cd src-tauri && cargo fmt --check`.
5. `pnpm vitest run src/components/datagrid/useDataGridEdit.test.tsx
   src/components/query/EditableQueryResultGrid.test.tsx`.
6. `pnpm vitest run` (full suite).
7. `pnpm tsc --noEmit`.
8. `pnpm lint`.
9. Static greps + invariant `git diff` (Verification Plan §8).
10. (Optional) `pnpm tauri dev` → 5-step operator smoke.

## Ownership

- Generator: single agent.
- Write scope (정확): 위 §"Files allowed to modify".
- Untouched: `CLAUDE.md`, `memory/` (decisions index 미변경 — 본 sprint
  는 ADR 추가하지 않음. 트랜잭션 wrap 은 결정이라기보다 phase-22 의
  자연스러운 수렴이며, savepoint 거부는 *기본값* 이지 정책 결정 아님),
  `src/types/connection.ts`, sprints 175~182 산출물 (PendingChangesTray
  포함), `package.json`, `Cargo.toml`, Mongo adapter 코드 전체
  (`src-tauri/src/db/mongodb.rs`).
- Merge order: Sprint 182 머지 후. Sprint 184 (INSERT 통합) 보다 먼저.

## Exit Criteria

- 열린 `P1` / `P2` findings: `0`
- Required checks 통과: `yes` (1–8 in Verification Plan)
- `docs/sprints/sprint-183/findings.md` 존재 + 사양대로 섹션 채움.
- `docs/sprints/sprint-183/handoff.md` 에 AC 별 evidence 행 (한 행 =
  한 AC).

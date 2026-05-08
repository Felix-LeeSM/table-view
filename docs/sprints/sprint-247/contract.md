# Sprint Contract: sprint-247

## Summary

- Goal: ADR 0022 Phase 3 — destructive 문장에 대한 dry-run 백엔드 + dialog
  preview 영역 통합. `BEGIN; <stmts...>; ROLLBACK;` 패턴으로 statement 결과
  (rows_affected per stmt, 실행시간) 를 commit 없이 산출하는 IPC 추가, dialog
  열릴 때 자동으로 dry-run 실행 → preview 렌더. PG 우선 지원, MySQL/SQLite 는
  Unsupported fallback (기존 `execute_sql_batch` 와 동일 패턴), Mongo 는 disclaimer
  로 fallback.
- Audience: Generator + Evaluator agents (harness 흐름)
- Owner: Phase 3 (Sprint 247)
- Verification Profile: `command`

## In Scope

### 백엔드 (Rust)

1. **신규 trait method** `RdbAdapter::dry_run_sql_batch` —
   `src-tauri/src/db/traits.rs`:
   - 시그니처:
     ```rust
     fn dry_run_sql_batch<'a>(
         &'a self,
         statements: &'a [String],
         cancel: Option<&'a CancellationToken>,
     ) -> BoxFuture<'a, Result<Vec<RdbQueryResult>, AppError>>;
     ```
   - Default impl: `Err(AppError::Unsupported("This adapter does not support dry-run".into()))`.
   - Doc-comment: 의미 (BEGIN → 모든 stmt 실행 → 무조건 ROLLBACK), 반환 의미
     (`total_count` = `rows_affected` per stmt; commit 안 됨), Mongo 미지원
     안내 (Mongo 어댑터는 본 method 호출하지 않음).

2. **PG 구현** `src-tauri/src/db/postgres/queries.rs` (또는 `mutations.rs`
   적절한 파일):
   - 본문: `execute_query_batch` 와 거의 동일하되, 마지막에 `tx.commit()` 대신
     `tx.rollback()` 을 호출. Empty input → `Ok(vec![])` (BEGIN 미발행).
   - 통계 수집은 `execute_query_batch` 와 동일 (`rows_affected`,
     `execution_time_ms`).
   - Statement K 실패 시 동일한 `"statement K of N failed: <msg>"` 에러 카피
     유지 (preview 단계도 사용자가 동일한 에러 메시지를 보도록).
   - cancel token 협조 동일.

3. **신규 Tauri command** `execute_query_dry_run` —
   `src-tauri/src/commands/rdb/query.rs`:
   - 시그니처: `(connection_id: String, statements: Vec<String>, query_id: String)
     -> Result<Vec<QueryResult>, AppError>`.
   - inner 함수 `execute_query_dry_run_inner` 분리 (단위 테스트용, 기존
     `execute_query_batch_inner` 와 동일 분리 패턴).
   - 입력 검증 동일 (`connection_id`/`statements`/각 stmt 비어있음 거부).
   - 비-RDB paradigm → `AppError::Unsupported`.
   - cancel 토큰 등록 + 해제 동일 패턴.
   - 로깅 키워드 `"Dry-run committed"` 대신 `"Dry-run completed (rolled back)"`.
   - `lib.rs` `tauri::generate_handler!` 매크로에 신규 command 등록.

4. **단위 테스트** — `src-tauri/src/commands/rdb/query.rs` 의 `mod tests` 에:
   - `dry_run_empty_connection_id_rejected`
   - `dry_run_empty_statements_rejected`
   - `dry_run_empty_statement_at_index_reports_position`
   - `dry_run_unknown_connection_returns_notfound`
   - `dry_run_document_paradigm_returns_unsupported`
   - `dry_run_rdb_propagates_results` (mock adapter `dry_run_sql_batch_fn` 추가).

5. **db tests / postgres mock fixture**: `src-tauri/src/db/tests.rs` 에 새 trait
   method 의 `dry_run_sql_batch_fn` mock 필드 추가 + 기본 fallback 구현.

### 프론트엔드 (TypeScript / React)

6. **lib wrapper** — `src/lib/tauri/query.ts`:
   ```ts
   export async function executeQueryDryRun(
     connectionId: string,
     statements: string[],
     queryId: string,
   ): Promise<QueryResult[]> {
     return invoke<QueryResult[]>("execute_query_dry_run", {
       connectionId, statements, queryId,
     });
   }
   ```
   `index.ts` 의 re-export 동기화.

7. **신규 hook** — `src/hooks/useDryRun.ts`:
   ```ts
   export interface DryRunState {
     status: "idle" | "running" | "success" | "error" | "unsupported";
     results: QueryResult[] | null;
     error: string | null;
   }
   export function useDryRun(args: {
     connectionId: string;
     statements: string[];
     paradigm: "rdb" | "document";
     enabled: boolean;
   }): DryRunState;
   ```
   - `paradigm === "document"` → 즉시 `status: "unsupported"`, dry-run IPC 호출
     하지 않음.
   - `enabled === false` → `status: "idle"`.
   - `enabled` 가 true 가 되는 시점 (dialog mount) 에 IPC 호출.
   - 후속 `enabled` 토글 → 새 query_id 로 재실행.
   - cancel: hook unmount 시 `cancelQuery(queryId)` best-effort 호출.

8. **dialog 통합** — `src/components/workspace/ConfirmDestructiveDialog.tsx`:
   - 기존 `data-testid="dry-run-placeholder"` 영역을 다음으로 교체:
     ```tsx
     <DryRunPreview
       connectionId={connectionId}
       statements={statements}
       paradigm={paradigm}
       open={open}
     />
     ```
   - 새 props 추가: `connectionId: string`, `statements: string[]`,
     `paradigm: "rdb" | "document"`. `sqlPreview` 는 보존 (statement preview
     섹션은 유지 — dry-run 결과와는 별개로 raw SQL 도 항상 보여줌).

9. **신규 컴포넌트** — `src/components/workspace/DryRunPreview.tsx`:
   - `useDryRun` 호출, 상태별 렌더링:
     - `running` → spinner + "Running dry-run...".
     - `success` → 표 형태 또는 list:
       statement 1 of N → `<rows_affected> rows affected (<ms>ms)`
       statement 2 of N → ...
     - `error` → `text-destructive` + 에러 메시지 verbatim
       (`"statement K of N failed: ..."`).
     - `unsupported` → 회색 disclaimer
       `"Dry-run not supported for this connection (MongoDB)."`.
     - `idle` → 빈 영역 (dialog 닫힌 상태).
   - `data-testid`:
     - `dry-run-status`: `"running" | "success" | "error" | "unsupported" | "idle"` 텍스트
       또는 `data-status` 속성으로 노출.
     - `dry-run-result-row-{idx}`: 각 statement 결과 row.
     - `dry-run-error-message`: 에러 텍스트.

10. **호출자 정렬** — 모든 `<ConfirmDestructiveDialog>` 호출 지점 (15개) 에
    `connectionId`, `statements`, `paradigm` prop 추가:
    - `DataGrid.tsx` — `connectionId={connectionId}`,
      `statements={pendingConfirm.sql ? [pendingConfirm.sql] : []}` 또는
      hook 의 `pendingConfirm.statements` (현재 `string` 또는 `string[]` 인지
      체크 후 정규화), `paradigm="rdb"`.
    - `QueryTab.tsx` (Mongo) — `paradigm="document"`,
      `statements={[JSON.stringify(pipeline)]}` (도큐먼트 hook 은 어차피
      `unsupported` 분기로 disclaimer 표시).
    - `QueryTab.tsx` (RDB) — `paradigm="rdb"`,
      `statements={pendingRdbConfirm.statements}`.
    - `EditableQueryResultGrid.tsx` — `paradigm="rdb"`,
      `statements={pendingConfirm.sqls}`.
    - schema editors (`DropTableDialog`, `DropColumnDialog`, `AddColumnDialog`,
      `RenameTableDialog`, `CreateTableDialog`) — `paradigm="rdb"`,
      `statements=[<sql_preview>]`.
    - structure editors (`ColumnsEditor`, `ConstraintsEditor`, `IndexesEditor`,
      `useDdlPreviewExecution`) — `paradigm="rdb"`,
      `statements=[<sql>]`.
   - 각 호출자가 이미 `pendingConfirm` 형태로 들고있는 sql 문자열/배열을
     일관되게 `string[]` 으로 정규화.

### 테스트

11. **dialog 테스트** — `src/components/workspace/ConfirmDestructiveDialog.test.tsx`:
    - 기존 `[AC-246-D7]` (placeholder 영역 존재) 케이스 유지 (이름/문구만
      `dry-run-status` 또는 `idle` 검증으로 변경).
    - `[AC-247-D8]` `paradigm="rdb"` + dry-run 성공 → `dry-run-result-row-0`
      이 `rows_affected` 정보 노출.
    - `[AC-247-D9]` `paradigm="rdb"` + dry-run 실패 → `dry-run-error-message`
      에 statement K of N 카피 노출.
    - `[AC-247-D10]` `paradigm="document"` → `dry-run-status="unsupported"`,
      IPC 호출 0회.
    - `[AC-247-D11]` dialog 가 닫힌 상태 (`open=false`) 에서는 IPC 호출 0회.

12. **hook 테스트** — `src/hooks/useDryRun.test.ts`:
    - `[AC-247-H1]` paradigm=document → unsupported, IPC 미호출.
    - `[AC-247-H2]` enabled=false → idle, IPC 미호출.
    - `[AC-247-H3]` enabled=true 전이 → running → success.
    - `[AC-247-H4]` enabled=true + IPC reject → error 상태로 전이.
    - `[AC-247-H5]` cancel: unmount → `cancelQuery(queryId)` 호출 (best-effort).

13. **호출자 회귀 가드** — 기존 `[AC-186-04b]`, `[AC-186-05b]`, `[AC-186-06]`,
    `[AC-185-04c]`, `[AC-185-05c]`, `[AC-245-N1]` 등 모두 통과 확인. dry-run
    IPC 가 호출자 테스트에서 mock 처리되어야 함:
    ```ts
    vi.mock("@lib/tauri", () => ({ ..., executeQueryDryRun: vi.fn(() => Promise.resolve([])) }));
    ```
    또는 paradigm/enabled 분기로 자동 idle/unsupported 되도록.

14. **Rust 통합 테스트** — `src-tauri/src/db/postgres.rs` 또는 `tests/`:
    - PG dry-run 의 ROLLBACK 검증은 mock 으로는 한계가 있으므로 unit 테스트는
      "쿼리 명령 inner 의 dispatch" 까지만 커버. 실제 DB 통합 테스트는
      `src-tauri/tests/` 에 `dry_run_pg_rolls_back` 추가 (PG 가용한 환경
      gating, `#[ignore]` 또는 feature flag 기반).
    - 시간 제약 시 위 통합 테스트는 옵셔널 — unit 테스트만 필수.

## Out of Scope

- 별도 "Dry Run" 버튼 / Cmd+Shift+Enter — **Phase 4 (Sprint 248)**.
- Cmd+Z pending undo — **Phase 5 (Sprint 249)**.
- Mongo dry-run 실제 구현 (single-node 미지원 — disclaimer 만).
- MySQL/SQLite 어댑터 dry-run 구현 (default `Unsupported` impl 만).
- dialog 헤더 / placeholder 시각 디자인 변경 (Phase 2 결과 보존).
- `decideSafeModeAction` 매트릭스 변경 (Phase 1 결과 보존).
- 정책 정의 (rule of execution) 변경 — 이미 Phase 1/2 에서 확정.

## Invariants

- `execute_query_batch` IPC 시그니처 / 동작 변경 0 — 기존 commit 경로 그대로.
- `decideSafeModeAction` 본문 / 매트릭스 변경 0.
- `pendingConfirm` shape 변경 0 (각 hook 별 기존 shape 보존). 새 prop 은
  호출자가 외부에서 파생.
- `safeModeStore` / persistence / IPC 채널 변경 0.
- ConfirmDestructiveDialog 의 헤더 분기 / Confirm Yes/No 동작 보존
  (Phase 2 결과 그대로).
- AC-246-D1..D7 (Phase 2 dialog 보존), AC-245-L1..L8 (Phase 1 매트릭스),
  AC-186-* / AC-185-* 기존 가드 모두 통과 유지.

## Acceptance Criteria

### 백엔드 IPC

- `AC-247-B1` `execute_query_dry_run_inner(state, "  ", &stmts, "q")` →
  `AppError::Validation("Connection ID cannot be empty")`.
- `AC-247-B2` `execute_query_dry_run_inner(state, "c", &[], "q")` →
  `AppError::Validation("Query batch cannot be empty")`.
- `AC-247-B3` `execute_query_dry_run_inner(state, "c", &["a","",""], "q")` →
  `AppError::Validation("Statement 2 of 3 is empty")`.
- `AC-247-B4` connection 미존재 → `AppError::NotFound`.
- `AC-247-B5` document paradigm 연결 → `AppError::Unsupported`.
- `AC-247-B6` mock RDB adapter `dry_run_sql_batch_fn = Ok(vec![QueryResult { total_count: 3, ... }])`
  → command 결과 그대로 propagate.
- `AC-247-B7` `RdbAdapter::dry_run_sql_batch` default impl → `AppError::Unsupported`.

### 프론트엔드 hook

- `AC-247-H1` `useDryRun({ paradigm: "document", enabled: true, ... })` →
  `status="unsupported"`, IPC mock 호출 0.
- `AC-247-H2` `useDryRun({ enabled: false, ... })` → `status="idle"`,
  IPC 호출 0.
- `AC-247-H3` `enabled=true` + IPC resolve → 상태 전이 idle → running →
  success, `results` 가 IPC 응답으로 채워짐.
- `AC-247-H4` `enabled=true` + IPC reject → 상태 error, `error` 메시지가
  mock reject 메시지.
- `AC-247-H5` hook unmount → `cancelQuery(queryId)` 호출 (1회).

### dialog 통합

- `AC-247-D8` rdb + 성공 → `data-testid="dry-run-result-row-0"` 노드가
  `rows_affected` 텍스트 노출.
- `AC-247-D9` rdb + 실패 → `data-testid="dry-run-error-message"` 가 reject
  메시지 노출.
- `AC-247-D10` document → `data-status="unsupported"` + disclaimer 카피.
- `AC-247-D11` `open=false` → IPC mock 호출 0.

### lib wrapper

- `AC-247-L1` `executeQueryDryRun("c", ["UPDATE x"], "q")` → tauri `invoke`
  호출 시 command name `"execute_query_dry_run"` + payload `{ connectionId, statements, queryId }`.

### 호출자 회귀 가드

- `AC-247-W1` 기존 `[AC-186-06]` (DataGrid warn-tier dialog mount) 보존.
- `AC-247-W2` 기존 `[AC-186-04b]` (`useDataGridEdit.confirmDangerous` →
  `executeQueryBatch` 1회) 보존. dry-run mock 은 `[]` 반환해도 무방.
- `AC-247-W3` 기존 `[AC-185-05c]` / `[AC-245-N1]` (dev+strict + DROP →
  dialog) 보존.

## Design Bar / Quality Bar

- TypeScript 0 errors. ESLint 0 errors / 0 warnings.
- Rust: `cargo test --lib` pass, `cargo clippy -D warnings` clean.
- vitest 모든 테스트 통과 (예상 ≥ 2945 — 신규 hook + dialog 케이스 추가분).
- dry-run 실패 메시지 카피는 backend 의 `"statement K of N failed: ..."` 와 1:1
  일치 — preview 와 commit 시 동일 에러 출력.
- `executeQueryDryRun` lib wrapper / hook / dialog 의 query_id 는 commit-path
  query_id 와 충돌 없도록 구분 prefix (예: `"dry:" + uuid`).

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 errors.
2. `pnpm lint` — 0 errors / 0 warnings.
3. `pnpm vitest run` — 모든 테스트 통과. 신규 `AC-247-*` 매핑 명시.
4. `cargo test --lib --manifest-path src-tauri/Cargo.toml` — 신규 dry-run unit
   tests 포함 통과.
5. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — clean.
6. `rg "execute_query_dry_run" src-tauri/src/lib.rs` → 1 (handler 등록 확인).
7. `rg "executeQueryDryRun" src/lib/tauri/index.ts` → 1 (re-export 확인).

### Required Evidence

- Generator must provide:
  - 변경 / 신규 / 삭제 파일 목록 + 1줄 의도.
  - 위 7 checks 의 stdout/stderr 발췌.
  - `[AC-247-*]` ↔ 테스트 파일:라인 매핑 표.
  - PG dry-run 본문 인용 (BEGIN → 실행 → ROLLBACK 흐름 확인).
  - dialog 의 `<DryRunPreview>` mount 시점이 `open=true` 일 때만 IPC 호출함을
    증명하는 코드 인용.
  - 가정 / 잔여 위험 (예: NOW() 같은 시간 의존 statement 의 dry-run vs commit
    결과 차이, MySQL/SQLite Unsupported fallback 사용자 경험).
- Evaluator must cite:
  - 각 AC 항목별로 테스트 파일:라인 또는 코드 위치.
  - PG dry-run 의 ROLLBACK 호출이 실제 코드에 존재하는지 verbatim 확인.
  - 호출자 15곳 모두 신규 prop (`connectionId`, `statements`, `paradigm`) 추가
    여부 grep 으로 확인.

## Test Requirements

### Unit Tests (필수)

- `useDryRun.test.ts` — 5 케이스 (`AC-247-H1..H5`).
- `ConfirmDestructiveDialog.test.tsx` — 4 신규 케이스 (`AC-247-D8..D11`) 추가.
  기존 7 (`AC-246-D1..D7`) 케이스는 새 prop (`connectionId="c"`, `statements=[]`,
  `paradigm="rdb"`) 디폴트 주입하여 통과 유지.
- `query.rs` 의 `mod tests` — 6 신규 dry-run 케이스 (`AC-247-B1..B6`).
- `traits.rs` default impl 검증은 mock RdbAdapter 의 default 사용 확인 (`AC-247-B7`).

### Coverage Target

- 변경 / 신규 파일: 라인 70% 이상.
- 전체 CI: 라인 40% / 함수 40% / 브랜치 35% (현재 통과 기준 유지).

### Scenario Tests (필수)

- [x] Happy path — rdb + 정상 statement → dry-run success → preview 렌더.
- [x] 에러/예외 — statement K of N failed → preview error → commit 시도 안
  하고 dialog 에 에러 노출.
- [x] 경계 조건 — empty statements 거부, document paradigm fallback,
  paradigm 토글, dialog open/close 토글에 따른 IPC 호출 count.
- [x] 회귀 없음 — 기존 commit-path (`executeQueryBatch`) 동작 변경 0,
  Phase 2 dialog 헤더 / Yes/No 동작 보존.

## Test Script / Repro Script

```bash
git diff --stat HEAD

# 1. TypeScript / Lint
pnpm tsc --noEmit
pnpm lint

# 2. 변경 영역 타겟 테스트
pnpm vitest run \
  src/hooks/useDryRun.test.ts \
  src/components/workspace/ConfirmDestructiveDialog.test.tsx \
  src/components/rdb/DataGrid.editing.test.tsx \
  src/components/datagrid/useDataGridEdit.safe-mode.test.ts \
  src/components/query/EditableQueryResultGrid.safe-mode.test.tsx \
  src/components/query/QueryTab.safe-mode.test.tsx \
  src/components/query/QueryTab.document.test.tsx \
  src/components/schema/DropTableDialog.test.tsx \
  src/components/schema/DropColumnDialog.test.tsx \
  src/components/structure/ColumnsEditor.test.tsx \
  src/components/structure/ConstraintsEditor.test.tsx \
  src/components/structure/IndexesEditor.test.tsx

# 3. 전체 회귀
pnpm vitest run

# 4. Rust
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings

# 5. 등록 확인
rg "execute_query_dry_run" src-tauri/src/lib.rs
rg "executeQueryDryRun" src/lib/tauri/index.ts
```

## Ownership

- Generator: harness Generator agent (general-purpose)
- Write scope: 위 In Scope 의 Rust + TS 파일들. Out of Scope (dry-run 버튼 /
  단축키 / Cmd+Z) 변경 금지. dialog 헤더 / Yes/No 동작 변경 금지.
- Merge order: 단일 commit 권장 — 백엔드 + 프론트엔드 wiring 은 atomic.
  lefthook pre-commit 통과 필수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing: `yes` (전체 7 check).
- Acceptance criteria evidence linked in `handoff.md`.
- ADR 0022 본문 Phase 3 의 In Scope (dry-run preview wiring) 와 일관성 유지.
- 호출자 15곳 모두 새 prop 추가 — 누락 0.

# Refactor Sprint Plan (Draft) — 2026-05-19

본 문서는 `backlog.md` Top-15 + 보완 항목 (총 17 sprint draft) 의 contract template stub.
Top 5 (sprint-403~407) 은 자세히, 6~17 은 간략. 실제 sprint 진입 전 `docs/sprints/sprint-N/` 으로 옮기고 contract finalize.

Sprint 당 < 800 LOC churn target. Risk 등급 H 인 sprint 는 wave 분할 가능 (phase 1/2).

---

## sprint-403 — sprint-392 sqlSafety kind/severity drift 정정

**문제**: sprint-392 contract 는 `dml-insert/info` (additive, 비-destructive) 라 명세했는데 impl 은 `kind: "insert"` + `severity: "warn"` (`src/lib/sqlSafety.ts:283`). 사용자-가시 warn dialog 가 떠서 contract 와 행동 불일치. sprint-394 (`ddl-*`) / sprint-395 (`permission-*`) 는 prefix 유지 — 392 만 outlier.

**트레이서 불릿**:
- INSERT/UPDATE/DELETE 가 `kind: "dml-insert"/"dml-update"/"dml-delete"` 로 분류된다
- INSERT 의 severity 는 `info` (warn 없음, 자동 실행)
- UPDATE/DELETE 의 severity 는 `warn` 유지 (변경 없음)
- 회귀 test: `sqlSafety.test.ts` 가 새 prefix 와 severity 모두 검증

**AC**:
- AC-403-01: `classify("INSERT INTO t VALUES (1)")` → `{ kind: "dml-insert", severity: "info" }` ✓
- AC-403-02: `classify("UPDATE t SET a=1")` → `{ kind: "dml-update", severity: "warn" }` ✓
- AC-403-03: `classify("DELETE FROM t")` → `{ kind: "dml-delete", severity: "warn" }` ✓
- AC-403-04: sprint-392 contract 의 line 25 / 188 / 245 내부 모순 해결 (한 prefix 로 통일)
- AC-403-05: TS callsite `lib/safeMode.ts` / `useQueryExecution.ts` 의 분기 모두 새 kind 와 정합
- AC-403-06: e2e: insert 실행 시 confirm dialog *뜨지 않음* (contract `info` 의도)

**Dependency**: 없음 (isolated).
**Risk**: L. 사용자-가시 행동 변화지만 contract 가 이미 명시한 의도. 회귀 test 로 보호.
**LOC**: < 150.

---

## sprint-404 — Quick-win pack: parse_db_type lift + dead code 정리

**문제**: audit 02 의 mechanical 정리 + audit 07 의 `InMemoryKeyringBackend` test gate.

**트레이서 불릿**:
- `DatabaseType::from_str("postgres")` → `Ok(DatabaseType::Postgres)` 작동
- `snapshot.rs` 의 inline 5-branch match 가 `parse_db_type` 호출로 교체
- 미사용 export 6개 (LogoMark / calcDefaultColWidth / isRecordArray / ConfirmDialog shim / 2 default exports) 가 삭제됨
- `InMemoryKeyringBackend` 가 release binary 에 없음 (`cargo build --release` 후 `nm` 확인)
- `lib/sql/stripSqlComments.ts` 가 신설되어 `handleExecute` / `handleDryRun` 양쪽에서 호출

**AC**:
- AC-404-01: `cargo test parse_db_type` 통과 (5 variant + invalid 케이스 1)
- AC-404-02: `tsc --noEmit` 통과 (dead export 제거 후 import 누락 0)
- AC-404-03: `cargo build --release` 산출 binary 에 `InMemoryKeyringBackend` symbol 없음
- AC-404-04: `useQueryExecution.ts:1906-1909` 와 `:2079-2082` 가 `stripSqlComments` helper 호출로 대체
- AC-404-05: 회귀: 모든 기존 test pass

**Dependency**: 없음.
**Risk**: L. 모두 mechanical, test 커버 양호.
**LOC**: < 200.

---

## sprint-405 — IPC 안정성: cancel_query_native typed variant + query_table_data cancel-token

**문제**:
1. `cancel_query_native` 가 `AppError::Database(json_of_CancelError)` 로 JSON-in-string 리턴. TS `parseCancelError` 가 `"Database error: "` prefix strip + JSON parse 로 복원. 미래에 PG 의 진짜 `AppError::Database("{...}")` 가 우연히 JSON 형태면 misparse — fragile landmine.
2. `query_table_data` 의 inherent method (PG `queries.rs:545`, MySQL `queries.rs:399`) 에 cancel_token 없음. trait layer (`postgres.rs:185`, `mysql.rs:171`) 에서 `tokio::select!` 로 추가. inherent 호출자는 cancel 우회.

**트레이서 불릿**:
- `AppError::Cancel(CancelError)` variant 추가 (serde tag/payload)
- TS `parseCancelError` 는 `error.type === "Cancel"` 분기로 단순화 (prefix-strip 제거)
- `query_table_data` inherent signature 에 `cancel: Option<&CancellationToken>` 추가, trait impl 의 `tokio::select!` 가 inherent 내부로 이동
- 회귀 test: cancel 시나리오가 inherent 호출 / trait 호출 둘 다에서 동일 동작

**AC**:
- AC-405-01: `AppError::Cancel` variant 가 `#[serde(tag = "type")]` 로 직렬화됨
- AC-405-02: TS `parseCancelError` 가 prefix-strip 없이 `type === "Cancel"` 검사로 작동
- AC-405-03: `query_table_data(_, _, _, _, _, _, _, Some(token))` 가 token cancel 시 5초 이내 종료
- AC-405-04: 기존 cancel e2e test (cancel_pg.rs, cancel_mysql.rs) pass
- AC-405-05: 미래의 `AppError::Database("{...}")` 회귀 시나리오 unit test 추가 (typed variant 가 정확히 분기)

**Dependency**: 없음.
**Risk**: M. wire shape 변경 (typed error), TS 보조 path 영향. 하지만 cancel 은 isolated.
**LOC**: < 300.

---

## sprint-406 — Test scaffold: @lib/tauri mock 단일화

**문제**: 96 사이트가 `vi.mock("@lib/tauri")` 또는 `vi.mock("@/lib/tauri")` 호출. internal mock 369/429 (86%) 중 가장 큰 단일 target. TDD 룰 위반 (lib boundary 만 허용) — `@lib/tauri` 는 IPC facade (production indirection 이라 internal).

**트레이서 불릿**:
- `src/test-setup.ts` 가 `@lib/tauri` default stub 을 글로벌 제공 (모든 IPC fn → reject by default)
- 테스트별로 `setupTauriMock({ listConnections: () => Promise.resolve([...]) })` 같은 override helper 제공
- 기존 96 `vi.mock("@lib/tauri")` 사이트가 helper 호출로 마이그레이션
- regression: `pnpm test` 전체 통과

**AC**:
- AC-406-01: `setupTauriMock(overrides)` helper 가 export 됨 (`src/test-utils/tauriMock.ts`)
- AC-406-02: default stub 은 unhandled IPC 호출에 대해 `throw new Error("unmocked: ${cmd}")` 던짐 (silent pass 방지)
- AC-406-03: 96 사이트 모두 helper 사용 (`vi.mock("@lib/tauri")` 직접 호출 0)
- AC-406-04: 전체 vitest suite pass + flaky 없음

**Dependency**: 없음.
**Risk**: M. 광범위 test 수정 — 한 사이트 미흡 시 silent test pass 위험. AC-406-02 의 default throw 가 guard.
**LOC**: < 500 (mostly test diff).

---

## sprint-407 — useQueryExecution.ts test scaffold (분할 보류)

**문제**: 2169 lines, 단일 hook, test 0. multi-DB query/mutation/mismatch/history/safe-mode 가 한 곳. 분할 전에 *test scaffold 부터* 가야 안전.

**트레이서 불릿**:
- `useQueryExecution.test.tsx` 가 신설되어 6개 핵심 시나리오 커버:
  1. RDB select 정상 실행 (handleExecute)
  2. RDB DDL/DML safe-mode dialog 분기
  3. MongoDB find 정상 실행
  4. Multi-statement batch 실행 + per-statement 결과
  5. Cancel 시나리오 (mid-execution token cancel)
  6. Mismatched activeDb 감지 + sync dialog
- 모든 IPC 는 `setupTauriMock` (sprint-406) 으로 stub
- 분할은 *별도 sprint* (-408 이후) — 본 sprint 는 test 전용

**AC**:
- AC-407-01: `pnpm test useQueryExecution` → 6개 시나리오 모두 green
- AC-407-02: production code 변경 0 (test scaffold only)
- AC-407-03: coverage report 가 `useQueryExecution.ts` 의 6개 핵심 path 커버 (≥ 60% line coverage)

**Dependency**: sprint-406 (`setupTauriMock` helper 필요).
**Risk**: M. 큰 hook 의 행동을 reverse-engineer 하면서 test 작성 → 실제 의도 misread 가능. 6개 시나리오는 *지금* 동작 freeze 가 목표 (refactor 의 safety net).
**LOC**: < 400 (test only).

---

## sprint-408 — DocumentDataGrid.tsx 분할 phase 1

**문제**: 1203L, 19 useState, 12 import categories, hot 38. Mongo full-support 의 hotspot.

**불릿/AC (간략)**:
- Bulk operations (`useMongoBulkOps`) 가 별도 sub-component (`DocumentDataGrid/BulkOps.tsx`) 로 분리
- Cell renderer 가 `cellRenderers/` 디렉토리로 분리
- 부모 component LOC < 700 (phase 1 목표, phase 2 에서 추가 분할)
- 회귀: Mongo e2e (insert/update/delete/bulk) 모두 pass
**Dependency**: sprint-406. **Risk**: H. **LOC**: < 600.

---

## sprint-409 — Wire convention: legacy Rust models camelCase 마이그레이션

**문제**: Sprint 336+ Rust 모델은 `rename_all="camelCase"`, 이전 모델 6개 (`QueryResult`, `QueryColumn`, `DocumentId`, `DocumentQueryResult`, `DocumentRow`, `ConnectionConfigPublic`) 는 snake_case 잔존. 양쪽 정합 but 어느 era 인지 외워야.

**불릿/AC (간략)**:
- 6 struct 에 `#[serde(rename_all = "camelCase")]` 추가
- TS 타입 6개 (`src/types/query.ts`, `src/types/document.ts`, `src/types/connection.ts`) 가 camelCase 필드로 마이그레이션
- snapshot/cache localStorage migration (`v6 → v7`) — 기존 snake_case payload 를 camelCase 로 변환
- 회귀: snapshot restore / query cache hit 모두 정합
**Dependency**: 없음. **Risk**: H (wire breaking). **LOC**: < 500.

---

## sprint-410 — workspaceStore.ts slice 분할 (tab/query/sidebar)

**문제**: 1016L, 10 hook export, 25+ action 평면 나열. 3 도메인 mix (tabs / query / sidebar).

**불릿/AC (간략)**:
- `workspaceStore/slices/tabSlice.ts` + `querySlice.ts` + `sidebarSlice.ts` 분리
- `combine` 으로 단일 store 유지 (ADR 0027 `(connId, db)` keying 보존)
- selector hooks 는 `workspaceStore/selectors.ts` 로 co-locate
- `vi.mock("@stores/workspaceStore")` 26 사이트가 slice-level 직접 import 으로 마이그레이션 가능 (internal mock 감소)
**Dependency**: sprint-406. **Risk**: M. **LOC**: < 700.

---

## sprint-411 — lib.rs plugin/command register 모듈화

**문제**: 793L, hot 78 (최고). 모든 wave-N PR 의 conflict 단골.

**불릿/AC (간략)**:
- `src-tauri/src/commands/registry.rs` 에 `register_all(builder)` fn 신설
- `lib.rs` 의 `setup_app` 이 `register_all(builder)` 한 줄 호출로 축약
- 향후 새 command 는 `registry.rs` 만 수정 → wave conflict 면적 축소
- 회귀: `tauri build` 후 모든 command invoke 정상
**Dependency**: 없음. **Risk**: M. **LOC**: < 400.

---

## sprint-412 — SQL WASM size budget governance

**문제**: sprint-385 ~ 395 동안 WASM raw 44→185 KB (4.13x), gzipped 21→64 KB (3.09x). 명시 budget 부재. mongo budget 50 KB gz 와 비교 28% 초과.

**불릿/AC (간략)**:
- `docs/sprints/sprint-N/contract.md` 템플릿에 `WASM budget` 섹션 추가 (예: SQL 80 KB gz, mongo 50 KB gz)
- CI script `scripts/check-wasm-size.sh` 가 budget 초과 시 fail
- README/CONTRIBUTING 에 budget 정책 1 문단
**Dependency**: 없음. **Risk**: L. **LOC**: < 100.

---

## sprint-413 — documentStore.ts catalog/query 분리

**문제**: 325L, catalog (databases / collections / fieldsCache) 와 query results (queryResults / aggregateResults) 가 한 store. lifecycle 다름 (catalog persistent, query transient + per-request id stale-guard).

**불릿/AC (간략)**:
- `documentCatalogStore` + `documentQueryStore` 분리
- query result stale-guard 가 catalog reload 와 독립
- 회귀: Mongo find/aggregate + catalog refresh 모두 정합
**Dependency**: sprint-406. **Risk**: M. **LOC**: < 400.

---

## sprint-414 — useDataGridEdit.ts per-paradigm slice 분할

**문제**: 945L, 13 exports, hot 28, ratio 4.8 (테스트 폭증). edit FSM (preview / commit / dryRun) 이 RDB + Document 양쪽 paradigm 을 한 hook 에서 처리.

**불릿/AC (간략)**:
- `useRdbDataGridEdit` + `useDocumentDataGridEdit` 로 분리 (paradigm 별)
- 공통 FSM state machine 은 `dataGridEditFsm.ts` 로 추출 (pure)
- 기존 15+ split test 가 paradigm 별로 재분배 — internal mock 감소
**Dependency**: sprint-406, sprint-410. **Risk**: H. **LOC**: < 700.

---

## sprint-415 — Flaky 9건 → vi.useFakeTimers 전환

**문제**: real-`setTimeout(300ms/400ms/50ms/100ms)` 의존 9건 (TS 8 + Rust 3). pre-push 부하 시 race 위험.

**불릿/AC (간략)**:
- TS 8건이 `vi.useFakeTimers` + `vi.advanceTimersByTime` 으로 결정성 확보
- Rust 3건 (`cancel_mysql`, `query_integration`, `cancel_pg`) 의 `sleep(100ms)` 은 `tokio::time::pause()` + manual advance
- CI 10회 반복 실행 → 모두 green
**Dependency**: 없음. **Risk**: L. **LOC**: < 300.

---

## sprint-416 — models/schema.rs DBMS 별 분리

**문제**: 1625L, 31 exports. DB-agnostic 스키마 model union.

**불릿/AC (간략)**:
- `models/schema/rdb.rs` + `models/schema/document.rs` + `models/schema/common.rs` 분리
- pub use re-export 로 backward-compat
**Dependency**: sprint-409 (wire convention 통일 후). **Risk**: M. **LOC**: < 700.

---

## sprint-417 — raw_where AST 검증 (sqlparser)

**문제**: audit 07 P2. `raw_where` blocklist (`;` + DDL/DML prefix) 가 `--` / `/* */` 주석 + UNION SELECT 통과.

**불릿/AC (간략)**:
- `validate_raw_where` 가 `sqlparser` 로 single bool-expr AST 파싱
- AST top-level 이 `Expr::BinaryOp` / `Expr::Function` 등 boolean expression 만 허용
- UNION / SELECT / subquery containing `;` 모두 reject
- 회귀: 기존 정상 `raw_where` (예: `id > 100 AND name LIKE 'foo%'`) 통과
**Dependency**: 없음. **Risk**: M. **LOC**: < 200.

---

## sprint-418 — Hook bypass 클로저

**문제**: audit 07 P1. base64 pipe + flag-in-var + char-by-char eval + script-via-base64 + env pseudo-arg + variable-assembled `--no-verify` — 5~6 bypass 패턴.

**불릿/AC (간략)**:
- `scripts/hooks/check-dangerous-bash.sh` 에 추가 패턴:
  - `base64[[:space:]]+-d.*\|[[:space:]]*(bash|sh|zsh)` (base64 pipe)
  - `eval[[:space:]]*\$\(` (char-by-char + cmd substitution)
  - `git[[:space:]]+(reset|checkout)[[:space:]]+.*(FETCH_HEAD|ORIG_HEAD|@\{u\}|origin/)` (target-only)
- 회귀 test: `tests/hooks/` 에 bypass 시나리오 + 정상 시나리오 둘 다 추가 (`git log FETCH_HEAD` 같은 benign 케이스도)
**Dependency**: 없음. **Risk**: L. **LOC**: < 100.

---

## sprint-419 — rdb/DataGrid.tsx 분할

**문제**: 915L, 15 useState, store 10. Coupling audit 의 별도 지목 (line<800 기준 밖).

**불릿/AC (간략)**:
- `DataGrid/header`, `DataGrid/body`, `DataGrid/toolbar` 분리
- store reference 가 selector hook 1~2개로 응축 (10 → ~3)
- 회귀: RDB query result rendering + edit + sort + filter 모두 정합
**Dependency**: sprint-406, sprint-410. **Risk**: H. **LOC**: < 700.

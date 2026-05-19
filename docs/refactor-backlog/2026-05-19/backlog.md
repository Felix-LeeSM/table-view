# Refactor Backlog — 2026-05-19

7-domain audit (god-file / duplicates-dead / consistency / test-debt / coupling / operational / security) 결과 종합. 우선순위 매트릭스 + sprint 분할 plan.

원본: `/tmp/audit-2026-05-19/{01..07}-*.md` (read-only).
Score: `Impact*3 − Risk*2 − Effort*1` (H=3, M=2, L=1). 동점 시 dependency 적은 쪽 우선.

---

## 1. Top-15 우선순위 매트릭스

| Rank | Item | Source | Impact | Risk | Effort | Score | Recommended sprint |
|------|------|--------|--------|------|--------|-------|---------------------|
| 1 | sprint-392 sqlSafety kind/severity drift 정정 (`dml-*` prefix + `info` severity) | 06 | H(3) | L(1) | S(1) | 6 | sprint-403b (contract realign + 회귀 test) |
| 2 | `parse_db_type` lift + `FromStr` impl (Group F) | 02 | M(2) | L(1) | S(1) | 3 | sprint-404 — quick-win pack ① |
| 3 | TS `dead export` 6건 일괄 삭제 (LogoMark, calcDefaultColWidth, isRecordArray, ConfirmDialog shim, default exports) | 02 | M(2) | L(1) | S(1) | 3 | sprint-404 — quick-win pack ② |
| 4 | `cancel_query_native` JSON-in-string → 타입화된 `AppError::Cancel` variant | 03 | H(3) | M(2) | S(1) | 4 | sprint-405 (IPC 안정성) |
| 5 | `query_table_data` inherent 에 `cancel_token` 합치기 (PG/MySQL) | 03 | M(2) | L(1) | S(1) | 3 | sprint-405 (같은 묶음) |
| 6 | `@lib/tauri` mock 단일화 (96 사이트) — `test-setup.ts` 기본 stub + per-test override | 04 | H(3) | M(2) | M(2) | 3 | sprint-406 (test-debt phase 1) |
| 7 | `useQueryExecution.ts` (2169L, hot 20, test 0) — test scaffold + 1차 분할 | 01,04 | H(3) | H(3) | L(3) | 0 | sprint-407 (test 먼저, 분할 보류) |
| 8 | `DocumentDataGrid.tsx` (1203L, 19 useState, hot 38) 분할 phase 1 | 01,05 | H(3) | H(3) | M(2) | 1 | sprint-408 |
| 9 | Legacy Rust models `rename_all = "camelCase"` 통일 (QueryResult/QueryColumn/DocumentId/DocumentQueryResult/DocumentRow/ConnectionConfigPublic) | 03 | H(3) | H(3) | M(2) | 1 | sprint-409 (wire contract — TS 동시 마이그레이션) |
| 10 | `workspaceStore.ts` (1016L, 10 hook export) slice 분할 (tab/query/sidebar) | 05 | H(3) | M(2) | M(2) | 3 | sprint-410 |
| 11 | `lib.rs` (793L, hot 78) — plugin/command register 모듈화 (`commands/registry.rs`) | 01 | H(3) | M(2) | M(2) | 3 | sprint-411 |
| 12 | SQL WASM size budget 명시 + sprint contract 룰 (80 KB gz cap) | 06 | M(2) | L(1) | S(1) | 3 | sprint-412 (가벼운 governance) |
| 13 | `documentStore.ts` catalog/query 분리 | 05 | M(2) | M(2) | M(2) | 0 | sprint-413 |
| 14 | `useDataGridEdit.ts` (945L, ratio 4.8) per-paradigm slice 분할 + internal mock 감소 | 01,04 | H(3) | H(3) | M(2) | 1 | sprint-414 |
| 15 | Real-`setTimeout` flaky 9건 → `vi.useFakeTimers` 전환 | 04 | M(2) | L(1) | M(2) | 2 | sprint-415 |

Impact = 사용자 가치 + 안전성 + 유지보수성 종합.
Risk = 실수 시 회귀 폭 (H=hot path/wire contract 변경, M=test 커버됨, L=mechanical).
Effort = sprint 단위 (S < 200 LOC, M < 800 LOC, L = 다중 sprint 필요).

순위 7~9 가 score 0~1 로 낮게 보이지만 — *Impact 높지만 Risk + Effort 도 높음* — 의도적 시그널. 이런 항목은 미루지 말고 **test scaffold 부터** 가는 게 backlog 핵심 권고.

---

## 2. 카테고리별 핵심

### 2.1 God files (audit 01)

- `useQueryExecution.ts` (2169L, test 0) — *현재 코드베이스 최고 위험*. multi-DB query/mutation/mismatch/history/safe-mode 가 한 hook. **refactor 전 test scaffold 필수** (sprint-407).
- `DocumentDataGrid.tsx` (1203L, 19 useState, 12 cats, hot 38) — Mongo full-support 의 단골 hotspot. 단계적 분할 (cell render / bulk ops / index panel).
- `lib.rs` (793L, hot 78) — Tauri entry, 모든 wave-N PR 의 conflict 단골. command/plugin register 를 별도 모듈로.
- `models/schema.rs` (1625L, 31 exports) — DBMS 별 schema model union. 분리는 안전 (test 커버 양호).
- `useDataGridEdit.ts` (945L, hot 28, ratio 4.8) — edit FSM. per-paradigm split.
- `rdb/DataGrid.tsx` (915L, 15 useState, store 10) — coupling audit 도 별도 지목.
- `commands/rdb/schema.rs` (1445L, 14 exports, 210 await) — DDL/introspection 분리.
- 분류 C 는 *분할 X*: `parser.rs` (8765L, grammar), `postgres/mutations.rs` (4129L), `postgres/schema.rs` (1912L), `mongodb/schema.rs` (1588L) — 단일 concern, 분류상 god 아님.

### 2.2 Duplicates / dead code (audit 02)

- Duplicate top 5: **Group F** (`parse_db_type` lift, mechanical), **Group B** (`strip_*` PG↔MySQL byte-identical), **Group C** (`select_eviction_target`), **Group E+I** (`quote_ident` trait), **Group G** (TS comment-strip lambda).
- Dead code: TS 10건 (`LogoMark`, `calcDefaultColWidth`, `isRecordArray`, `ConfirmDialog` shim, default exports 2개, `AggregateBody`, `RelationalDatabaseType`, `isQueryHistoryEnabled`, `registerStateChangedListener`). 모두 안전 제거.
- 후순위: Group A (`validate_identifier`, cap 다름), Group D (`switch_active_db`, sqlx type 분기). Trait/generic 비용 큼.
- TODO/FIXME/HACK 본 코드 0건 (의도된 `hack` 주석 1건만, 의식적 trade-off).

### 2.3 Consistency drift (audit 03)

- **Wire convention split (HIGH)**: Sprint 336+ Rust models 는 `rename_all="camelCase"`, 그 이전 모델 (`QueryResult`, `QueryColumn`, `DocumentId`, `DocumentQueryResult`, `DocumentRow`, `ConnectionConfigPublic`) 은 snake_case 잔존. 양쪽 다 작동하지만 reviewer 가 어느 era 인지 외워야 함.
- **TS `kind` discriminator 내부 inconsistency**: safe-mode (`ddl-drop`, kebab), paradigm adapter (`obj`/`arr`, lowercase), BulkWriteOp (`updateOne`, camelCase). 1-page convention doc.
- `cancel_query_native` JSON-in-string fragile wire — typed variant 으로 promote.
- `query_table_data` inherent 에 cancel 없음 — trait 만 가짐, "trait-only cancel" silent invariant.
- `list_databases` PG/MySQL `Vec<SchemaInfo>` vs Mongo `Vec<NamespaceInfo>` 변환 shim — 한쪽으로 통일.

### 2.4 Test debt (audit 04)

- 0% TS 파일 107개 (32% of prod). Top: `lib/tauri/document.ts` (592L), `useSchemaTreeActions.ts` (517L), `useDataGridPreviewCommit.ts` (476L), `useMongoBulkOps.ts` (245L).
- 0% Rust 14개 — 8개는 re-export. 진짜 위험은 `db/traits.rs` (1061L) + `lib.rs` (793L) — integration 으로 간접 커버.
- Internal mock 369/429 (~86%) — TDD 룰 위반 폭. Top: `@lib/tauri` 96 사이트, `@stores/workspaceStore` 26, `@stores/schemaStore` 23.
- Test/prod ratio top: `SchemaTree.tsx` 13.4, `QueryTab.tsx` 11.2 — children mock 폭증 = god component 의 증상.
- Flaky 9건 (real-`setTimeout` 의존). 특히 `StructurePanel.columns(300ms)` 와 `CreateTriggerDialog(400ms)`.

### 2.5 Coupling (audit 05)

- Deep import 0건, Rust `pub(crate)` 131건 — module 위생 양호.
- Container god 9개 (`ImportExportDialog` 495L/14 useState, `StructurePanel` 472L, `ConnectionItem` 368L, `DbSwitcher` 358L, `RenameTableDialog`, `ConnectionDialog`, `DropTableDialog`, `AddDocumentModal`, `TabDbChip`). 기존 hook (`useDdlPreviewExecution`, `useConnectionLifecycle`) 재사용으로 lean 가능.
- Multi-hook export: `workspaceStore.ts` 만 10개 (위반). `src/hooks/**` 는 1-file-1-hook 엄격.
- Multi-domain store: `workspaceStore` (tabs+query+sidebar, 1016L), `documentStore` (catalog+query, 325L).

### 2.6 Operational (audit 06)

- **Sprint-392 sqlSafety drift (HIGH)**: contract `dml-insert/info` vs impl `kind:"insert"`/`severity:"warn"`. severity drift = 사용자-가시 dialog 행동 변화. sprint-394/395 는 prefix 유지, 392 만 inconsistent.
- WASM raw 44 KB → 185 KB (4.13x, 6 sprints) — 선형 증가, 가속도 없음. gzipped 64 KB 는 mongo budget 50 KB 와 비교용. SQL budget 명시 부재.
- Memory cap 임박 0건 (`git-policy/memory.md` 194/200 가장 가까움). 즉시 액션 X, 모니터링만.
- `docs/` 단발 md 8개 누적 — `docs/sprints/` 외 정책 검토 후보.

### 2.7 Security (audit 07)

- Production unwrap on user input: **0건**. `InMemoryKeyringBackend` `expect("mutex poisoned")` 는 test helper 인데 `pub` + 무조건 컴파일 → release binary 에 들어감. `#[cfg(test)]` gate.
- Secret literal 0건 (test fixture 만).
- **Hook bypass 6건**: base64 pipe, flag-in-var, char-by-char eval, script-via-base64, env pseudo-arg, `--no-verify` variable-assembled. `grep -qiE` 모델의 근본 한계. 절반은 closeable (regex 강화).
- **SQL injection 1**: `raw_where` blocklist 불완전 — `--`/`/* */` 주석, UNION SELECT 통과. `sqlparser` 로 single bool-expr AST 만 허용하거나 기능 제거.

---

## 3. Sprint 분할 plan (draft)

각 sprint = 한 file/영역 또는 묶음. Sprint 당 < 800 LOC churn target.
Detail (트레이서 / AC / dependency / risk) 는 `sprint-plan.md` 참조.

| sprint | 영역 | LOC churn (예상) | Risk | Depends on |
|--------|------|-------------------|------|------------|
| sprint-403b | sprint-392 sqlSafety kind/severity drift 정정 | < 150 | L | — |
| sprint-404 | Quick-win pack: `parse_db_type` lift + dead-export 6건 + `InMemoryKeyringBackend` gate | < 200 | L | — |
| sprint-405 | IPC 안정성: `cancel_query_native` typed variant + `query_table_data` cancel-token | < 300 | M | — |
| sprint-406 | Test scaffold: `@lib/tauri` mock 단일화 (96 사이트) | < 500 | M | — |
| sprint-407 | `useQueryExecution.ts` test scaffold (분할 보류) | < 400 (test only) | M | 406 |
| sprint-408 | `DocumentDataGrid.tsx` 분할 phase 1 (bulk ops 분리) | < 600 | H | 406 |
| sprint-409 | Wire convention: legacy Rust models camelCase 마이그레이션 | < 500 | H | — |
| sprint-410 | `workspaceStore.ts` slice 분할 (tab/query/sidebar) | < 700 | M | 406 |
| sprint-411 | `lib.rs` plugin/command register 모듈화 (`commands/registry.rs`) | < 400 | M | — |
| sprint-412 | SQL WASM size budget governance + sprint contract 룰 추가 | < 100 | L | — |
| sprint-413 | `documentStore.ts` catalog/query 분리 | < 400 | M | 406 |
| sprint-414 | `useDataGridEdit.ts` per-paradigm slice 분할 | < 700 | H | 406, 410 |
| sprint-415 | Flaky 9건 → `vi.useFakeTimers` 전환 | < 300 | L | — |
| sprint-416 | `models/schema.rs` (1625L, 31 exports) DBMS 별 분리 | < 700 | M | 409 |
| sprint-417 | SQL injection: `raw_where` AST 검증 (sqlparser) | < 200 | M | — |
| sprint-418 | Hook bypass 클로저: base64 pipe + target-only regex + `eval $(`) | < 100 | L | — |
| sprint-419 | `rdb/DataGrid.tsx` (915L, 15 useState) 분할 | < 700 | H | 406, 410 |

---

## 4. Quick wins (< 100 LOC, low risk, high signal)

별도 묶음 — sprint-404 에 흡수 가능:

- **`parse_db_type` lift** (audit 02 Group F) — `models/connection.rs` 에 `impl FromStr for DatabaseType`. snapshot.rs 의 inline match 삭제. mechanical.
- **Dead export 6건 삭제**: `LogoMark` (Logo.tsx:5), `calcDefaultColWidth` (columnUtils.ts:53), `isRecordArray` (queryHelpers.ts:42), `ConfirmDialog` shim re-export (ConfirmDialog.tsx:8), `HistoryRetentionSelect` default export, `dialog-shell` default export. ts-prune 확인됨.
- **`InMemoryKeyringBackend` `#[cfg(test)]` gate** (audit 07) — release binary 에서 `expect("mutex poisoned")` 패닉 경로 제거.
- **`Group G` TS comment-strip lambda** (handleExecute / handleDryRun) — `src/lib/sql/stripSqlComments.ts` 신설.
- **`docs/explorations/` archive 정책** — 4 file 정리 (2026-05-15~18 작성, sprint contract 화 또는 archive).

총 churn < 200 LOC. 한 sprint 묶음 (sprint-404) 또는 별개 chore PR 로 처리 가능.

---

## 5. 보류 / 토론 필요

- **`parser.rs` 8765L** — audit 01 분류 C. Grammar generated-style 단일 concern, 분할 X.
- **`postgres/mutations.rs` 4129L** + `postgres/schema.rs` 1912L + `mongodb/schema.rs` 1588L + `mysql/mutations.rs` 1113L — 모두 분류 C, 단일 DBMS 의 driver impl, 분할 우선순위 낮음.
- **`SchemaTree.tsx` (432L, test ratio 13.4)** — children mock 폭증의 전형. 분할은 큰 작업 — sprint-419 이후 별도 묶음 (state-management 24-sprint plan 과 충돌 가능성 검토 필요).
- **`db/traits.rs` 1061L** — DBMS trait union. DBMS 마다 touch 필요한 구조, 분할 어려움. audit 01 도 분할 비추.
- **Group D `switch_active_db`** + **Group A `validate_identifier`** — sqlx type / cap 차이로 trait extraction 비용 큼. ROI 낮음, 후순위.
- **TS `kind` discriminator 통일** (audit 03) — 1-page convention doc 필요. 결정 grill 선행 (kebab vs lowercase vs camelCase) → sprint-409 wire convention 작업과 묶거나 별도 governance sprint.
- **State-management 24-sprint plan (Sprint 353–376)** — auto-memory `project_state_management_sprints` 와 본 backlog 의 sprint-410 (`workspaceStore` slice) / sprint-413 (`documentStore`) 의 중복/충돌 가능성. 우선순위 결정 필요.

---

## 6. 메모리 cap 임박 (audit 06)

즉시 액션 불필요 (cap 위반 0). 모니터링:

- `memory/workflow/git-policy/memory.md` — 194/200 (–6). 다음 +7 lines 추가 시 split.
- `memory/workflow/review/memory.md` — 149/200 (–51).
- `memory/conventions/testing-scenarios/memory.md` — 141/200 (–59).

split 시 sub-directory + 하위 `memory.md` index (200줄 cap 룰 유지).

---

## 7. 결정 필요 사항 (PR 본문에 명시)

1. **Backlog vs dialect sprint 우선순위** — sprint-396+ (grammar 계속) vs sprint-403b, 404+ (refactor backlog). 두 트랙 병행 시 wave-N 의 wire contract 변경 (sprint-409) 이 grammar sprint 와 conflict 가능.
2. **Wire convention 통일 (sprint-409) 의 BC**: snake_case → camelCase 마이그레이션은 frontend snapshot/cache breaking. migration shim 필요 vs hard cutover.
3. **State-management 24-sprint plan 흡수 여부**: sprint-410 (`workspaceStore`) / sprint-413 (`documentStore`) 가 기존 plan 의 Wave 와 정합되는지 확인 필요.
4. **Quick-win 묶음 (sprint-404)**: 단일 PR 로 묶을지 별도 chore PR 로 분리할지.

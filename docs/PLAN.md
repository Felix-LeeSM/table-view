# Table View — Master Plan

## 프로젝트 목적

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

**판단 기준**: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

초기 DBMS는 PostgreSQL. 아키텍처는 다중 DBMS 확장을 전제로 설계.

## 현재 상태

Phase 1–4 완료 (Sprint 24–54 PASS). Phase 5–11 부분 진행. **Phase 12 완료(2026-04-27, Sprint 150–155)** — launcher/workspace 별도 `WebviewWindow` + 5 store cross-window IPC sync + 실제 lifecycle wiring + ADR 0011 → 0012 supersede + RISK-025 resolved.

최근 closure 기준: **Phase 13–17, 21–23, 27 종료**. Phase 18–20
(MariaDB / SQLite / Oracle) 은 보류. 현재 다음 후보는 Phase 28 (MongoDB
Full Support 후속 / parser consolidation), Phase 31 (Language Completion
Architecture), 2026-05-19 refactor backlog
(`docs/refactor-backlog/2026-05-19/`) 이다.

## 방향 결정 (2026-05-01)

**TablePlus 패리티 우선, 신규 DBMS 추가는 보류.** PostgreSQL + MongoDB 두 패러다임 위에서 TablePlus의 데일리 워크플로(grid export · row inline edit · DDL UI · Safe Mode)를 닫는 것이 최우선. **Phase 17 (MySQL)은 Sprint 276–296 sequence 로 retrospective closure 됐고, Phase 18–20 (MariaDB / SQLite / Oracle 어댑터)은 계속 보류**한다.

### 작업 순서 (Impact 큰 순) — Phase 21–27

1. **Phase 21** — CSV / SQL / JSON Export (단판승)
2. **Phase 22** — Row 인라인 편집 RDB 완성 + Preview/Commit/Discard 게이트 (#3~#7 의 공통 인프라)
3. **Phase 23** — Safe Mode (프로덕션 가드)
4. **Phase 24** — Index Write UI
5. **Phase 25** — Constraint Write UI
6. **Phase 26** — Trigger 관리
7. **Phase 27** — Table / Column DDL UI (패리티 달성 마일스톤)

근거: [`docs/tableplus-comparison.md`](tableplus-comparison.md) Section H/I.

### 사용자 피드백 후속 작업 (2026-05-01 채집)

Sprint 187 직후 사용자 피드백 5건 분석. UI 폴리시 (info popover / 색깔 정리
/ history 진입점) 는 비-스프린트 hotfix 한 commit 으로 즉시 반영 — 별도
sprint 등록 불필요. 나머지 4건은 신규 sprint 로 분할:

| ID | 항목 | 소속 | 우선 sprint 후보 |
|----|------|------|------------------|
| FB-1b | production 환경 자동 SafeMode 활성화 (Hard auto 정책) | Phase 23 closure 후 | Sprint 190 |
| FB-3  | DB 단위 export (`pg_dump` / `mongodump` equivalent + Sidebar 진입점) | Phase 21 후속 | Sprint 192 |
| FB-4  | Quick Look 편집 모드 (`useDataGridEdit` 와 합류) | Phase 22 후속 | Sprint 194 |
| FB-5b | Query history source 필드 + 범위 확장 (raw / grid-edit / ddl-structure / mongo-* 통합 audit) | Phase 23 후속 | Sprint 196 |

각 항목은 진입 sprint 작성 시 별 contract 로 옮겨 ADR / AC 세분화. 본 표는
Phase 23 (Sprint 188 = Mongo dangerous-op) 종료 후 우선순위 재평가의 1차
입력값이다.

### 리팩토링 sequencing (Sprint 189–198, 종료)

Phase 23 종료 직후 Sprint 189–198 의 10단계 — refactor-only sprint
(홀수) 와 feature/FB sprint (짝수) 를 인터리브하여 각 refactor 가 바로
다음 feature sprint 의 dependency 를 정리하는 패턴으로 진행. 2026-05-02
Sprint 198 종료로 sequencing 완료, 시한부 docs (`refactoring-plan.md` /
`refactoring-smells.md`) retire.

| # | Sprint | 종류 | 내용 |
|---|--------|------|------|
| 1 | 189 | refactor | Phase 23 closure — RDB 5 사이트 inline gate → `useSafeModeGate` |
| 2 | 190 | feature  | FB-1b production 환경 자동 SafeMode |
| 3 | 191 | refactor | SchemaTree 분해 (Sprint 192 export entry-point 의존) |
| 4 | 192 | feature  | FB-3 DB 단위 export |
| 5 | 193 | refactor | `useDataGridEdit` 분해 (Sprint 194 Quick Look 편집 의존) |
| 6 | 194 | feature  | FB-4 Quick Look 편집 |
| 7 | 195 | refactor | `tabStore` intent actions (Sprint 196 history source 필드 의존) |
| 8 | 196 | feature  | FB-5b query history source 필드 |
| 9 | 197 | refactor | `mongodb.rs` 4분할 (Sprint 198 bulk-write 신규 명령 의존) |
| 10 | 198 | feature | Mongo bulk-write 신규 (`delete_many` / `update_many` / `drop_collection`). **Phase 신설 안 함** — Phase 24 = Index Write UI 와 명명 충돌 회피 위해 sprint 단위로 처리. |

각 sprint 의 결정 / AC / handoff 는 `docs/sprints/sprint-189` ~
`sprint-198` 의 `contract.md` / `findings.md` / `handoff.md` 가 source
of truth. 코드 작성 표준: [`memory/conventions/refactoring/memory.md`](../memory/conventions/refactoring/memory.md) (영속).

### 리팩토링 sequencing (Sprint 199–209, post-198 cycle, **종료 2026-05-05**)

Sprint 198 종료 직후 wide-net 재스캔 결과 (`CODE_SMELLS.md`, 시한부) 를
입력값으로 새 cycle. 사용자 결정 (Sprint 202, 2026-05-05) — 인터리브 패턴
폐기, **refactor 연속** 으로 시한부 docs 의 7 카테고리 모두 처리 후 feature
backlog 진입. Sprint 199–209 종료 시 시한부 docs `CODE_SMELLS.md` retire
(이전 cycle 의 `refactoring-{plan,smells}.md` 처리와 동일 — commit
`0c64a1b` 패턴). 결정 / AC / handoff 는 각 sprint 의 contract / findings
/ handoff 가 source of truth.

| # | Sprint | 종류 | 입력 (CODE_SMELLS) | 내용 |
|---|--------|------|--------------------|------|
| 1 | **199** ✓ | refactor | §1-1 (frontend god file #1) | `SchemaTree.tsx` (2105) → entry + `SchemaTree/{rows,actions,dialogs}.tsx`. (commit `19ee81f`) |
| 2 | **200** ✓ | refactor | §1-1 (frontend god file #2)    | `DataGridTable.tsx` (1071) → entry + 6 sub-file. (commit `3b2b5b4`) |
| 3 | **201** ✓ | refactor | §1-1 (frontend god file #3)    | `QueryTab.tsx` (1040) → entry + 6 sub-file. (commit `c0ab92e`) |
| 4 | **202** ✓ | refactor | §1-2 (backend god file #1)     | `db/postgres.rs` (3803) → entry + 4 sub-file. mongodb.rs 패턴 답습. (commit `370c4ee`) |
| 5 | **203** ✓ | refactor | §3 (`any` / `as unknown as`)     | `useSqlAutocomplete.ts` 7곳 + `mongoAutocomplete.ts` 2곳. type narrowing only. (commit `5a3a693`) |
| 6 | **204** ✓ | refactor | §5 (console 정책)              | `src/lib/logger.ts` 신규 + DEV-only gate. console.* 13곳 → `logger.*`. `bootInstrumentation:187` 1곳 의도적 유지. (commit `3dead90`) |
| 7 | **205** ✓ | refactor | §4 (catch 정책)                 | silent `catch {}` 37곳 audit + 주석 누락 13곳 보강. DEV-log 필요 case 0건. localStorage helper 통일은 후속 candidate. (commit `3cfe92a`) |
| 8 | **206** ✓ | refactor | §6 (테스트 skip)                | e2e skip 16 → 2. placeholder 11 제거 + 파일 2개 삭제. outline 은 archive 보존. 잔존 2건 = env-conditional 정당. (commit `a7ab8df`) |
| 9 | **207** ✓ | refactor | §7 (Rust prod expect)            | prod `.expect` 5곳 → match + tracing + exit(1) (lib.rs 2곳) / let-else / if-let 디펜시브 (invariant 3곳). (commit `f969601`) |
| 10 | **208** ✓ | refactor | §1-1 (frontend god file #4)     | `tabStore.ts` (1009) → entry + 3 sub-file (types/persistence/tracker). 51 외부 importer 경로 보존, 행동 변경 0. (commit `c79ca65`) |
| 11 | **209** ✓ | refactor | §1-2 (backend god file #2)     | `commands/connection.rs` (1710) → entry + 4 sub-file (session/crud/groups/io). 8 internal `AppState` users 보존. lib.rs invoke_handler 13 path → sub-module path (tauri `#[command]` macro 제약). (commit `5e3ba88`) |

본 sequencing 의 목적은 시한부 `CODE_SMELLS.md` 의 7 카테고리를 본 cycle
안에서 모두 소진하는 것이었다. Sprint 199–209 모두 refactor; cycle 종료
(2026-05-05) 후 feature backlog (Phase 13 / 21 / 22 등) 진입.

### 리팩토링 sequencing (Sprint 210–..., post-209 cycle)

Sprint 209 종료 직후 wide-net 재스캔 결과 ([`refactoring-candidates.md`](refactoring-candidates.md),
시한부) 를 입력값으로 새 cycle. 11개 P1–P11 후보 (DocumentDataGrid /
QuickLookPanel / tabStore cross-store 잔재 / tauri.ts barrel / Rust DB·export
modules / ConnectionDialog / Structure editors / Raw-query edit grid /
DocumentDatabaseTree / stores side-effects / mega tests). **이전 cycle 의
refactor 연속 패턴 답습**: 카테고리 모두 처리 후 feature backlog 진입.
**본 표는 candidate sequencing** — 진입 sprint 시 contract 로 옮겨 ADR /
AC 세분화. 후속 항목은 발견에 따라 재배치 가능.

| # | Sprint | 종류 | 입력 (candidates) | 내용 |
|---|--------|------|-------------------|------|
| 1 | **210** ✓ | refactor | P1 (DocumentDataGrid) | `DocumentDataGrid.tsx` (951) → entry 597 + 4 sub-file. 행동 변경 0, evaluator 9/10. (commit `b9020fb`) |
| 2 | **211** ✓ | refactor | P2 (QuickLookPanel) | `QuickLookPanel.tsx` (868) → entry 176 + 5 sub-file. 행동 변경 0, evaluator 8.5/10. (commit `9e2091f`) |
| 3 | **212** ✓ | refactor | P3 (tabStore cross-store) | `tabStore` entry 의 `useMruStore` / `useQueryHistoryStore` 직접 import 제거 — 15 caller migration. evaluator 7.5/10. (commit `ccd8809`) |
| — | (사용자) | refactor | ~~P4 (tauri.ts)~~ | 688-line tauri.ts → 6 도메인 + barrel. (사용자 commit `879b003`) |
| — | (사용자) | refactor | P5 step 1 | `db/mod.rs` (1425→551) + `export.rs` (1425→879) tests block sibling 파일 hoist. (사용자 commit `a60074d`) |
| — | (사용자) | refactor | ~~P5 step 2a~~ | `db/mod.rs` (551) trait/DTO 분리. (사용자 commit `4e65a50`) |
| — | (사용자) | refactor | ~~P5 step 2b~~ | `commands/export.rs` (879) writer 분리. (사용자 commit `d2d3cf9`) |
| 4 | **213** ✓ | refactor | P6 (ConnectionDialog) | `ConnectionDialog.tsx` (829) → entry 310 + 5 sub-file (sanitize / draftForm / urlImport / Body / Footer). 행동 변경 0, evaluator 9/10. (commit `6dee525`) |
| 5 | **214** ✓ | refactor | P7 (Structure editors) | `useDdlPreviewExecution` 공통 hook (245) + 3 editor (Cols 775→695 / Idx 579→489 / Cons 649→559) 적용. cross-component DRY, 행동 변경 0, evaluator 9.5/10. (commit `ef1b1f6`) |
| 6 | **215** ✓ | refactor | P8 (Raw-query edit grid) | `EditableQueryResultGrid.tsx` (654) → entry 435 + `useRawQueryGridEdit` hook (348). 행동 변경 0, evaluator 9.5/10. (commit `ded4815`) |
| 7 | **217** ✓ | refactor | P9 (DocumentDatabaseTree) | `DocumentDatabaseTree.tsx` (582) → entry 263 + 4 sub-file. **Sprint 212 와 동일 commit (사전 처리 통합)**. evaluator 8/10. (commit `ccd8809`) |
| 8 | **216** ✓ | refactor | P11 step 1 (SchemaTree.test split) | `SchemaTree.test.tsx` (2891 / 104 cases) → 6 axis test (lifecycle 11 / expand 28 / refresh 6 / search 10 / actions 31 / highlight 18) + `__tests__/schemaTreeTestHelpers.ts` (51, 5 mock + 2 helper). entry 제거, 사전 5 axis + sub-file + sibling 모두 변경 0. evaluator 10/10. **사용자 의도 P10 → P11 swap**: 사용자 hooks/lib 작업 진행 중 P10 risk 회피. |
| 9 | **218** ✓ | refactor | P11 step 2 (QueryTab.test split) | `QueryTab.test.tsx` (2308 / 80 cases) → 6 axis test (lifecycle 8 / toolbar 5 / execution 17 / history 16 / dialect 11 / document 23) + `__tests__/queryTabTestHelpers.ts` (12 named export = 5 mock + `mockEditorProps` + 3 fixture builder + 2 fixture constant + `resetQueryTabStores`). entry 제거. Sprint 188 nested describe 옵션 B 보존. evaluator 9/9/10/9. |
| 10 | **220** ✓ | refactor | P11 step 3 (StructurePanel.test split) | `StructurePanel.test.tsx` (2156 / 84 cases) → 4 axis test (overview 28 / columns 26 / indexes 16 / constraints 14) + `__tests__/structurePanelTestHelpers.tsx` (9 named export = 3 mock + 3 fixture + 2 helper + 1 reset). entry 제거. Sprint 179 nested describe 옵션 B 보존. vi.mock factory 0 / vi.spyOn 5 helper 안 통합. evaluator 9/9/10/9. |
| 11 | **221** ✓ | refactor | P11 step 4 (tabStore.test split) | `tabStore.test.ts` (2234 / 102 cases) → 6 axis test (lifecycle 7 / query 20 / preview 19 / persistence 13 / sort 19 / lifecycle-actions 24) + `__tests__/tabStoreTestHelpers.ts` (7 named export, payload-builder pattern). entry 제거. Sprint 195 doubly-nested describe 옵션 B 보존. vi.mock 0 / vi.spyOn 0 사전 동일. helper type-only import (lint rule 회피). evaluator 9/9/10/9. |
| 12 | **222** ✓ | refactor | P11 step 5 (DataGrid.test split, **last**) | `DataGrid.test.tsx` (1906 / 75 cases) → 5 axis test (lifecycle 16 / sort 10 / filters-pagination 11 / refetch-overlay 9 / editing 29) + `__tests__/dataGridTestHelpers.tsx` (10 named export). entry 제거. vi.mock factory 3 inline 각 axis (총 15) / vi.spyOn module-top 0 + inline 1 ([AC-186-06]) 보존. helper type-only import. evaluator 9.25/10. **P11 cycle 종료** (216→218→220→221→222 = 5 mega test / 11,495 lines / 445 cases → 27 axis + 5 helper). |
| 13 | **219** ✓ | refactor | P10 step 1 (stores side-effects, mutation toast) | `connectionStore.ts` (-11 LOC) 의 `addConnection` / `updateConnection` / `removeConnection` 3 mutation 의 `toast.success(...)` + `toast` import → 신규 use-case hook `useConnectionMutations` (1 hook + 6 case test, `useConnectionLifecycle` 답습). 2 component selector swap (`ConnectionDialog` 2 / `ConnectionItem` 1). 행동 변경 0 — toast text byte-equivalent / SYNCED_KEYS / IPC bridge / session-storage 3 site / store action 16 signature 모두 동결. evaluator 9.20/10. |
| 14 | **223** ✓ | refactor | P10 step 2 (schemaStore optimistic refresh) | `schemaStore.ts` (-46 LOC) 의 `dropTable` / `renameTable` 의 `try { tauri.listTables + set } catch { fallback set }` orchestration → 신규 use-case hook `useSchemaTableMutations` (1 hook 112 + 6 case test 207, `useConnectionMutations` 답습). store action body thin 화 (`await tauri.dropTable/renameTable(...)` 만). 6 case migrate (store -6 / hook +6 verbatim name). 1 caller swap (`useSchemaTreeActions.ts`). cache 결과 byte-equivalent / `SchemaState` 16 method signature 동결 / Tauri call counts 동결 / sibling diff 0 (13+ 파일). evaluator 8.35/10. |
| 15 | **224** ✓ | refactor | P10 step 3a (connectionStore hydrateFromSession) | `connectionStore.ts` (-15 LOC) 의 `hydrateFromSession` action body (`readConnectionSession` + partial-patch + `set(patch)`, 13 LOC) → 신규 module `useConnectionSessionHydration.ts` (55 LOC, Option C — 2 export: `hydrateConnectionSession` plain + `useConnectionSessionHydration` hook wrap). store action body 1 LOC thin proxy. 2 case migrate verbatim (store -2 / module +4 = 2 verbatim + 2 partial-session edge bonus). 2 caller swap (`main.tsx` boot + `useWindowFocusHydration.ts` window-focus). dynamic-import boot ordering preserved (`attachZustandIpcBridge` module-load attach 안전). 2 test 파일 (useWindowFocusHydration.test / WorkspacePage.test) spy-target swap (production 행동 동일, mock target shift). **CRITICAL FREEZE 통과**: persist 3 site / SYNCED_KEYS / IPC bridge attach byte-equivalent. 11 sibling 파일 diff 0 / cross-window 15/15 통과. evaluator 9.00/10. |
| 16 | **deferred** | refactor (보류) | P10 step 3b-4 (persist 3 site / IPC bridge) | step 3b: `persistFocusedConnId` / `persistActiveStatuses` 3 site — cross-window broadcast/persist **invariant 변경 동반** (origin ownership 식별 책임 hook 으로 이동 → narrow extraction 불가). step 4: `attachZustandIpcBridge` module-load attach 분리. **prerequisite**: e2e suite 복구 (vite v6 build OOM in 4GB container — `lefthook.yml:61-86` skip:true since 2026-05-01). e2e 없는 상태에서 cross-window invariant 검증은 vitest simulation 한 겹뿐 — risk > 가용 검증력. 추출보다 architectural 재설계 (Phase 28 후보 — Rust=server 또는 storage event spike) 가 적절. lesson: [broadcast/persist 비대칭](../memory/lessons/boot-windows/2026-05-06-broadcast-persist-asymmetry-store-extraction-limit/memory.md). |

본 cycle (Sprint 210–224) 종료 — 16 row 중 15 ✓ + 1 deferred (P10 step
3b/4). [`refactoring-candidates.md`](refactoring-candidates.md) retire
(2026-05-06, 이전 cycle 의 `CODE_SMELLS.md` 처리와 동일 — commit `0c64a1b`
패턴). 다음 cycle 진입 trigger: e2e 복구 sprint 완료 또는 새 wide-net
스캔 결과.

### Feature sequencing (Sprint 226–..., post-225 feature cycle)

post-209 refactor cycle 종료 (commit `ad9c241` / `8812d39`) 후 feature
backlog 진입. Phase 13/14/15/16/21/22/24/25/26/27 중 사용자 우선순위 +
e2e dead 제약 (cross-window invariant 변경 회피) 으로 phase 선정. Phase
17–20 (MySQL/MariaDB/SQLite/Oracle) 보류 (2026-05-01).

| # | Sprint | 종류 | Phase | 내용 |
|---|--------|------|-------|------|
| 1 | **226** ✓ | feature | Phase 27 sprint 1 | CREATE TABLE UI — backend `create_table` Tauri command (PG SQL builder + ANSI quoting + identifier validate + transactional execute / preview branch) + frontend `CreateTableDialog` modal (form + column-row repeater + PK multi-select) + `SchemaTree` schema-row context-menu "Create Table…" entry-point + `useDdlPreviewExecution` 재사용 (Sprint 214 freeze) + Safe Mode gate. cross-window invariant 0 / e2e 의존 0. evaluator 8.80/10 (correctness 9 / completeness 9 / reliability 8 / verification 9). Rust 11 unit + 1 integration test / vitest 12 + 3 = 15 new case / verification 4-set 통과. |
| 2 | **227** ✓ | feature | Phase 27 sprint 2 | CREATE TABLE UI DataGrip-parity foundation — `Tabs` (Columns / Keys / Indexes / Foreign Keys) + target schema dropdown picker + per-column type combobox (`CreateTableTypeCombobox` + `postgresTypes.ts` canonical PG type list) + per-column comment input + inline collapsible DDL preview pane (replaces `SqlPreviewDialog` modal-on-modal). Backend `ColumnDefinition.comment: Option<String>` (`#[serde(default)]` — Sprint 226 caller 호환) + `COMMENT ON COLUMN` 별도 statement (single-quote escape, empty → no statement, in same transaction). `useDdlPreviewExecution` 재사용 (render-agnostic, hook diff = 0). Indexes/FK tab placeholder `"Available in Sprint 228/229"`. Partial-atomic policy C 채택 (table+COMMENT in tx, indexes/FKs 별도 sequential). evaluator 8.7/10 (correctness 9 / completeness 8.5 / reliability 8.5 / verification 8.5). vitest 217 files / 2768 tests / cargo test create_table 16/16 / 4-set verification 통과. |
| 3 | **228** ✓ | feature | Phase 27 sprint 3 | Indexes tab functional — `+/−` 행 버튼 + per-row index name + columns multi-checkbox + type `<Select>` (btree/hash/gin/gist) + unique flag. Show DDL이 `tauri.createTable({preview_only:true})` + N개 `tauri.createIndex({preview_only:true})` 를 fan out 해서 multi-statement preview (CREATE TABLE + COMMENT ON × N + CREATE INDEX × M; `;\n` join). Execute는 partial-atomic policy C 체인 — `createTable(commit)` 성공 후 sequentially `createIndex(commit) × M`. 인덱스 실패는 CREATE TABLE을 rollback 하지 않고 실패 인덱스 이름을 inline preview pane error slot에 verbatim (`Index "<name>" failed: <pg error>`). PK auto-emission dedup — row의 columns array가 PK array와 정확히 일치하면 chain skip + inline note ("Skipped — primary key is already indexed"). `IndexesTabBody.tsx` extracted (parent ≤ 852 LOC ↘ from 1000). Backend `create_index` 변경 0 — `gin`/`gist` 2개 byte-string fixture 추가 (총 11). Hook diff 0 (`useDdlPreviewExecution` / `SqlPreviewDialog` / `tauri.createIndex` / `CreateIndexRequest` / `create_index` impl). 13 new vitest case (38 total). vitest 217 files / 2795 tests / cargo test create_table 16/16 / create_index 11/11 / 4-set verification 통과. |
| 4 | **229** ✓ | feature | Phase 27 sprint 4 | Foreign Keys + CHECK + UNIQUE constraints tab functional — single FK 탭에 3 sub-section (FK / CHECK / UNIQUE). 각 sub-section `+/−` 행 버튼 + per-row name (auto-suggest fallback `fk_<table>_<cols>` / `chk_<table>_<n>` / `uq_<table>_<cols>`). FK 행 inputs: name + local columns multi-checkbox + ref schema `<Select>` + ref table `<Select>` (cached + free-text fallback) + ref columns multi-checkbox + ON DELETE `<Select>` + ON UPDATE `<Select>` (5 PG-canonical 옵션). CHECK 행: name + 단일 라인 `<input>` 표현식. UNIQUE 행: name + columns multi-checkbox. Show DDL이 createTable + createIndex × M + addConstraint × K 를 fan out 해서 multi-statement preview. Execute는 partial-atomic policy C 체인 — table+COMMENT (1 tx) → createIndex × M (각 별도 tx) → addConstraint × K (각 별도 tx). 실패는 verbatim `Constraint "<name>" failed: <PG error>` 를 inline preview pane error slot에 surface. 0-FK/CHECK/UNIQUE 일 때 Sprint 228 byte-equivalent. `ForeignKeysTabBody.tsx` mandatorily extracted (~430 LOC). Path A 백엔드 확장: `ConstraintDefinition::ForeignKey` enum arm에 `#[serde(default)] on_delete: Option<String>` + `on_update: Option<String>` 추가, SQL emitter 화이트리스트 `{NO ACTION | RESTRICT | CASCADE | SET NULL | SET DEFAULT}` (case-sensitive). 3 new Rust fixture + 기존 `add_constraint_preview_foreign_key` 에 `on_delete: None, on_update: None` 2-line struct-literal 추가 (emitted SQL byte-equivalent). 새 `useFkReferencePicker` 훅 (lint rule `no-restricted-syntax` 회피 — `getState()` boundary). 14 new vitest case (52 total CreateTableDialog) + 10 ForeignKeysTabBody.test.tsx. vitest 218 files / 2819 tests / cargo test create_table 16/16 / create_index 11/11 / add_constraint 12/12 (9 baseline + 3 새) / 4-set verification 통과. |
| 5 | **230** ✓ | feature | Phase 27 sprint 5 | Dynamic Postgres type list — 백엔드 `list_postgres_types(connection_id)` Tauri command (`pg_catalog.pg_type ⨝ pg_catalog.pg_namespace`, `typtype IN ('b','d','e','r','c')` 화이트리스트, 어레이/`pg_toast`/auto row type 제외) + `RdbAdapter::list_types` 트레이트 default `Unsupported` + PG override + `LIST_TYPES_SQL` const 와 `list_types_sql_matches_canonical_fixture` Rust unit test. 프론트엔드 `usePostgresTypes(connectionId)` 훅 (module-level `Map<connectionId, CacheEntry>` memo, in-flight Promise share, stale connectionId guard) + `invalidatePostgresTypesCache(connectionId)` free helper (Sprint 231 disconnect/reconnect wiring 용). `CreateTableTypeCombobox` `typesSource?: readonly string[]` prop 추가 (default `undefined` → 기존 canonical-list path; back-compat). `CreateTableDialog` 가 훅을 호출해서 merged 결과를 prop 으로 전달 (loading-canonical-first → silent merge replace, no spinner). canonical-first merge order 가 `expandParametricDefault` 호환 보장. 12 vitest case (`usePostgresTypes`) + 4 (`CreateTableTypeCombobox` Sprint 230 describe) + 3 (`CreateTableDialog` Sprint 230 describe) + 1 Rust SQL fixture. vitest 219 files / 2838 tests / cargo test create_table 16/16 / create_index 11/11 / add_constraint 12/12 / list_types 2/2 / 4-set + clippy 통과. |
| 6 | **231** ✓ | feature | (Phase 23 회귀 fix) | Safe Mode raw RDB query path closure — `useQueryExecution.handleExecute` 의 single-statement (line 335–368) + multi-statement (line 374–431) RDB branch 가 Safe Mode gate 를 우회하던 P0 회귀 (2026-05-07 사용자 보고: production connection 에서 `UPDATE users SET active = false` 즉시 실행) 닫힘. Mongo aggregate path (`useQueryExecution.ts:238`) 의 패턴 답습 — `analyzeStatement` → `safeModeGate.decide` → `block`/`confirm`/`allow` dispatch + warn-tier `pendingRdbConfirm` `<ConfirmDangerousDialog>` mount. Helper 추출: `runRdbSingleNow(stmt)` + `runRdbBatchNow(stmts, joinedSql)` (Mongo `runMongoAggregateNow` 패턴). multi-statement strategy: 단일 pass 분석, 우선순위 `block > confirm > allow`, dangerous 발견 시 batch 전체 abort 또는 단일 confirm dialog. block 경로는 history `status: error, duration: 0` + `dispatchDbMutationHint` 호출 0. confirm 경로는 user 가 reason 을 verbatim 타이핑 후 동일 helper 재진입. AC-231-04 audit (`useDataGridPreviewCommit.ts`): no leak — `handleExecuteCommit` line 419–443 이 모든 statement 에 gate 호출 후 `runRdbBatch` dispatch (diff = 0). AC-231-05 audit (`ConnectionDialogBody.tsx:250–280`): environment dropdown rendered + `production` selectable + `ConnectionDialog.test.tsx:555-629` 커버 (코드 변경 0). 8 vitest case 신규 (`QueryTab.safe-mode.test.tsx`) — TDD red→green capture. vitest 220 files / 2846 tests / 4-set + clippy 통과. |
| 7 | **232** ✓ | feature | (Phase 5 잔존) | DataGrid default ORDER BY by primary key — `query_table_data` 의 `order_by = None` 분기에서 ORDER BY 가 emit 되지 않아 PG heap order 가 그대로 노출되던 회귀 (2026-05-07 사용자 보고: "기본적으로 id 기반 sorting 해줘 + UPDATE 한 row 가 맨 아래로 내려가는 버그 수정해줘") 닫힘. Root cause = single — PG SELECT `*` without ORDER BY → heap order, UPDATE → dead tuple + new tuple-at-tail. Fix: `pub(super) fn build_default_order_clause(columns: &[ColumnInfo]) -> String` free function 추출 (PK 컬럼 declared 순서, `"col" ASC` chain, embedded `"` → `""` escape, PK 0 → 빈 string), `query_table_data` 본문이 사용자 supplied `order_by` parsing 후 `order_clause` 가 비어 있으면 helper 호출. user override 우선순위 보존 (Some("name DESC") → 그대로 emit, fallback 발동 안 함). composite PK / no-PK / quote-escape edge case 모두 helper 단위 테스트로 고정. Frontend 변경 0 (`DataGrid.tsx` 의 `sorts.length === 0 ? undefined : ...` 송신 그대로). 6 new Rust unit test (`build_default_order_clause_*`) — TDD red→green capture. vitest 220 files / 2846 tests / cargo test 379/0 (was 373/0; +6) / 4-set + clippy 통과. |
| 8 | **233** ✓ | feature | (Phase 27 잔존 polish) | UPDATE SET column autocomplete fix + DataGrid bottom strip syntax highlighting. (Bug #1) `useSqlAutocomplete` 가 PG `"public"."brief_news_tasks"` 같은 fully-quoted schema-qualified key 를 namespace 에 emit 하지 않아 CodeMirror path resolution 이 column children 에 도달하지 못하던 문제 — `addFullyQuotedAlias` helper 추가 (PG/SQLite/MySQL dialect 일 때 `"schema"."table"` / `` `db`.`table` `` emit). 가설 (B) (CodeMirror `getAliases` 가 FROM only walk → UPDATE alias 추출 불가) 는 라이브러리 한계 — namespace fix 로 fully-qualified path 만 살림 (사용자가 `SET "schema"."table"."col"` 로 reference 시 column 자동완성 surface). (Bug #2) `DataGrid.tsx` 하단 "Executed query" strip 의 plain `<code>` → `<SqlSyntax>` 1-element 교체 (Sprint 227 도입 컴포넌트 재사용; `sqlTokenize.ts:213-220` 가 `"…"` 를 identifier kind 로 정확히 토큰화 — string 으로 오인 안 됨). 7 신규 vitest case (`useSqlAutocomplete` +3 = AC-233-01/02/03 / `DataGrid.bottom-query` +4 = AC-233-04 a/b/c/d) — TDD red→green 캡처. lifecycle 14번 단언만 split-span 구조에 맞게 갱신 (의미 보존). 백엔드 diff 0. vitest 221 files / 2853 tests / cargo test 379/0 / 4-set + clippy 통과. |
| 9 | **234** ✓ | feature | Phase 27 sprint 9 | CREATE TABLE UI UX 종합 polish — (1) cross-tab `(N)` count badges (Keys / Indexes / Foreign Keys 탭 라벨에 declared 리스트 길이 surface; 0 일 때 hidden), (2) AC-234-02 잠긴 empty-state 메시지 ("Add named columns in the Columns tab to use this picker.") 4 sub-tab 통일, (3) ↑/↓ reorder 버튼 5 family (column / index / FK / CHECK / UNIQUE) 모두 — `−` 버튼 왼쪽, 첫/마지막 row 에서 boundary disabled, swap-in-place + `trackingId`-keyed React identity 보존, `invalidatePreview()` 트리거, (4) `CreateTableRequest.table_comment: Option<String>` (`#[serde(default)]`) + PG `create_table` 가 `COMMENT ON TABLE` 를 comment chain 의 FIRST 로 emit (single-quote escape `'` → `''`, whitespace-only → no statement, atomic policy C 동일 transaction), 5 신규 Rust fixture (`table_comment_byte_equivalent` / `table_and_column_comments_byte_equivalent` / `single_quote` / `zero_table_comment_byte_equivalent_to_sprint_226` / `whitespace_table_comment_emits_no_statement`) + 1 serde-roundtrip, (5) AC-234-07 schema picker 를 `Header.tsx` 에서 제거, body 에서 Table name 입력 위로 이동 (vertical stacking; `schemaOptions.length === 0` 일 때 hidden), (6) AC-234-08/09 `usePostgresTypes` 가 `typesByName: Map<string, string>` 추가 surface (canonical = `"base"` seed; live = raw `type_kind`), `CreateTableTypeCombobox` `typeKindMap?: ReadonlyMap<string, string>` prop 으로 type_kind 별 color dot (`enum`=blue / `domain`=green / `range`=purple / `composite`=orange / `base`/unknown = no dot, graceful degrade). 16 기존 `CreateTableRequest` Rust 테스트 struct literal 에 `table_comment: None` 2-line 추가 (back-compat 유지). 8 신규 vitest case (`CreateTableDialog` Sprint 234 describe) + 5 (`CreateTableTypeCombobox` Sprint 234 describe) + 3 (`usePostgresTypes` Sprint 234 add) + 3 (`IndexesTabBody.test.tsx` 신규 파일). vitest 222 files / 2872 tests / cargo test 385/0 (was 379/0; +6) / 4-set verification + clippy + fmt 통과. |
| 10 | **235** ✓ | feature | Phase 27 sprint 10 | Table rename / drop 폴리시 promote — Sprint 226 `create_table` precedent 답습. (1) Backend `rename_table` / `drop_table` Tauri command rewrite — `RenameTableRequest` / `DropTableRequest` (`#[serde(rename_all = "camelCase")]` + `#[serde(default)] preview_only: bool`) 도입; trait + impl signature 가 request struct 받아 `SchemaChangeResult { sql }` 반환; PG impl `validate_identifier` 에 PG NAMEDATALEN 한도 (63 byte) check 추가; `drop_table` 에서 `information_schema.tables` 사전 존재 확인 제거 (PG verbatim error → modal `previewError` 슬롯 surface). (2) `RenameTableDialog` (`+313 LOC NEW`) — single text input + identifier regex `^[a-zA-Z_][a-zA-Z0-9_]*$` + `TextEncoder` byte-length check + rename-to-self pre-check (Apply disabled when input == current) + inline DDL preview pane + `useDdlPreviewExecution` (Sprint 214) + `useSchemaTableMutations` (Sprint 223) 재사용. (3) `DropTableDialog` (`+296 LOC NEW`) — typing-confirm input (case-sensitive byte-for-byte, NO trim, NO debounce) + CASCADE checkbox (default off, toggle invalidates preview) + Apply variant=destructive + Safe Mode dispatch (`DROP TABLE` → `ddl-drop` / danger; production×strict block / production×warn → `pendingConfirm` `<ConfirmDangerousDialog>` mount / non-prod safe). (4) `useSchemaTreeActions` 슬롯 collapse — 6 dialog state slots (`confirmDialog`, `renameDialog`, `renameInput`, `renameError`, `isOperating`, `renameInputRef`) → 2 (`renameTableDialog`, `dropTableDialog`); 3 handlers → 2 simple openers; inline tauri/history/toast 경로 modal 내부 이동. F2 키보드 rename preserved (autoFocus + select-all). (5) `dialogs.tsx` 3 슬롯 export (`CreateTableDialogSlot` 변경 0 + `RenameTableDialogSlot` + `DropTableDialogSlot` NEW). (6) `src/lib/tauri/ddl.ts` dual-export — `dropTableRequest` / `renameTableRequest` (request 형) + legacy `dropTable` / `renameTable` positional compat wrapper (`previewOnly: false` 로 위임); `schemaStore.ts` diff = 0 (Sprint 223 invariant). (7) `SchemaTree.actions.test.tsx` mechanical migration — `vi.hoisted` mock pattern `@lib/tauri.dropTable`/`renameTable`로 push down; AC-191-03 toast-fallback 케이스 제거 (modal owns error surface). 8 신규 cargo fixture (`rename_table_preview_byte_equivalent` / `drop_table_preview_no_cascade_byte_equivalent` / `drop_table_preview_cascade_byte_equivalent` / `rename_table_invalid_new_name_rejected` / 등) + 2 serde-roundtrip + 8 RenameTableDialog 테스트 + 12 DropTableDialog 테스트 + 4 신규 SchemaTree.actions AC-235-07/08 케이스. vitest 224 files / 2886 tests / cargo test 395/0 (was 385/0; +10) / 4-set + clippy + fmt + build 통과. |
| 11 | **236** ✓ | feature | Phase 27 sprint 11 | Column add / drop 폴리시 promote — Sprint 235 `rename_table` / `drop_table` precedent 답습. (1) Backend `add_column` / `drop_column` Tauri command 신설 — `AddColumnRequest` / `DropColumnRequest` (`#[serde(rename_all = "camelCase")]` + `#[serde(default)] preview_only: bool`) 도입; trait + impl signature 가 request struct 받아 `SchemaChangeResult { sql }` 반환; PG impl 가 SQL emission order lock (`ADD COLUMN "name" <type> [NOT NULL] [DEFAULT <expr>] [CHECK (<expr>)]` / `DROP COLUMN "name" [CASCADE]`, no RESTRICT keyword); `BEGIN/COMMIT` transactional execute branch; identifier validation (`validate_identifier` 공유 helper, PG NAMEDATALEN 63 byte). (2) `AddColumnDialog` (`+432 LOC NEW`) — column name input + type combobox (`CreateTableTypeCombobox` reused with `usePostgresTypes`) + NOT NULL toggle (default OFF) + DEFAULT free-text + CHECK free-text + collapsible Show DDL pane; identifier regex `^[a-zA-Z_][a-zA-Z0-9_]*$`, byte-length ≤ 63; collision pre-check disables Apply with inline hint. (3) `DropColumnDialog` (`+300 LOC NEW`) — typing-confirm input (case-sensitive byte-for-byte, NO trim, NO debounce) + CASCADE checkbox (label `"Drop dependent objects (CASCADE)"` Sprint 236 user spec) + default off + toggle invalidates preview + Apply variant=destructive + Safe Mode dispatch (`ALTER TABLE … DROP COLUMN` → `ddl-drop` / danger; production×strict block / production×warn → `pendingConfirm` `<ConfirmDangerousDialog>` mount / non-prod safe). (4) `ColumnsEditor` rerouting — `+ Column` toolbar button now opens `<AddColumnDialog>` (inline `NewColumnRow` REMOVED); per-row trash icon now opens `<DropColumnDialog>` (no pendingChanges drop push); inline-batched MODIFY path (Edit pencil → save → Review SQL → Execute) UNCHANGED — Sprint 237 polish target. (5) DEFAULT/CHECK passthrough verbatim — no escaping, no syntax check, embedded `'` preserved (PG surfaces verbatim errors via `previewError`). (6) `src/lib/tauri/ddl.ts` request-shaped only (`addColumnRequest` / `dropColumnRequest`) — no positional alias layer per OQ-1 (zero callers). (7) `ColumnsEditor.test.tsx` / `StructurePanel.columns.test.tsx` mechanical migration — Sprint 187 Safe Mode gate regressions 6 케이스가 inline-trash trigger → inline-MODIFY trigger 으로 이동 (alterTable mock 이 DROP COLUMN preview 반환 → analyzer classification 보존); 인라인-add `Confirm add column` 케이스는 modal-mount assertion 으로 교체. 16 신규 cargo fixture (10 `add_column` + 6 `drop_column`, 2 serde-roundtrip 포함) + 13 AddColumnDialog 테스트 + 12 DropColumnDialog 테스트 + 2 신규 ColumnsEditor.test.tsx modal-mount 케이스 + 1 신규 StructurePanel.columns.test.tsx AC-236-08 케이스. vitest 226 files / 2912 tests / cargo test 410/0 (was 395/0; +15) / 4-set + clippy + fmt + build 통과. |
| 12 | **276** ✓ | feature | Phase 17 sprint 0 (Generator-free) | Unsupported adapter UI hide — connection 생성 dialog 의 DBMS dropdown 에 백엔드 `make_adapter` 가 실제 어댑터를 반환하는 DBMS (PostgreSQL / MongoDB) 만 노출. MySQL / SQLite / Redis 는 사용자가 새 connection 을 만들 때 선택 불가능. `types/connection.ts` 에 `SUPPORTED_DATABASE_TYPES: readonly DatabaseType[] = ["postgresql", "mongodb"]` + `isSupportedDatabaseType()` helper + `DATABASE_TYPE_LABELS` 단일 source 추가. `ConnectionDialogBody.tsx` SelectItem 5 → SUPPORTED 기반 map (편집 모드에서 기존 unsupported db_type 도 예외적으로 추가해 select 가 빈값으로 보이지 않도록 보호). `useConnectionUrlImport.ts` `parseAndApply` 가 unsupported scheme 검출 시 `urlError` 노출 (`"<Label> is not yet supported. Currently only PostgreSQL / MongoDB can be added."`); form-mode `handleHostPaste` 는 AC-178-04 silent 룰 그대로 적용 — unsupported scheme paste 는 form 변경 없이 silent return. Sprint 108 port-guard 7 케이스 + Sprint 138 unsupported 3 케이스 + 단독 MySQL select 케이스 = 11개 `it.skip` (Phase 17 어댑터 합류 시 unskip). 새 회귀 가드: PG↔Mongo port-guard 2개 + dropdown supported-only 1개 + edit-mode unsupported 보존 1개 + Sprint 276 SUPPORTED 상수/helper/labels 3개 + URL-mode reject 3개 (mysql/sqlite/redis 각각) + form-paste silent 4개 (mysql/mariadb/redis/sqlite). vitest 269 files / 3286 tests / 10 skipped / tsc clean / lint clean. |

### State management 이주 (Sprint 353–376, 24 sprint)

`docs/state-management-strategy-2026-05-15.md` 의 Phase 0~6 AC + Part F.1~F.6 wire contract 를 TDD sprint 단위로 분할. 24 sprint 일련번호 353~376 (정수 번호 룰 `feedback_sprint_naming.md` 준수). Phase 의존성 그래프 위에 의존 ASC 정렬. 각 contract.md 는 In Scope ≤ 5 파일군, AC ≤ 12, TDD red→green 명시.

| # | Sprint | Phase | 목적 |
|---|--------|-------|------|
| 1 | **353** | 0 | dehydration pipeline (M-1/Q16–Q19 strip + LS byte < 50KB + Q19 cap 25) |
| 2 | **354** | 0 | counter seed (M-2) + L2 schemaStore 비-schema 메서드 retire |
| 3 | **355** | 1 | SQLite skeleton + 9 table migration + Q2 corrupt recovery + legacy import IPC + guard |
| 4 | **356** | 1 | keyring file-key (Q22) — 신규 / 기존 / Linux fallback 3 path + readback/decrypt/fatal |
| 5 | **357** | 1 | snapshot IPC `get_initial_app_state` (F.2 shape) + Q9 p95 < 50ms |
| 6 | **358** | 1 | dual-write (connections/favorites/mru/settings) + workspaces SQLite-only + W1 reconcile |
| 7 | **359** | 2 | tab affinity (Q5.1/2/3/4/5/6) + `cancel_query(connection_id, server_pid \| opid)` + `release_tab_connection(connection_id, tab_id)` + introspection_pool |
| 8 | **360** | 2 | schemaCache self-window invalidate (Q23 self) |
| 9 | **361** | 3 | window label per-conn (`workspace-{conn_id}`) + `open_workspace_window` idempotent |
| 10 | **362** | 3 | single-instance plugin + 2nd launch focus + cold-boot < 50ms |
| 11 | **363** | 3 | Q13 same-conn focus + launcher hide/show lifecycle |
| 12 | **364** | 3 | ConnectionStatus enum 확장 (Connecting + active_db) + 4-case serde regression |
| 13 | **365** | 3 | cross-window `state-changed` infra + 9 domain routing + dedup/self-echo/gap/reset |
| 14 | **366** | 4 | `useCurrentWindowConnectionId()` hook + workspace path `focusedConnId` read 0 |
| 15 | **367** | 4 | snapshot hydration (5 boot critical stores + runtime) + listener pre-register |
| 16 | **368** | 4 | theme/safeMode SOT 전환 (Q12) + cross-window 50ms + FOUC 0 |
| 17 | **369** | 4 | datagrid prefs + non-store LS 5 site retire (Q20) + partial patch / field-scoped reset |
| 18 | **370** | 4 | W2→W3 dogfood gate (4 도메인 mismatch 1주일 0) |
| 19 | **371** | 5 | query_history backend (add/list/detail/clear + privacy + VACUUM 분리 + discriminated union) |
| 20 | **372** | 5 | query history frontend integration (panel filter + event refetch + clear) |
| 21 | **373** | 5 | queryHistoryStore retire + source 5종 e2e + retention boot wiring + disable 토글 |
| 22 | **374** | 6 | ADR-0032 ~ ADR-0042 final commit (11 ADR, strategy line 798–808 매핑) |
| 23 | **375** | 6 | cleanup (session-storage rename + 모듈 변수 + tab_id null audit + W4 `.legacy.json` cron) |
| 24 | **376** | 6 | Reset-to-default UI 9 affordance 구현 + Q21 audit |

**기준 문서**: [`docs/state-management-strategy-2026-05-15.md`](state-management-strategy-2026-05-15.md), [`docs/code-smell-audit-2026-05-15.md`](code-smell-audit-2026-05-15.md). 11회 codex 외부 검토 (1차–11차) 로 wire-shape 일관성 0 findings 도달, sprint contract 4회 codex 5.5 medium 검토 로 cross-doc 정합성 정정.

**의존성 그래프 (병렬 가능 묶음)**:
- Phase 0 (353, 354) — 의존 0, 병렬 가능.
- Phase 1 (355 → 356 / 357) — 355 후 356·357 병렬.
- Phase 1 (358 ← 355, 356) — 357 무관 (snapshot IPC 와 dual-write 독립).
- Phase 2 (359, 360) — 355 후 359, 359 후 360. dual-write (358) 무관.
- Phase 3 (361, 362, 363, 364, 365) — 361 / 364 무관 (label vs serde), 362 ← 361, 363 ← 361+362, 365 ← 361+362+363+364.
- Phase 4 (366, 367, 368, 369, 370) — 366 / 365 무관 (hook 미사용 — label parser 직접), 367 ← 357+361+364+365+366, 368 ← 358+365+367, 369 ← 355+358+365+367, 370 ← 358+365+367+368+369.
- Phase 5 (371, 372, 373) — 371 ← 355+365+370, 372 ← 370+371, 373 ← 371+372.
- Phase 6 (374, 375, 376) — 374 ← all, 375 ← 367+368+369+370+371+372+373, 376 ← 368+371+373+375.

### Language completion architecture (Sprint 420–430, Phase 31)

ADR 0045 의 completion boundary 를 장기 계획으로 승격. 목표는 current
CodeMirror/TS completion 을 유지하면서, Rust/WASM completion core 로 안전하게
교체 가능한 request/result contract 를 먼저 고정하는 것이다. PostgreSQL 먼저
shadow 하되 request shape 은 MySQL / MariaDB / SQLite 를 처음부터 포함한다.

| Sprint | 단계 | 목적 |
|---|---|---|
| **420** | A | Completion request/result contract + SQL request builder + PLAN/phase 문서화 |
| **421** | B | CodeMirror adapter shadow path — TS result 와 WASM-ready request 동시 생성, visible popup 은 기존 TS source 유지 |
| **422** | C | PostgreSQL WASM completion core v0 — keyword/table/column/function provider |
| **423** | D | SQL popup WASM-first 전환, 기존 TS source fallback 유지 |
| **424** | E | MySQL/MariaDB completion closure — `SHOW/DESCRIBE/USE`, `ON DUPLICATE KEY UPDATE`, shell commands |
| **425** | F | SQLite completion + sqlite-cli shell — `PRAGMA`, `WITHOUT ROWID`, `.tables`, `.schema` |
| **426** | G | Mongo completion alignment — method whitelist parity + classifier export |
| **427** | H | Shadow-only helper cleanup + docs support matrix 갱신 |
| **428** | I | Rust/WASM vocabulary SOT — SQL keyword/function/shell + Mongo MQL/mongosh/admin vocabulary ownership 정리 |
| **429** | J | Official-reference coverage closure — Mongo operator/stage/expression drift tests, MySQL/MariaDB built-ins, psql/mysql/sqlite shell smoke |
| **430** | K | Completion support matrix hardening — "100%" 의미를 current UI vocabulary surface 로 고정하고 parser semantic gap 문서화 |

**기준 문서**: [`docs/phases/phase-31.md`](phases/phase-31.md),
[`docs/query-language-support.md`](query-language-support.md),
[`memory/decisions/0045-language-completion-profile-wasm-boundary/memory.md`](../memory/decisions/0045-language-completion-profile-wasm-boundary/memory.md).

## 문서 목차

| 문서 | 설명 |
|------|------|
| [Architecture](architecture.md) | 시스템 구조, DB driver 추상화, 기술 결정 |
| [RISKS](RISKS.md) | 잔여 위험 등록부 (20개 항목, 상태 추적) |
| [Query Language Support](query-language-support.md) | PostgreSQL / MySQL / MariaDB / SQLite / MongoDB 자동완성·문법 지원 범위 |
| [Phase 31](phases/phase-31.md) | Multi-dialect language completion architecture |
| [Sprints](sprints/README.md) | harness sprint 실행 산출물 |

## 구현 계획

| Phase | 내용 | 상태 | 상세 |
|-------|------|------|------|
| 1 | Foundation (연결 관리) | 완료 | [phase-1.md](phases/phase-1.md) |
| 2 | Schema & Data Exploration | 완료 | [phase-2.md](phases/phase-2.md) |
| 3 | Query Editor | 완료 | [phase-3.md](phases/phase-3.md) |
| 4 | Editing & Polish | 완료 | [phase-4.md](phases/phase-4.md) |
| 5 | Extended Features | 진행 중 | [phase-5.md](phases/phase-5.md) |
| 6 | MongoDB 지원 | 부분 완료 → Phase 28 로 승계 | [phase-6.md](phases/phase-6.md), [phase-28.md](phases/phase-28.md) |
| 7 | Elasticsearch 지원 | 계획 | [phase-7.md](phases/phase-7.md) |
| 8 | Redis 지원 | 계획 | [phase-8.md](phases/phase-8.md) |
| 12 | Multi-window split (launcher/workspace) | 완료 | [phase-12.md](phases/phase-12.md) |
| 13 | PG preview tab parity + multi-window activation 회귀 진단 | 종료 (Sprint 156–160; E2E 일부 deferred) | [phase-13.md](phases/phase-13.md) |
| 14 | Workspace theme toggle | 종료 (Sprint 161–162; E2E 일부 deferred) | [phase-14.md](phases/phase-14.md) |
| 15 | Connection group DnD + nested indent | 종료 (Sprint 163–164; P2 후속 deferred) | [phase-15.md](phases/phase-15.md) |
| 16 | Recent connections (MRU) 동작 보장 | 종료 (Sprint 166–168; UX 보강 후속 완료) | [phase-16.md](phases/phase-16.md) |
| 17 | MySQL 어댑터 | 종료 (Sprint 278–287 + Sprint 296 retrospective) | [phase-17.md](phases/phase-17.md) |
| 18 | MariaDB 어댑터 | **보류** (2026-05-01) | [phase-18.md](phases/phase-18.md) |
| 19 | SQLite 어댑터 | **보류** (2026-05-01) | [phase-19.md](phases/phase-19.md) |
| 20 | Oracle 어댑터 | **보류** (2026-05-01) | [phase-20.md](phases/phase-20.md) |
| 21 | CSV / SQL / JSON Export | 종료 (Sprint 181) | [phase-21.md](phases/phase-21.md) |
| 22 | Row 인라인 편집 RDB + Preview/Commit/Discard 게이트 | 완료 (Sprint 181–184) | [phase-22.md](phases/phase-22.md) |
| 23 | Safe Mode (프로덕션 가드) | 종료 (Sprint 185–188, 2026-05-01) | [phase-23.md](phases/phase-23.md) |
| 24 | Index Write UI | 계획 | [phase-24.md](phases/phase-24.md) |
| 25 | Constraint Write UI | 계획 | [phase-25.md](phases/phase-25.md) |
| 26 | Trigger 관리 | 계획 | [phase-26.md](phases/phase-26.md) |
| 27 | Table / Column DDL UI | 종료 (Sprint 237 closure, 2026-05-13) | [phase-27.md](phases/phase-27.md) |
| 28 | MongoDB Full Support | 진행/후속 판단 (Slice A–M 대부분 구현, parser consolidation 후보) | [phase-28.md](phases/phase-28.md) |
| 31 | Language Completion Architecture | 진행 (Sprint 428: Rust vocabulary SOT + coverage closure) | [phase-31.md](phases/phase-31.md) |

> Phase 9–11은 본 phase 분할 이전의 임시 스케치(`phase-9.md` 등). Phase 17–20이 phase-9의 RDBMS 확장 계획을 승계해 분할 — 2026-05-01 결정으로 패리티 달성 시까지 보류. Phase 21–27 이 그 자리를 차지하고, 본 7단계 종료 시점에 Phase 17–20 재개를 재평가. Phase 29/30 은 기존 후보(통합 후속 / 보안 surface) 로 남겨두고, completion 은 충돌 회피를 위해 Phase 31 로 배치한다.

## TDD / E2E 정책 (Phase 13 이후)

- **TDD strict**: 각 sprint 진입 시 `docs/sprints/sprint-N/tdd-evidence/red-state.log` 캡처 또는 commit 순서로 red→green TDD 흔적 보존.
- **Skip-zero gate**: phase 종료 시 모든 touched 파일에서 `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` 0건. 부득이 deferred 시 (a) RISK-NNN 또는 ADR 식별자 메모리 등록, (b) skip 직전 `[DEFERRED-<ID>]` 주석 + 동치 커버리지 경로 + 재진입 트리거 명시 — `memory/lessons/workflow/2026-04-27-phase-end-skip-accountability-gate/memory.md` 참조.
- **Verification 4-set**: 매 sprint 종료 직전 `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, 필요 시 `cargo build --manifest-path src-tauri/Cargo.toml` 모두 exit 0.
- **E2E 정책**: Sprint 297부터 full-suite E2E와 pre-push gate를 제거하고, ADR 0044부터 Linux host GitHub Actions에서 WebdriverIO + tauri-driver 기반 `e2e/smoke/**`만 remote blocking check로 운영. `tsc`/`lint`/`vitest`/`build`가 비런타임 correctness gate이고, smoke는 PR/main에서 실제 앱 부팅 + DBMS별 최소 happy path를 보장한다.
- **ADR 동결**: trade-off 있는 결정은 작성 순간 본문 동결. 후속 결정은 새 ADR + supersede chain.

## 참고 자료

- [TablePlus 문서](table_plus/) — 63개 참고 문서
- Tauri 2.0 가이드: https://v2.tauri.app/
- sqlx 문서: https://docs.rs/sqlx

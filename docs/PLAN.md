# Table View — Master Plan

## 프로젝트 목적

TablePlus와 동등한 로컬 데이터베이스 관리 도구를 만든다.

**판단 기준**: "TablePlus 사용자가 Table View로 전환했을 때 핵심 워크플로우(연결 → 탐색 → 조회 → 편집 → 쿼리)가 끊기지 않아야 한다."

초기 DBMS는 PostgreSQL. 아키텍처는 다중 DBMS 확장을 전제로 설계.

## 현재 상태

Phase 1–4 완료 (Sprint 24–54 PASS). Phase 5–11 부분 진행. **Phase 12 완료(2026-04-27, Sprint 150–155)** — launcher/workspace 별도 `WebviewWindow` + 5 store cross-window IPC sync + 실제 lifecycle wiring + ADR 0011 → 0012 supersede + RISK-025 resolved.

진행 중/대기: **Phase 13** (PG preview tab parity + multi-window activation 회귀 진단), Phase 14 (workspace theme toggle), Phase 15 (connection group DnD + nested indent), Phase 16 (Recent connections 동작 보장).

## 방향 결정 (2026-05-01)

**TablePlus 패리티 우선, 신규 DBMS 추가는 보류.** PostgreSQL + MongoDB 두 패러다임 위에서 TablePlus의 데일리 워크플로(grid export · row inline edit · DDL UI · Safe Mode)를 닫는 것이 최우선. **Phase 17–20 (MySQL / MariaDB / SQLite / Oracle 어댑터)은 패리티 달성 이후 재개**한다 (`보류` 상태).

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
| 2 | 227+ | feature | (TBD) | 후보: Phase 27 sprint 2 (DROP CASCADE preview + 의존 객체 영향 미리보기) / Phase 26 (Trigger Read+Write) / Phase 13 (PG preview tab parity, multi-window 파트는 e2e 복구 후) / Phase 14 (theme toggle) / Phase 16 (MRU). |

## 문서 목차

| 문서 | 설명 |
|------|------|
| [Architecture](architecture.md) | 시스템 구조, DB driver 추상화, 기술 결정 |
| [RISKS](RISKS.md) | 잔여 위험 등록부 (20개 항목, 상태 추적) |
| [Sprints](sprints/README.md) | harness sprint 실행 산출물 |

## 구현 계획

| Phase | 내용 | 상태 | 상세 |
|-------|------|------|------|
| 1 | Foundation (연결 관리) | 완료 | [phase-1.md](phases/phase-1.md) |
| 2 | Schema & Data Exploration | 완료 | [phase-2.md](phases/phase-2.md) |
| 3 | Query Editor | 완료 | [phase-3.md](phases/phase-3.md) |
| 4 | Editing & Polish | 완료 | [phase-4.md](phases/phase-4.md) |
| 5 | Extended Features | 진행 중 | [phase-5.md](phases/phase-5.md) |
| 6 | MongoDB 지원 | 계획 | [phase-6.md](phases/phase-6.md) |
| 7 | Elasticsearch 지원 | 계획 | [phase-7.md](phases/phase-7.md) |
| 8 | Redis 지원 | 계획 | [phase-8.md](phases/phase-8.md) |
| 12 | Multi-window split (launcher/workspace) | 완료 | [phase-12.md](phases/phase-12.md) |
| 13 | PG preview tab parity + multi-window activation 회귀 진단 | 계획 | [phase-13.md](phases/phase-13.md) |
| 14 | Workspace theme toggle | 계획 | [phase-14.md](phases/phase-14.md) |
| 15 | Connection group DnD + nested indent | 계획 | [phase-15.md](phases/phase-15.md) |
| 16 | Recent connections (MRU) 동작 보장 | 계획 | [phase-16.md](phases/phase-16.md) |
| 17 | MySQL 어댑터 | **보류** (2026-05-01) | [phase-17.md](phases/phase-17.md) |
| 18 | MariaDB 어댑터 | **보류** (2026-05-01) | [phase-18.md](phases/phase-18.md) |
| 19 | SQLite 어댑터 | **보류** (2026-05-01) | [phase-19.md](phases/phase-19.md) |
| 20 | Oracle 어댑터 | **보류** (2026-05-01) | [phase-20.md](phases/phase-20.md) |
| 21 | CSV / SQL / JSON Export | 계획 (Sprint 181) | [phase-21.md](phases/phase-21.md) |
| 22 | Row 인라인 편집 RDB + Preview/Commit/Discard 게이트 | 계획 | [phase-22.md](phases/phase-22.md) |
| 23 | Safe Mode (프로덕션 가드) | 종료 (Sprint 185–188, 2026-05-01) | [phase-23.md](phases/phase-23.md) |
| 24 | Index Write UI | 계획 | [phase-24.md](phases/phase-24.md) |
| 25 | Constraint Write UI | 계획 | [phase-25.md](phases/phase-25.md) |
| 26 | Trigger 관리 | 계획 | [phase-26.md](phases/phase-26.md) |
| 27 | Table / Column DDL UI | 진행 중 (Sprint 226 ✓ — CREATE TABLE) | [phase-27.md](phases/phase-27.md) |

> Phase 9–11은 본 phase 분할 이전의 임시 스케치(`phase-9.md` 등). Phase 17–20이 phase-9의 RDBMS 확장 계획을 승계해 분할 — 2026-05-01 결정으로 패리티 달성 시까지 보류. Phase 21–27 이 그 자리를 차지하고, 본 7단계 종료 시점에 Phase 17–20 재개를 재평가.

## TDD / E2E 정책 (Phase 13 이후)

- **TDD strict**: 각 sprint 진입 시 `docs/sprints/sprint-N/tdd-evidence/red-state.log` 캡처 또는 commit 순서로 red→green TDD 흔적 보존.
- **Skip-zero gate**: phase 종료 시 모든 touched 파일에서 `it.skip` / `this.skip()` / `it.todo` / `xit` / `describe.skip` 0건. 부득이 deferred 시 (a) RISK-NNN 또는 ADR 식별자 메모리 등록, (b) skip 직전 `[DEFERRED-<ID>]` 주석 + 동치 커버리지 경로 + 재진입 트리거 명시 — `memory/lessons/workflow/2026-04-27-phase-end-skip-accountability-gate/memory.md` 참조.
- **Verification 4-set**: 매 sprint 종료 직전 `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, 필요 시 `cargo build --manifest-path src-tauri/Cargo.toml` 모두 exit 0.
- **E2E 정책**: Phase 13에서 Playwright + tauri-driver 기반 e2e suite 정착. CI에서 별도 job으로 운영 (vitest와 분리). 주요 시나리오는 phase-별 `E<phase>-NN` 형식으로 ID 부여, `e2e/` 디렉토리에 `<scenario>.spec.ts` 형식. Phase 13 closure 시 e2e 운영 결정 ADR 후보.
- **ADR 동결**: trade-off 있는 결정은 작성 순간 본문 동결. 후속 결정은 새 ADR + supersede chain.

## 참고 자료

- [TablePlus 문서](table_plus/) — 63개 참고 문서
- Tauri 2.0 가이드: https://v2.tauri.app/
- sqlx 문서: https://docs.rs/sqlx

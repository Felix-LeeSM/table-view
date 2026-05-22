# Code Smell Audit — 2026-05-15

> **Scope**: 정적 분석(Part A) + frontend 상태 관리 논리적 분석(Part B).
> 이전 [`refactoring-candidates-2026-05-06.md`](../backlogs/refactoring-candidates-2026-05-06.md) (retired
> 2026-05-06) 의 후속이지만 그 문서를 대체하거나 sprint 계약을 대체하지
> 않는다. 다음 작업 단위를 고를 때 참고하는 backlog.

> **Status**: archived/inactive (2026-05-22). Active tracking is RISK-038 in
> `docs/RISKS.md`.

## Inspection Method

**Part A — 정적 분석**:
- 프로덕션 TS/TSX/Rust 파일 LOC 분포 — 상위 50개 식별.
- React hook 밀집도 (`useState` / `useEffect` / `useCallback` / `useMemo`
  /`useRef`) — 컴포넌트별 호출 합계.
- `memory/conventions/refactoring/` 룰셋 4 카테고리 (B/D/C/A) 위반 grep.
- Rust 백엔드: 파일별 책임 도메인 분류 + 큰 함수 (≥80 LOC) 식별.
- 책임 응집도 — 한 파일이 다루는 distinct concern 갯수를 코드 읽고 분류.

**Part B — 논리적 분석**:
- 각 store 의 책임 vs 이름 약속 일치 검토.
- 두 store 가 같은 개념을 다르게 표현하는 semantic duplication 탐지.
- store 사이 키 공간 / 키 차원 일관성 검토 — invariant 누수 가능성.
- Lifecycle event 의 paired cleanup 보장 추적.
- 같은 type / 필드의 의미 분열 (deprecated 마이그레이션 중간 상태 포함).

## Part A Summary

12개 후보, 5 그룹.

| # | Candidate | Category | Impact | Cost |
|---|-----------|----------|--------|------|
| 1 | `useQueryExecution.ts` paradigm split + Safe Mode 분리 | A-2 god hook | High | Med |
| 2 | `postgres/mutations.rs` 도메인 분할 + mysql 페어 | Rust mod 분할 | High | Med |
| 3 | `rdb/DataGrid.tsx` column 메타 hook 추출 | A-1 + A-3 | Med-High | Med |
| 4 | RDB command handler dispatch 매크로화 | Rust boilerplate | Med-High | Low |
| 5 | `CreateTableDialog.tsx` ColumnsTabBody 추출 | A-3 | Med | Low |
| 6 | B-1 위반 5건 → store action | B-1 룰 | Med | Low |
| 7 | `useDataGridEdit.ts` paradigm split + undo lib | A-2 + D-3 | Med | Med |
| 8 | `postgres/schema.rs` 도메인 분할 | Rust mod | Med | Med |
| 9 | identifier validation 공통화 | Rust dup | Med | Med |
| 10 | `useFormResetOnOpen` hook으로 C-2 disable 일괄 | C-2 cleanup | Low-Med | Low |
| 11 | `workspaceStore` cross-store 의존 정리 또는 ADR | B-6 | Low | Low-Med |
| 12 | `DocumentDataGrid` MQL preview modal 추출 | A-3 | Low-Med | Low |

## Part B Summary

논리적 분석으로 10개 발견. 정적 분석 (Part A) 가 LOC / hook 밀집도 / 룰
위반의 표면 신호라면, Part B 는 **store 책임-이름 mismatch 와 store 간
invariant 누수** — 코드는 컴파일되지만 의미가 어긋난 곳.

| # | 발견 | 영역 | Severity |
|---|------|------|----------|
| L1 | `dataGridEditStore` 키 공간이 `workspaceStore` 보다 얕음 (`db` 차원 누락) | invariant 누수 | 🔴 High |
| L2 | `schemaStore` 가 schema-무관 메서드 5개 보유 (`queryTableData`/`executeQuery`/`executeQueryBatch`/`dropTable`/`renameTable`) | 책임-이름 mismatch | 🔴 High |
| L3 | `schemaStore.clearSchema` ≡ `clearForConnection` (동일 본문, alias) | dead API | 🟡 Med |
| L4 | Connection cleanup 책임이 3 store × 5+ 호출처에 분산 — paired 호출 보장 없음 | lifecycle 누수 | 🔴 High |
| L5 | `queryHistoryStore.entries` vs `globalLog` — 이중성 정당화 없음 | 잉여 상태 | 🟡 Med |
| L6 | `QueryMode` type alias 가 두 store 에서 다른 의미 (tab hint vs dispatched method) | 의미 분열 | 🟡 Med |
| L7 | `workspaceStore` 의 queryId stale guard 4사이트 중복 | DRY | ⚪ Low |
| L8 | `workspaceStore` 파일에 selector hook 9개 동거 | navigation | ⚪ Low |
| L9 | `paradigm` 정보 3 store 에 cache (drift 이론적 가능) | cache | ⚪ Low |
| L10 | `EMPTY_ENTRY` shallow freeze — Map/Set 내부 mutable | fragile invariant | ⚪ Low |

---

## Group 1 — God file 분해 시급

### 1.1 `src/components/query/QueryTab/useQueryExecution.ts` (2026 LOC, hook 45개)

**Category**: A-1 (data hook 거대화) + A-2 (paradigm 분기 미분리).

**Mixed concerns (7)**: paradigm 라우팅(RDB/document) + 13개 mongosh
메서드 핸들러 + 3계층 Safe Mode 게이팅(block/confirm/warn) + history
기록 + dry-run(RDB) + Cmd+Z 위임 + cancel token 관리.

**Rule violations**:
- C-2: `useQueryExecution.ts:1154`, `:1894`, `:2000` — exhaustive-deps disable.

**Decomposition seams**:
- `dispatchMongoshCall` (line 748–1156) → `lib/mongo/mongoshDispatcher.ts`
  pure 또는 `useMongoshDispatch` hook.
- Safe Mode 3계층 게이팅 → `lib/safeMode.ts` 추가 함수 또는
  `useExecutionGate` hook.
- RDB vs Mongo executor 분리 → `useQueryExecutionRdb` +
  `useQueryExecutionDocument` (룰 A-2).

### 1.2 `src/components/schema/CreateTableDialog.tsx` (1591 LOC, hook 22개)

**Category**: A-3 (sub-component 추출 미흡).

**상태**: 이미 `CreateTableDialog/` 폴더에 `ForeignKeysTabBody`(739),
`IndexesTabBody`, `OrderedColumnPicker`, `Header`, `InlineFkPopover`가
형제로 분리됨. 본 파일에 columns CRUD JSX subtree만 남음.

**Rule violations**:
- C-2: `:962`.

**Decomposition seams**:
- ColumnsTabBody 추출만으로 ~600 LOC 감소 예상.

### 1.3 `src/components/rdb/DataGrid.tsx` (860 LOC, hook 40개, useEffect 11개)

**Category**: A-1 (data hook 미분리) + A-3.

**Smells**:
- useEffect 11개가 column order/width 동기화, query refresh,
  mount/unmount, prevProps tracking, dialog modal 감지 등에 산재.
- `:363` — `document.querySelector('[role="dialog"]')` 직접 DOM 조작
  (정당화 있으나 룰 위반).

**Rule violations**:
- C-2: `:170`, `FilterBar:105`.

**Decomposition seams**:
- column 메타데이터(order/width/hidden) → 전용 hook 또는 store slice.
  useEffect 4–5개 즉시 흡수 가능.
- dialog open 감지 → `useIsModalOpen` hook으로 DOM 조작 추상화.

### 1.4 `src-tauri/src/db/postgres/mutations.rs` (4129 LOC, prod ~1264 + test ~2865)

**Category**: 도메인 mod 분할 부재 (Rust).

**Mixed concerns (5)**: DROP/CREATE/ALTER TABLE + ADD/DROP COLUMN +
CREATE/DROP INDEX + ADD/DROP CONSTRAINT + CREATE/DROP TRIGGER.

**Large functions**: `create_table` 174 LOC, `alter_table` 100 LOC,
`add_constraint` 82 LOC.

**Decomposition seams**:
- `postgres/mutations/{table.rs, column.rs, index.rs, constraint.rs,
  trigger.rs}` 5개 파일로 분할.
- `mysql/mutations.rs`(1113 LOC)도 같은 패턴 — paired refactor.

### 1.5 `src-tauri/src/db/postgres/schema.rs` (1912 LOC, 23 public methods)

**Category**: 도메인 mod 분할 부재 (Rust).

**Mixed concerns (6)**: relational catalog + views + functions +
triggers + types + database admin + 성능 모니터링
(slow_queries/explain/server_activity).

**Asymmetry**: mysql/schema.rs는 10 method만 — 패러다임 추상화 누수
(stored function / trigger 같은 RDBMS 공통 개념의 인터페이스 격차).

**Decomposition seams**:
- `postgres/schema/{catalog.rs, views.rs, functions.rs, triggers.rs,
  admin.rs}` 5개로 분할.
- mysql 페어 정렬 또는 RdbAdapter trait method 정리.

---

## Group 2 — 룰 위반 (구조 신호)

### 2.1 B-1 위반: `useXStore.setState(...)` 직접 호출 (5건)

- `src/hooks/useSchemaTableMutations.ts:63, :75, :106, :117` —
  `useSchemaStore.setState({ tables })` 4건.
- `src/hooks/useConnectionSessionHydration.ts:47` —
  `useConnectionStore.setState({ focusedConnId, activeStatuses })`.

**Fix**: 두 hook 모두 store action으로 옮김.
- `schemaStore`에 `applyTableMutationResult` 액션 신설.
- `connectionStore`에 `hydrateSessionState` 액션 신설.

### 2.2 B-6 위반: store 내부 cross-store 의존 (6사이트)

`src/stores/workspaceStore.ts`:
- → `useConnectionStore.getState()` 4건 (line 87, 107, 674, 680).
- → `useDataGridEditStore.getState()` 2건 (line 286, 728).

**상태**: 코드 주석에 의도 명시(autofill + GC). 룰은 "hook 레벨에서만".

**Options**:
- (a) 의도적 예외로 ADR 작성 (실용 우선).
- (b) action을 hook 호출자가 합성하도록 시그니처 변경 (룰 준수).

### 2.3 C-2 위반: `exhaustive-deps` disable (23건, 모두 useEffect)

분포:
- `useQueryExecution.ts` 3건.
- 단일 사이트: `DataGridTable.tsx`, `FilterBar`, `DataGrid`,
  `DocumentFilterBar`, `DocumentDataGrid`, `AddDocumentModal`,
  `CreateTableDialog`, `DocumentDatabaseTreeData`.
- 페어 사이트(modal open 패턴): `DropTableDialog` ×2, `RenameTableDialog`
  ×2, `CreateTriggerDialog` ×2, `DropColumnDialog` ×2, `DropTriggerDialog`
  ×2, `AddColumnDialog` ×2.

**패턴**: 대부분 modal `open` 변화 시 form reset / debounce 의도적 stale
closure. ESLint Phase 2 도입 전 audit 대상.

**Fix**: modal form 패턴 → `useFormResetOnOpen(open, fn)` hook 일괄 추출
(disable 1곳 집중).

### 2.4 B-2 위반 의심: `useWorkspaceStore.getState()` in callback

`src/components/rdb/DataGrid.tsx:103` — 주석 "두 동기 setSorts 호출 합성
위해 fresh read 필요" → `no-restricted-syntax` disable.

**상태**: useCallback 안이라 render path 아님. 정당화 명시됨. store
action 합성(`mergeSorts`)으로 옮기는 것이 표준.

### 2.5 Non-store local UI persistence — hand-rolled `window.localStorage` (5+ 사이트)

Zustand store 도, `session-storage.ts` envelope 도 거치지 않고 컴포넌트
/ hook 이 `window.localStorage.{get,set}Item` 을 직접 호출하는 사이트.
영속 정책 (key prefix, migration, snapshot bootstrap) 우회.

| Site | Key 패턴 | 의도 |
|------|---------|------|
| `src/pages/HomePage.tsx:64, :73` | `RECENT_COLLAPSE_KEY` | 홈 "Recent" 섹션 접힘 상태 |
| `src/components/layout/Sidebar.tsx:32, :112` | `WIDTH_KEY` | sidebar 폭 (drag resize) |
| `src/components/connection/ConnectionGroup.tsx:43, :54` | `COLLAPSE_KEY` | group 접힘 상태 (groupId 별) |
| `src/hooks/useColumnWidths.ts:38, …` | `STORAGE_PREFIX` (per-table) | DataGrid column width override |
| `src/hooks/useHiddenColumns.ts:29, :42, :54` | `STORAGE_PREFIX` (per-table) | DataGrid 숨김 컬럼 |

**문제**:
1. **영속 정책 분기**: state-management 전략(Part D Q9 = SQLite atomic
   snapshot bootstrap) 이 적용 안 됨 — 이 5+ 사이트는 boot 후에도
   localStorage 직접 read.
2. **Cross-window 일관성**: workspace window 두 개 열린 상황 (single-
   instance + 두 launcher detach 가정) 에서 한 쪽 변경 시 다른 쪽
   reactive 갱신 인프라 없음. 다음 mount 까지 stale.
3. **Test isolation**: jsdom 의 localStorage 가 vitest 간 share —
   `beforeEach` 에서 prefix clear 명시 안 한 테스트는 cross-test leak.
4. **5MB total quota share**: workspace JSON debounce write 와 같은
   pool. 한 사이트가 폭주하면 다른 사이트 silent throw.

**Fix (Q20 lock, 2026-05-16)**: 5사이트 **모두 A (SQLite + emit_all)**
로 이주.
- (1) `RECENT_COLLAPSE_KEY` → `settings.home_recent_collapsed` boolean.
- (2) `WIDTH_KEY` → `settings.sidebar_width` integer. drag 중 D 메모리,
  mouseup 시 IPC (debounce 500ms).
- (3) `COLLAPSE_KEY` → `connection_groups.collapsed` boolean 컬럼 추가.
- (4) `columnWidths` → 신규 table `datagrid_column_prefs` 의 `widths_json`.
  PK `(connection_id, paradigm, db_name, namespace, table_name)`.
  drag end 시 IPC.
- (5) `hiddenColumns` → 같은 table 의 `hidden_columns_json`.

추가 (Q21): 각 영속 항목마다 reset-to-default affordance 가 직관적
위치에 머지되어야 함. Phase 6 audit 의무.

---

## Group 3 — 책임 과중 (god이라 부르긴 모호하나 큰 파일)

### 3.1 `src/stores/workspaceStore.ts` (953 LOC, 30+ setState 호출)

**Category**: A 경계 (god store 임계점).

ADR 0027로 tabStore 흡수 — 의도된 통합. 책임 5개: 탭 관리 + active 탭 +
closed history + dirty 마크 + sidebar 상태.

**건강도**: 응집도 높음. cross-store 의존 6건(2.2)만 정리하면 god 아님.

**잠재 분해**: closed history(`useClosedTabHistory`) 또는 dirty
tracking → 별도 store 가능하나 우선순위 낮음.

### 3.2 `src/components/datagrid/useDataGridEdit.ts` (945 LOC, hook 32개)

**Category**: A-1 (lib 추출 가능 pure) + A-2 (paradigm 분기 미분리).

**Mixed concerns (7)**: 셀 편집 lifecycle + pending edits map + undo
stack(max 50) + new/deleted row 추적 + SQL/MQL preview + commit error +
dangerous-mode confirm.

**Decomposition seams**:
- `pushUndoSnapshot`, `popUndoSnapshot` 등 undo stack 로직 →
  `lib/datagrid/undoStack.ts` (pure).
- paradigm 분기 → `useDataGridEditRdb` + `useDataGridEditDocument` (룰
  A-2). 우선순위는 `useQueryExecution` 분해 후.

### 3.3 `src/components/document/DocumentDataGrid.tsx` (1175 LOC, hook 44개)

**Category**: A-3 (sub-component 미분리) + A-1.

**Mixed concerns (7)**: dual-paradigm column model + column width
persistence + 인라인 tree panel + pending edits + MQL preview modal +
multi-cell ops + edit routing.

**Decomposition seams**:
- MQL preview modal → `MqlPreviewDialog` 컴포넌트.
- 인라인 tree panel (`DocumentTreePanel.tsx` 514 LOC 이미 분리됨) 의
  coordinate sync useEffect → `useTreePanelCoordinate` hook.

### 3.4 `src-tauri/src/commands/rdb/{schema.rs, ddl.rs, query.rs}` (1445 + 1325 + 1492 LOC)

**Category**: 핸들러 boilerplate 폭주.

**Pattern repetition**: `state.active_connections.lock() + match
adapter + ensure_expected_db + call inner` 패턴이 **38사이트 반복**.
Sprint 271c에 `ensure_expected_db`는 hoist 완료, lock + dispatch는 미.

**Decomposition seams**:
- 도메인별 분할: `commands/rdb/schema/{tables.rs, views.rs,
  functions.rs, triggers.rs, types.rs}` 등.
- boilerplate 매크로화: `dispatch_rdb!(state, connection_id, |adapter|
  { ... })` 또는 함수형 wrapper.

### 3.5 `src-tauri/src/models/schema.rs` (1625 LOC, 28 pub struct)

**Status**: ⚪ 28개 데이터 구조체가 한 파일. 응집도 OK (모두 schema
wire-format), 행동 0. **정상**.

**Optional**: SchemaInfo / TableInfo / ColumnInfo / IndexInfo /
ConstraintInfo / FilterCondition / ColumnChange / ViewInfo /
FunctionInfo / TriggerInfo / PostgresTypeInfo로 그룹화하면 navigation
향상. 시급도 낮음.

---

## Group 4 — 중복 패턴 (dialect 추상화 부재)

### 4.1 PostgreSQL ↔ MySQL identifier validation 중복 (~600 LOC)

- `src-tauri/src/db/postgres/mutations.rs`의 `validate_identifier`,
  `quote_identifier`.
- `src-tauri/src/db/mysql/mutations.rs`의 동일 로직 (backtick vs
  double-quote, 63/64 byte limit만 다름).

**Decomposition seam**: `db/sql/identifier.rs` 트레이트 — `trait
IdentifierDialect { fn quote(s: &str) -> String; fn max_len() -> usize;
}` + adapter별 impl. ADR 0028(mysql sqlx) 후 자연스러운 후속.

### 4.2 Modal `open` reset useEffect 패턴 (10건)

`DropTableDialog`, `RenameTableDialog`, `AddColumnDialog`,
`DropColumnDialog`, `CreateTriggerDialog`, `DropTriggerDialog` 등에서
modal open 시 form state reset. 모두 C-2 disable.

**Decomposition seam**: `useFormResetOnOpen(open, resetFn)` hook으로
통합 — 단일 disable 사이트.

### 4.3 RDB command handler 핵심 boilerplate (38사이트)

3.4 참조.

---

## Group 5 — 기타 신호 (작지만 누적)

### 5.1 거대 테스트 파일 — prod의 1.5–3배

- `CreateTableDialog.test.tsx` 3080 vs prod 1591 (1.94×).
- `useSqlAutocomplete.test.ts` 1341 vs prod 515 (2.60×).
- `useDataGridEdit` 테스트 4개 합 ~1854 vs prod 945 (~2×).

**Signal**: test가 prod의 2× 넘으면 god prod의 신호 또는 시나리오
커버리지 깊음. CreateTableDialog는 god 확인.

### 5.2 `console.error` in production (3건, 정당)

- `PreviewCopyButton.tsx:80, :93` — Clipboard API 실패 (정당).
- `logger.ts` 본체 — 라이브러리 패턴 (정당).

위반 아님.

### 5.3 직접 DOM 조작 (2건)

- `src/main.tsx:66` — `document.getElementById("root")` (React root, 정당).
- `src/components/rdb/DataGrid.tsx:363` —
  `document.querySelector('[role="dialog"]')` modal 감지. 정당화 가능
  하나 hook(`useIsModalOpen`)으로 추상화 가능.

---

## Notes (Part A)

- `mongoshParser.ts` (1069 LOC) — 1.x god list에 포함되지 않음. 단일
  책임(파서), pure, lib 분류 정상. ⚪
- `cteColumnCompletion.ts` (812 LOC) — 같은 이유로 정상.
- `sqlGenerator.ts` (835 LOC) — pure, ADR 0009 tri-state 룰 충실.
  정상.
- `useSqlAutocomplete.ts` (515 LOC) — useMemo 1개, store 1개 read.
  정상 (test 비대만 별도 신호 5.1).

---

# Part B — Frontend 상태 관리 논리적 분석

LOC / hook 갯수가 아니라 **이 store 가 자기 이름이 약속한 것만 하나? 두
store 가 같은 개념을 다르게 표현하나? 한 store 의 상태가 다른 store 와
모순 가능한가?** 시각.

대상 store (prod 10개):

| Store | LOC | 책임 |
|-------|-----|------|
| `workspaceStore.ts` | 953 | per-`(connId, db)` tabs / active / closed / dirty / sidebar |
| `schemaStore.ts` | 600 | RDB schema cache (per `(connId, db, schema)`) — 단, 5개 비-schema 메서드 표류 (L2) |
| `documentStore.ts` | 325 | Mongo databases / collections / fields / find / aggregate cache |
| `connectionStore.ts` | 320 | connections / groups / activeStatuses / focusedConnId |
| `dataGridEditStore.ts` | 180 | per-`(connId, schema, table)` pending edits + undo stack |
| `queryHistoryStore.ts` | 177 | history entries + globalLog (500 cap) |
| `mruStore.ts` | 177 | recent connection MRU |
| `favoritesStore.ts` | 152 | favorited tables |
| `themeStore.ts` | 115 | theme picker state |
| `safeModeStore.ts` | 57 | safe mode flags |

---

## L1 (🔴) `dataGridEditStore` 키 공간이 `workspaceStore` 보다 얕음 — invariant 누수

**모순**:

- `workspaceStore`: 워크스페이스 키 = `(connId, db)` (ADR 0027).
- `dataGridEditStore.entryKey(connId, schema, table)`: **`db` 차원
  없음**. `${connectionId}::${schema}::${table}`.

**시나리오**:

```
connection=pg-local
├─ workspaces["pg-local"]["db1"].tabs: [{ schema:"public", table:"users" }]
│   → pendingEdits 키: "pg-local::public::users"
└─ workspaces["pg-local"]["db2"].tabs: [{ schema:"public", table:"users" }]
    → pendingEdits 키: "pg-local::public::users"   ← 같은 키
```

두 db 에 같은 `public.users` 가 있고 사용자가 db1 에서 1행 수정 →
DbSwitcher 로 db2 전환. db2 의 사이드바 탭에서 같은 `public.users` 열면
**db1 의 pending edit 가 그대로 표시**. commit 누르면 db2 의 테이블에
잘못 적용될 위험.

**현재 lifecycle 가드**:
- `workspaceStore.removeTab` (line 286) → `purgeKey(connId, schema, table)`
  호출. db 차원 무시.
- `workspaceStore.clearForConnection` (line 728) → `purgeForConnection(connId)`.
  Connection 단위만 — db 단위 purge 없음.

**확인 필요**:
- `useDataGridEdit` 가 fetch 한 데이터 (특정 db 의 행) 와 store 의
  pendingEdits 가 다른 db 에서 만든 것인지 검증 안 함. PK 매칭 정도만.
- 실제 reproduction 시나리오 만들면 invariant 위반 확인 가능.

**Decomposition seam**:
- `entryKey(connId, db, schema, table)` 으로 확장 — workspace 키와 같은
  정밀도.
- 또는 `entryKey(workspaceKey: WorkspaceKey, tabId: string)` 상위 추상화 —
  탭 단위 격리 (다중 탭 같은 테이블 케이스 회피 가능).
- 마이그레이션 비용: `useDataGridEdit` 의 `key` 계산 (line 456) + store
  `purgeKey` / `purgeForConnection` / `entryKey` API 갱신. ~5사이트.

---

## L2 (🔴) `schemaStore` 의 책임 표류 — 5개 비-schema 메서드

`schemaStore` 의 11개 책임 중 5개가 schema-무관 IPC passthrough:

| 메서드 | 캐시? | state? | 본문 |
|--------|------|--------|------|
| `queryTableData` | ❌ | ❌ | `tauri.queryTableData(...)` 호출만 |
| `dropTable` | ❌ | ❌ | `tauri.dropTable(...)` 호출만 |
| `renameTable` | ❌ | ❌ | `tauri.renameTable(...)` 호출만 |
| `executeQuery` | ❌ | ❌ | `tauri.executeQuery(...)` 호출만 |
| `executeQueryBatch` | ❌ | ❌ | `tauri.executeQueryBatch(...)` 호출만 |

**Deletion test**: 5개 메서드를 schemaStore 에서 삭제하고 호출자가 직접
`lib/tauri/*` 호출하면 — store API 작아짐, 호출자 코드 동일. 복잡도 증가
0. **Pass-through 였음**.

**실제 호출처**:
- `DataGrid.tsx:59` — `queryTableData`.
- `useDataGridPreviewCommit.ts:123` — `executeQueryBatch`.
- `useSchemaTableMutations.ts:48,49` — `dropTable`, `renameTable`.
- `executeQuery` — grep 으로 호출처 확인 필요.

`lib/tauri/ddl.ts:27,67` 주석에 "compat wrapper" 표시 — 이미 마이그레이션
시작했다가 절반에서 멈춤.

**Decomposition seam**:
- 5개 메서드 store 에서 제거.
- 호출자 4사이트 → `lib/tauri/*` 직접 import.
- `schemaStore` 는 schema 캐시 + lifecycle 액션 (`load*`, `get*`,
  `clear*`, `prefetch*`) 만 남김. LOC ~500 으로 감소.

---

## L3 (🟡) `schemaStore.clearSchema` ≡ `clearForConnection` — dead alias

`schemaStore.ts:532–541` (`clearSchema`) 과 `schemaStore.ts:543–552`
(`clearForConnection`) 본문 **완전 동일**. 6개 캐시 모두
`deleteConn(state.X, connId)`.

주석(line 165–167) 합리화: "Same body as `clearForConnection` — the
alias survives for caller intent (\"disconnect\" vs \"DB switch\")".

**Caller grep 결과**:
- `clearSchema` 호출자: **prod 0건**. 이름만 살아있음.
- `clearForConnection` 호출자: 4건 (`useConnectionLifecycle`,
  `syncMismatchedActiveDb`, `queryHelpers`, ...).

특히 `useConnectionLifecycle.ts:16`:
```ts
const clearSchema = useSchemaStore((s) => s.clearForConnection);
```
**변수명 `clearSchema` ↔ 실제 method `clearForConnection`** — 의미적
합의 실패. 두 이름이 같은 행동인데 어느 쪽도 source of truth 아님.

**Decomposition seam**:
- `clearSchema` 삭제.
- 또는 `clearSchema` 만 남기고 `clearForConnection` 삭제 (호출처가 더
  많은 후자 유지가 자연).

---

## L4 (🔴) Connection cleanup 책임 분산 — paired 호출 보장 없음

Connection 삭제 / disconnect 시 cleanup 해야 하는 store:

| Store | Cleanup 메서드 | 누가 호출 |
|-------|----------------|----------|
| `connectionStore` | `removeConnection` 자체 cleanup | self |
| `schemaStore` | `clearForConnection(connId)` | `useConnectionLifecycle` + `syncMismatchedActiveDb` + `queryHelpers` |
| `documentStore` | `clearConnection(connId)` | `useConnectionLifecycle` + `DbSwitcher` |
| `workspaceStore` | `clearForConnection(connId)` | `HomePage:156` + `useWindowFocusHydration` |
| `dataGridEditStore` | `purgeForConnection(connId)` | **`workspaceStore.clearForConnection` chain** |

**문제**:
- 3개 dependent store cleanup 책임이 5+ 호출처에 분산.
- `workspaceStore` 만 `dataGridEditStore` 를 chain. `schemaStore` /
  `documentStore` 는 chain 안 됨.
- **Paired 보장 없음**: connection 삭제 시 모든 store cleanup invariant
  가 코드 어디에서도 보장 안 됨. 일부 site 는 schemaStore 만, 일부는
  workspaceStore 만, 일부는 둘 다.

**Reproduction 가능 시나리오**:
- `useConnectionLifecycle.disconnect()` 만 호출되는 경로 (예: 외부
  IPC event 로 인한 disconnect) 에서 `workspaceStore.clearForConnection`
  안 호출되면 → 해당 connection 의 탭 / pendingEdits 가 유령처럼 남음.

**Decomposition seam**:
- Option (a): Connection lifecycle 단일 진입점
  (`useConnectionLifecycle.disconnect()`) 가 모든 dependent store 에
  cleanup chain.
- Option (b): `connectionStore` 가 lifecycle event (`connection-removed`)
  emit + 다른 store 가 subscribe.
- 어느 쪽이든 cleanup invariant 가 1 곳에 표현.

---

## L5 (🟡) `queryHistoryStore.entries` vs `globalLog` — 이중성 정당화 부재

```ts
interface QueryHistoryState {
  entries: QueryHistoryEntry[];       // unlimited
  globalLog: QueryHistoryEntry[];     // capped at 500
}

addHistoryEntry: (entry) => {
  set((state) => ({
    entries: [newEntry, ...state.entries],
    globalLog: updatedGlobalLog,
  }));
}
```

**관찰 (정정 2026-05-16, state 문서 M-4 와 동일)**:
- `entries`: 무제한 누적 (메모리 누수 가능), **live source** — `QueryLog.tsx:32`,
  `QueryTab.tsx:57-58` 에서 active read. per-tab history panel 의 source.
- `globalLog`: 500 cap, cross-connection.
- `searchFilter` / `connectionFilter` / `filteredGlobalLog()` 는 모두
  `globalLog` 위에서 동작. `entries` 에 filter 적용 안 됨.
- `clearHistory()` 는 `entries` 만. `clearGlobalLog()` 는 `globalLog`
  만.

**진짜 문제** (이전 "dead state" 추측은 오류): **책임 중복** — 두 array
가 같은 entry 를 서로 다른 cap 정책 / 서로 다른 filter 정책으로 관리.
single source 가 자연.

**Decomposition seam**: state 문서 Phase 5 의 SQLite 이주 시 단일 table
로 통합. per-tab view 는 `WHERE connection_id = ? AND tab_id = ?` 로
derive. 두 array 모두 retire.

---

## L6 (🟡) `QueryMode` type alias — 두 store 에서 다른 의미

`workspaceStore/types.ts` 에서 export 하는 `QueryMode` 가
`queryHistoryStore` 에서도 import. 같은 type 의 의미가 두 store 에서 분열.

**`QueryTab.queryMode` (workspaceStore)** — 주석 `@deprecated`:
- RDB 새 tab: `"sql"`.
- Legacy persisted Mongo tab: `"find"` 또는 `"aggregate"`.
- 새 Mongo tab (sprint-309+): `undefined` (의도적 fallthrough).

**`QueryHistoryEntry.queryMode` (queryHistoryStore)**:
- "the **parsed mongosh method name**" — 14개 union 의 한 값.
- RDB: `"sql"`. Mongo: `"find"` / `"findOne"` / `"aggregate"` /
  `"countDocuments"` / `"estimatedDocumentCount"` / `"distinct"` /
  write methods.

같은 type, 다른 의미:
- Tab 의 `queryMode` → **legacy persisted hint** (deprecated, 마이그
  중).
- History 의 `queryMode` → **dispatched method name** (current).

**Decomposition seam**:
- 두 의미 type 분리. 예:
  - `QueryTab.legacyMongoMode?: "find" | "aggregate"` (좁은 deprecated).
  - `QueryHistoryEntry.dispatchedMethod: MongoshMethod | "sql"` (별도
    union).
- 같은 alias 공유 안 함.

---

## L7 (⚪) `workspaceStore` queryId stale guard 4 사이트 중복

`completeQuery`(L528), `failQuery`(L552),
`completeMultiStatementQuery`(L582), `completeQueryDryRun`(L632) — 모두
동일 guard:

```ts
if (
  current.queryState.status !== "running" ||
  !("queryId" in current.queryState) ||
  current.queryState.queryId !== queryId
) return state;
```

**B-4 룰 (store action 안의 stale guard) 자체는 준수**. 중복만 신호.

**Decomposition seam**: store-internal helper
`guardRunningQuery(tabId, queryId, updater)` 추출. ~30 LOC 감소.

---

## L8 (⚪) `workspaceStore` 파일에 selector hook 9개

`useCurrentWorkspaceKey`, `useWorkspaceKeyForConnection`,
`useCurrentWorkspace`, `useWorkspaceFor`, `useActiveTab`, `useCurrentTabs`,
`useActiveTabId`, `useDirtyTabIds`, `useClosedTabHistory`.

ADR 0027 정당화: "Hooks live here (not in `hooks/`) so the cross-store
dependency is co-located".

의도된 것. 단 9개는 많음. **Decomposition seam** (선택):
`workspaceStore/selectors.ts` sibling 분리. 의미 변경 0, navigation
향상.

---

## L9 (⚪) `paradigm` 정보 3 store 에 cache

- `connectionStore.connections[i].db_type` → `paradigmOf(db_type)` 가
  source.
- `workspaceStore.QueryTab.paradigm` — 탭 만들 때 cache.
- `queryHistoryStore.QueryHistoryEntry.paradigm` — 기록 시 cache.

connection 의 `db_type` 은 immutable 이라 drift 실용적으로 안 일어남.
**메모만**.

---

## L10 (⚪) `EMPTY_ENTRY` shallow freeze

```ts
export const EMPTY_ENTRY: PendingEntry = Object.freeze({
  pendingEdits: new Map(),       // ← Map 자체는 mutable
  pendingNewRows: [],
  pendingDeletedRowKeys: new Set(),
  undoStack: [],
});
```

`Object.freeze` 는 shallow. `EMPTY_ENTRY.pendingEdits.set(...)` 런타임
허용. 주석에 "Callers MUST treat it as read-only" 라고 적혀있지만
enforcement 없음. 컨벤션 의존 fragile invariant.

**Decomposition seam** (선택):
- `pendingEdits: ReadonlyMap` 같은 wrapper.
- 또는 `getEntry` 가 fresh empty 반환 (단 reference equality 깨짐 — 의도
  와 충돌).

현재 prod 에서 mutation 사고 사례 없음 — 메모 수준.

---

## Part B 우선순위 권장

| # | 발견 | 이유 |
|---|------|------|
| L1 | `dataGridEditStore` 키 공간 차원 누락 | 진짜 데이터 leak 가능. RDB 다중 db 사용 시 회귀 위험. **Invariant 위반**. |
| L4 | Connection cleanup 분산 | Paired 호출 안 보장 — 실제 lifecycle bug 잠재. Orchestrator 도입으로 단일 진입점. |
| L2 | `schemaStore` 책임 표류 | Deletion test 통과 (5 메서드, 호출처 4–5개). Store 인터페이스 작아짐. |

L1 은 reproduction 시나리오로 invariant 누수 검증 가치. L2 / L4 는 깔끔한
deepening — 작은 인터페이스 뒤에 같은 동작을 묶음.

---

## Related

- [`memory/conventions/refactoring/memory.md`](../../../memory/conventions/refactoring/memory.md)
  — B/D/C/A 4 카테고리 정의.
- [`docs/archives/backlogs/refactoring-candidates-2026-05-06.md`](../backlogs/refactoring-candidates-2026-05-06.md)
  (retired 2026-05-06) — 이전 wide-net scan, 본 문서가 후속.
- ADR 0025 — DataGrid self-managed (tanstack 미도입).
- ADR 0027 — per-workspace state store.
- ADR 0028 — MySQL adapter sqlx.
- ADR 0029 — mongosh parser handwritten.

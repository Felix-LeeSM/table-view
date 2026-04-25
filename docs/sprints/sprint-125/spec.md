# Master Spec — Workspace/Home Split + Paradigm Shells (Sprints 125-133)

## Feature Description

현재 Sidebar는 connection 관리(연결 CRUD/그룹/import-export)와 paradigm-specific 데이터 작업(스키마 트리/컬렉션 트리)을 하나의 토글 안에 우겨넣고 있다. paradigm이 4개(rdb / document / kv / search)로 늘어남에 따라 `SchemaPanel`이 god-component로 비대화되고, "DB switch는 새 connection 만들어야" 하는 UX 마찰과 raw query로 DB가 silently 바뀌는 footgun이 누적되고 있다.

이 시리즈는 다음 세 축을 동시에 정렬한다.

1. **Home / Workspace 풀스크린 분리**. Home은 paradigm-agnostic 연결 CRUD, Workspace는 다중-paradigm 탭이 공존하는 작업 화면. 두 화면은 swap.
2. **Workspace는 단일 인스턴스**. PG 탭, Mongo 탭, Redis 탭이 같은 TabBar에 공존. 사이드바는 active tab의 paradigm에 맞춰 통째로 갈아끼워짐.
3. **DB switcher 툴바**. 같은 connection에서 DB 전환을 일등 시민으로 노출. paradigm별 동작 분기:
   - PG: `(connection_id, db_name)` 키 sub-pool, LRU cap 8개
   - Mongo: in-connection `use_db`
   - Redis: `SELECT n`
   - SQLite: 숨김 (file = DB)
   - MySQL: in-connection `USE` (Phase 9 어댑터 도입 시 활성)
4. **Raw query DB-change footgun 보정**. 클라이언트 lex로 `USE` / `SET search_path` / `\c` / Redis `SELECT n` 감지 + 백엔드 cheap verify.

Phase 9 어댑터(SQLite/MySQL/Redis/ES) 추가는 이 시리즈가 끝난 뒤 셸 위에 drop-in 한다(별도 sprint).

## Decisions Locked

| Q | 결정 |
|---|---|
| Workspace 드롭다운 범위 | 현재 세션에 Open한 연결만 |
| 마지막 탭 닫힘 동작 | 빈 Workspace 유지 (자동 Home 복귀 X) |
| PG sub-pool 한도 | LRU cap 8개, 초과 시 가장 오래된 idle close |

## Architectural Targets (시리즈 종료 시점)

```
[Home Page]                             [Workspace Page]
ConnectionList + Group +     ←swap→     Toolbar(Conn▼ DB▼ Schema▼)
Import/Export + Recent                  + TabBar (multi-paradigm)
(paradigm-agnostic CRUD)                + WorkspaceSidebar (paradigm slot)
                                        + MainArea
```

WorkspaceSidebar trait:
```
WorkspaceSidebar
  ├─ RdbSidebar       (S126에서 SchemaPanel 추출)
  ├─ DocumentSidebar  (S126에서 SchemaPanel mongo 분기 추출)
  ├─ KvSidebar        (Phase 9, 이 시리즈 범위 외 placeholder)
  └─ SearchSidebar    (Phase 9, 이 시리즈 범위 외 placeholder)
```

공유 primitive (모든 shell이 import): TabBar, DataGrid, ResultGrid, QueryEditor, HistoryViewer, FavoritesPanel, ShortcutCheatsheet, CellDetailDialog.

## Sprint Breakdown

| Sprint | 제목 | 의존 | Profile |
|--------|------|------|---------|
| 125 | Home/Workspace 풀스크린 swap | — | mixed |
| 126 | WorkspaceSidebar paradigm slot | 125 | mixed |
| 127 | Workspace 툴바 + connection switcher | 126 | mixed |
| 128 | DB 메타 레이어 (list_databases) | 127 | mixed |
| 129 | DocumentSidebar 정합 | 126 (병렬 가능) | mixed |
| 130 | DB switcher: PG sub-pool (LRU 8) | 128 | mixed |
| 131 | DB switcher: Mongo in-connection | 128 | mixed |
| 132 | Raw-query DB-change 감지 + verify | 130, 131 | mixed |
| 133 | 단축키 + e2e 회귀 가드 마무리 | 132 | browser |

Phase 9 어댑터 트랙(이 시리즈 외, 셸 안정 후 drop-in):
- S134 SQLite + file-picker connection form
- S135 MySQL adapter + RDB shell 재사용 + USE lex 활성
- S136 Redis adapter + KvSidebar 구현
- S137 ES adapter + SearchSidebar + DSL editor

## Per-Sprint Acceptance Criteria

### S125 — Home/Workspace 풀스크린 swap
1. 앱 부팅 시 Home 노출 (ConnectionList + Group + Import/Export + 최근 사용).
2. Connection의 "Open" 클릭 → Workspace로 swap, schema/탭 정상 로딩.
3. Workspace 좌상단 `[← Connections]` → Home 복귀, 열려있던 탭 zustand에 보존.
4. `SidebarModeToggle`은 Workspace에서 제거 (Schemas 단일 모드).
5. 기존 import-export 시나리오는 Home 안에서 통과.
6. 기존 e2e가 Home 진입 → Open 흐름으로 갱신되어 모두 그린.

### S126 — WorkspaceSidebar paradigm slot
1. `<WorkspaceSidebar>`가 `useTabStore` active tab의 `paradigm`을 읽어 분기.
2. PG 탭 활성 → `<RdbSidebar>` (현 SchemaPanel의 RDB 분기).
3. Mongo 탭 활성 → `<DocumentSidebar>` (현 SchemaPanel의 mongo 분기 추출).
4. 기타 paradigm은 placeholder("not yet supported in this shell").
5. 활성 탭 없으면 empty state.
6. 사이드바 검색/expand-collapse/즐겨찾기 등 기존 동작 유지.

### S127 — Workspace 툴바 + connection switcher
1. `<WorkspaceToolbar>`가 TabBar 위에 렌더 — `[Conn ▼] [DB ▼] [Schema ▼]`.
2. Conn 드롭다운 = **현재 세션에 Open한 연결만**. 색-도트 + paradigm 아이콘.
3. Conn 선택 시 active 탭이 그 연결의 마지막 탭으로 전환(없으면 빈 탭 생성).
4. DB/Schema 드롭다운은 read-only 표시(클릭 동작은 S128 이후).
5. active 탭 변경 시 toolbar 값 즉시 일치.

### S128 — DB 메타 레이어
1. 백엔드 command `list_databases(connection_id)` 추가:
   - PG: `SELECT datname FROM pg_database WHERE datistemplate=false`
   - Mongo: `listDatabases`
   - 그 외: 빈 배열 + Unsupported 안 던짐.
2. DB 드롭다운이 enabled 상태에서 클릭 시 목록 fetch + 표시.
3. 선택 동작은 여전히 no-op(S130/S131에서 활성).
4. 권한 부족 시 단일 항목(현재 DB) 폴백.

### S129 — DocumentSidebar 정합 (병렬)
1. DocumentSidebar 트리에 schema 레벨 노출되지 않음 (database → collection 2-레벨).
2. 즐겨찾기/검색/expand-collapse 모두 유지.
3. RDB 가정(`database.schema.table`)이 Mongo 코드 경로에서 제거.

### S130 — DB switcher: PG sub-pool (LRU 8)
1. 백엔드 ConnectionPool 키를 `(connection_id, db_name)`로 확장. credentials 재활용.
2. 새 command `switch_active_db(connection_id, db_name)` → sub-pool 활성, lazy 생성.
3. **LRU cap 8개**. 초과 시 가장 오래된 idle 풀 close.
4. 프런트: DB 드롭다운 클릭 → switch + 사이드바 schema 재로딩.
5. 기존 탭은 자기 db_name 유지(탭마다 (connection_id, db_name) 보유).
6. 새 탭 생성 시 toolbar의 현재 DB 사용.
7. credentials 재입력 없음.

### S131 — DB switcher: Mongo in-connection
1. Mongo adapter `use_db(session_id, db_name)` 추가.
2. Toolbar DB 클릭 → 세션 DB 전환 → DocumentSidebar collections 재로딩.
3. PG와 Mongo 탭 동시 공존, 각자 독립 DB context.

### S132 — Raw-query DB-change 감지 + verify
1. `src/lib/sqlDialectMutations.ts` 신규: 토큰 기반 lexer.
   - PG: `\c <db>`, `SET search_path TO <schema>`
   - MySQL: `USE <db>`
   - Redis: `SELECT <n>`
2. Query run hook: statement 실행 직후 lex 매치 → toolbar optimistic 업데이트.
3. 백엔드 cheap verify (`current_database()` 등) 후속 호출, 불일치 시 toast 경고 + 보정.
4. 주석/문자열 안 매치 false positive 0 (단위 테스트로 fix).

### S133 — 단축키 + e2e 회귀 가드 마무리
1. 단축키:
   - Cmd+, → Home swap
   - Cmd+1..9 → workspace tab switch
   - Cmd+K → connection switcher (toolbar 드롭다운 키보드 오픈)
2. ShortcutCheatsheet에 신규 단축키 노출.
3. 신규 e2e spec: Home↔Workspace swap, paradigm 사이드바 swap, DB switcher (PG/Mongo), raw-query 감지.
4. Sprint 124-125 회귀 가드 모두 그린.
5. CI 4-job 모두 그린.

## Components to Create

- `src/stores/appShellStore.ts` — `screen: 'home' | 'workspace'` 상태
- `src/pages/HomePage.tsx`
- `src/pages/WorkspacePage.tsx`
- `src/components/workspace/WorkspaceSidebar.tsx`
- `src/components/workspace/RdbSidebar.tsx`
- `src/components/workspace/DocumentSidebar.tsx`
- `src/components/workspace/WorkspaceToolbar.tsx`
- `src/components/workspace/ConnectionSwitcher.tsx`
- `src/components/workspace/DbSwitcher.tsx`
- `src/components/workspace/SchemaSwitcher.tsx`
- `src/lib/sqlDialectMutations.ts` (S132)
- 백엔드: `src-tauri/src/commands/connection.rs`에 `list_databases`, `switch_active_db` (PG sub-pool LRU)
- 백엔드: `src-tauri/src/db/mongodb.rs`에 `use_db`

## Components to Modify

- `src/App.tsx` — appShell 라우팅
- `src/components/layout/Sidebar.tsx` — connections-mode 분기 제거, Workspace에서만 사용
- `src/components/layout/SidebarModeToggle.tsx` — 삭제 또는 무력화
- `src/components/sidebar/SchemaPanel.tsx` — RDB / Document 분리 추출 (S126)
- `src/stores/connectionStore.ts` — sub-pool 키 확장 지원
- `src/stores/tabStore.ts` — 탭에 db_name 추가
- 백엔드: `src-tauri/src/db/postgres.rs` — sub-pool 매니저
- e2e: `e2e/app.spec.ts`, `e2e/data-grid.spec.ts`, `e2e/connections.spec.ts`, `e2e/raw-query-edit.spec.ts` 등

## Data Flow

### Home → Workspace 전환
```
HomePage onOpenConnection(id)
  → connectionStore.activate(id)
  → appShellStore.setScreen('workspace')
  → WorkspacePage mount → 마지막 활성 탭 또는 첫 탭 자동 생성
```

### Active tab 전환 시 사이드바 swap
```
TabBar onSelect(tabId)
  → tabStore.setActiveTabId(tabId)
  → WorkspaceSidebar reads activeTab.paradigm
  → renders <RdbSidebar | DocumentSidebar | ...>
  → toolbar reads activeTab.{conn_id, db_name, schema}
```

### DB switch (PG)
```
DbSwitcher onSelect(target_db)
  → invoke('switch_active_db', { conn_id, db_name: target_db })
    → backend: pool[(conn_id, target_db)] 또는 lazy create (LRU evict)
  → schemaStore.refresh(conn_id, target_db)
  → 새 탭 default db = target_db
  → 기존 탭은 자기 db_name 유지
```

### Raw-query DB-change 감지
```
QueryEditor.run(sql)
  → backend: execute
  → frontend: parseDialectMutations(sql) match
    → optimistic toolbar update
  → backend: list_current_db_or_schema() (cheap)
  → mismatch → toast + correct
```

## Edge Cases

- **빈 Workspace**: 마지막 탭/연결 닫으면 빈 상태 유지 (자동 Home 복귀 X).
- **권한 부족 list_databases**: PG가 `pg_database` 거부 시 단일 폴백 (현재 DB만).
- **LRU evict 중 사용자 클릭**: evict가 active 탭의 풀을 close하면 안 됨. active 탭이 사용 중인 풀은 LRU 후보에서 제외.
- **raw-query lex false positive**: 주석/문자열 안의 `USE x` 매치 금지. 토큰 기반 lexer 단위 테스트 강제.
- **stale tab 상태**: 연결이 disconnect된 후 그 연결의 탭이 "Run" → 명시적 reconnect prompt.
- **탭 db_name 마이그레이션**: 기존 localStorage zustand 상태에 db_name 없음. 마이그레이션 함수에서 connection의 default db로 채움.
- **paradigm placeholder shell 클릭**: KV/Search shell이 active일 때 사용자가 무언가 클릭하면 graceful "Phase 9 예정" 안내.
- **connection switcher 빈 상태**: 첫 진입 시 Open한 연결 0개면 드롭다운 자체 disabled + "Home에서 연결을 여세요" 힌트.

## Validation Gates (전 sprint 공통)

각 sprint 완료 시:
1. `pnpm vitest run` — 통과
2. `pnpm tsc --noEmit` — 0 에러
3. `pnpm lint` — 0 에러
4. `pnpm contrast:check` — 0 새 위반
5. 해당 sprint의 신규/갱신 e2e spec 그린
6. Sprint 122-124 회귀 가드 미파손
7. CI 4-job (Frontend / Rust / Integration / E2E) 그린

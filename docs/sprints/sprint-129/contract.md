# Sprint Contract: sprint-129

## Summary

- **Goal**: Mongo 코드 경로에서 RDB 가정(`schema/table`을 `database/collection`로 alias)을 제거. `TableTab`에 document-paradigm 전용 필드 `database?: string` / `collection?: string`을 도입하고 mongo write/read 사이트를 모두 새 필드로 이관한다. 기존 persisted localStorage 탭은 마이그레이션 함수에서 schema/table → database/collection로 채운다. UI 측면에선 DocumentDatabaseTree의 RDB-folder 메타포를 정리하고 search 필터를 추가(parity).
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + e2e 정적)

## Background (이미 잡힌 사실)

- 현재 `DocumentDatabaseTree.tsx:96-97`가 mongo collection 탭을 추가하면서 `schema: dbName, table: collectionName`로 alias.
- `MainArea.tsx:37-38` 동일 alias로 `<DocumentDataGrid>`에 `database={tab.schema!} collection={tab.table!}` 전달.
- `DocumentDataGrid.tsx:161-162`는 또 alias `schema: database, table: collection`로 다시 query store에 넘김.
- `TableTab.schema?` / `TableTab.table?`가 **RDB / document 양쪽에서 piggyback**되고 있음.
- DocumentDatabaseTree는 이미 "database → collection" 2-level. 이번 sprint는 단지 RDB-folder 메타포(Folder/FolderOpen 아이콘)를 정리.
- `SchemaTree`에는 favorite/search input이 없음(parity 의무는 가벼움). 단순 search 필터만 추가.
- `loadPersistedTabs` (`tabStore.ts:485-533`)에 마이그레이션 분기 있음.

## In Scope

### Type & Store
- `TableTab` 인터페이스 확장:
  - `database?: string` — document paradigm 전용. RDB 탭은 set 안 함.
  - `collection?: string` — document paradigm 전용. RDB 탭은 set 안 함.
- `tabStore.loadPersistedTabs` 마이그레이션 추가:
  - 탭이 `paradigm === "document"`이고 `database` 또는 `collection`가 missing → `database: t.schema, collection: t.table`로 채움 (loss-free).
- 기존 `schema` / `table`은 보존 (RDB 호환 + 마이그레이션 안전성). **단, document write 사이트들은 더 이상 schema/table에 dbName/collName을 쓰지 않는다.**

### Mongo write / read 사이트
- `DocumentDatabaseTree.tsx`: `addTab` 호출 시 `database: dbName, collection: collectionName, paradigm: "document"`. `schema/table`도 동일 값을 추가로 넣되(legacy persistence 호환), 명시 alias 주석으로 라벨한다 — **신규 read 사이트는 schema/table을 보지 않는다**.
- `MainArea.tsx`: document case에서 `<DocumentDataGrid database={tab.database!} collection={tab.collection!}>`. 마이그레이션이 backfill하므로 non-null assertion 안전.
- `DocumentDataGrid.tsx`: 내부 alias `schema: database, table: collection`은 query store wire 호환을 위해 일시 유지. 단 다음 sprint(S130/S131)에서 store 시그니처 정리 시 자연스럽게 제거.

### UI 정합 (DocumentDatabaseTree)
- 데이터베이스 row 비주얼: `Folder/FolderOpen` 메타포(RDB 잔재) 제거. `Database` 아이콘 단일로 단순화. 토글 chevron(`ChevronRight/Down`)은 유지.
- collection row의 `coll.document_count`는 그대로 — document 카운트는 mongo 고유.
- 신규: "Filter databases" search input — 기존 `databaseList` 위에 한 줄 input. 클라이언트 사이드 필터(case-insensitive substring). 빈 input이면 전체.
- 검색 결과 0 → 기존 "No databases visible to this connection"과 다른 메시지: "No databases match '<query>'".
- collection도 동일 input 하나로 cross-filter (database name 또는 expanded database 안의 collection name 매치 시 표시).
- 신규 input: `[aria-label="Filter databases and collections"]`.

### 에러/경계 보존
- `loadDatabases` 실패 시 기존 에러 카드 유지(메시지 동일).
- 새 fields가 비어 있는 탭(legacy persisted 후 마이그레이션 미완) → MainArea fallback: `tab.database ?? tab.schema`, `tab.collection ?? tab.table` 한 단계 백업 (마이그레이션이 이미 backfill하지만 safe net).
- `addTab` 단일 호출 안에서 `schema/table/database/collection` 모두 일관되게 한 트랜잭션.

## Out of Scope

- DocumentDataGrid 내부 store wire 시그니처 변경 (S130/S131에서 active DB context와 함께).
- `DocumentDatabaseTree`에 favorite (별표) 기능 — RDB 트리에도 없음.
- `DocumentDatabaseTree`의 가상 스크롤 / 1645 LOC급 폴리싱 — 현재 트리가 작아 불필요.
- raw-query DB-change 감지 → S132.
- 단축키 / 신규 e2e spec → S133.
- 백엔드 (`src-tauri/`) 변경.

## Invariants

- 기존 vitest 1948개 모두 그린.
- 기존 e2e 시나리오 회귀 0건.
- TableTab 인터페이스 확장은 **모든 신규 필드 optional** — persisted localStorage 호환 보장.
- `tabStore.loadPersistedTabs` 외에 마이그레이션 사이트 추가 금지.
- 사용자 시야 회귀 0: PG 워크스페이스 / Mongo 워크스페이스 모두 기존과 동일하게 동작.
- 백엔드 변경 0.
- aria-label 가이드 준수, 기존 라벨 보존.

## Acceptance Criteria

- `AC-01` `TableTab` 인터페이스에 `database?: string` / `collection?: string` 추가, 두 필드 모두 optional.
- `AC-02` `DocumentDatabaseTree` `addTab` 호출에 `database: dbName, collection: collectionName` 포함. `schema/table`도 backwards-compat로 동일 값 넣되 신규 read 사이트는 사용하지 않는다.
- `AC-03` `MainArea.tsx` document case가 `<DocumentDataGrid database={tab.database ?? tab.schema!} collection={tab.collection ?? tab.table!}>` (또는 동급 fallback)로 갱신.
- `AC-04` `tabStore.loadPersistedTabs`에 document 탭 backfill 마이그레이션 추가 — `database` / `collection`가 missing이면 schema/table에서 채움.
- `AC-05` DocumentDatabaseTree 비주얼: 데이터베이스 row의 `Folder/FolderOpen` 메타포 제거, `Database` 아이콘 단일로 단순화.
- `AC-06` 신규 search input — `[aria-label="Filter databases and collections"]`. case-insensitive 매치, 빈 결과 시 "No databases match '<query>'" 메시지.
- `AC-07` search 매치는 database 이름 또는 expanded database 내 collection 이름 둘 다.
- `AC-08` 신규 단위 테스트:
  - `tabStore.test.ts`: persisted document 탭이 schema/table만 갖고 있을 때 loadPersistedTabs 후 database/collection backfill 확인.
  - `DocumentDatabaseTree.test.tsx`: search 필터 동작, addTab 호출에 database/collection 포함, Folder 아이콘 미렌더, Database 아이콘 렌더, 빈 검색 결과 메시지.
- `AC-09` 검증 명령 모두 그린:
  - `pnpm vitest run` (1948+)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - e2e 정적 컴파일 회귀 0건
- `AC-10` PG 워크스페이스 기존 동작 그대로(SchemaTree 호출, RDB 탭 자료 모델 동일). 기존 데이터 그리드 테스트 회귀 0.

## Design Bar / Quality Bar

- search input 위치: 기존 "Databases" 라벨 줄 아래 한 줄. compact, `<input>` size sm.
- 키보드 포커스 가능, Esc로 input clear (또는 동일 패턴 재사용 가능 시).
- 검색은 클라이언트 사이드 only (네트워크 fetch 추가 없음).
- 검색 매치 시 collection은 자동 expand 되어 보여줌 (추가 클릭 없이).
- 검색 결과 mid-fetch 발생 시 race condition 없음 — 결과는 zustand store에서 가져오므로 fetch와 독립.
- a11y: input이 변경되더라도 screen reader가 "showing X of Y databases" 알림. (`aria-live="polite"` 추가 권장, 단 contract 강제 X.)

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 1948+ 그린.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. e2e 정적 컴파일 회귀 0.

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 5개 검증 명령 outcome
  - AC-01..AC-10 매핑(file:line / test:line)
  - DocumentDatabaseTree addTab 호출 코드 인용 (database/collection 포함)
  - tabStore loadPersistedTabs 마이그레이션 코드 인용
  - MainArea fallback 패턴 코드 인용
- Evaluator must cite:
  - 각 AC pass/fail의 구체 evidence
  - persisted document 탭 마이그레이션이 실제로 동작 (test 코드)
  - search 매치 0 시 정확한 메시지 노출
  - PG 경로 회귀 0 (SchemaTree 호출 지점 변경 없음)

## Test Requirements

### Unit Tests (필수)
- `tabStore.test.ts`:
  - persisted document 탭 + database/collection 누락 → load 후 backfill
  - persisted RDB 탭 → database/collection 그대로 undefined (RDB tab은 안 채움)
  - persisted document 탭 + database 이미 채워짐 → 그대로 유지 (idempotent)
- `DocumentDatabaseTree.test.tsx`:
  - addTab 호출에 database/collection 포함
  - search input 입력 → 매치 db만 표시
  - search 매치 0 → "No databases match" 메시지
  - search input이 collection 이름 매치 → expanded db 안에서 표시
  - Folder 아이콘 미렌더 (queryByTestId or by role)
  - Database 아이콘 렌더 (queryByLabelText 등)

### Coverage Target
- 신규 코드 (TableTab 확장, 마이그레이션, search): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: Mongo 연결 → DB 트리 → collection 더블 클릭 → tab 생성 (database/collection 채움)
- [ ] 회귀: PG 연결 → SchemaTree → 탭 생성 (database/collection 미설정, schema/table 그대로)
- [ ] 마이그레이션: localStorage에 legacy mongo 탭 → load 후 database/collection 채워져 있음
- [ ] 검색: "ad" 입력 → admin 매치, 다른 DB 숨김
- [ ] 경계: search 매치 0 → 기존 "No databases visible..." 가 아닌 "No databases match" 노출

## Test Script / Repro Script

1. `pnpm install` (lockfile 변경 없으면 skip)
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src/stores/tabStore.ts` (TableTab 확장 + loadPersistedTabs 마이그레이션)
  - `src/components/schema/DocumentDatabaseTree.tsx` (addTab 새 필드, search input, Folder 정리)
  - `src/components/layout/MainArea.tsx` (document case fallback)
  - 신규 *.test.tsx / 기존 test 보강
  - **금지**: 백엔드, RDB 탭 자료 모델, SchemaTree, 단축키, 신규 e2e
- Merge order: 단일 commit `feat(workspace): document tabs lose RDB schema/table aliases (sprint 129)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest 1948 + e2e 정적 컴파일 회귀 0

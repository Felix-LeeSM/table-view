# Master Spec — Phase 10: Workspace UX Cleanup + Paradigm/DBMS-aware Split (Sprints 134–140)

## Feature Description

Phase 10 closes 12 real-usage UX gaps surfaced by the user after the Phase 9 toolbar/DB-switcher rollout. The phase deletes the toolbar `ConnectionSwitcher` (its job collapses back to Home double-click), deletes the toolbar `SchemaSwitcher` (its job collapses into the sidebar tree), makes the sidebar tree DBMS-shape-aware (no artificial schema layer for MySQL/SQLite), unifies sidebar single-click=preview / double-click=persist semantics across paradigms, fixes the dirty marker following focus instead of the dirty tab, fixes the Mongo "switch DB always shows default" bug, and then splits two big surfaces by paradigm/dialect: the connection form (PG / MySQL / SQLite / Mongo / Redis) and the query editor (RDB SQL with per-dialect keyword sets, and a separate Mongo MQL editor). The phase ends by encrypting export/import with a master password (AES-GCM) so passwords can ride along, with a multi-select selection UI (all / group / single / multi-conn / multi-group / partial group). All of this is triggered by user feedback collected during a single working session (lesson `2026-04-27-workspace-toolbar-ux-gaps`); the cluster ships as one phase because the changes touch overlapping seams (toolbar, sidebar, tab semantics, connection model, editor model, import/export pipeline) and benefit from a single refactor pass.

## Sprint Breakdown (ordered)

| Sprint | 제목 | Profile | Issues |
|--------|------|---------|--------|
| 134 | ConnectionSwitcher 제거 + Home double-click swap fix + Disconnect 버튼 + Dirty marker 위치 버그 | mixed | #1, #2, #6, #9 |
| 135 | Toolbar SchemaSwitcher 제거 + Sidebar tree DBMS-agnostic (schema layer 자동 생략) + Disabled toolbar tooltip 갱신 | mixed | #7 |
| 136 | Sidebar 클릭 의미 통일 (single=preview / double=persist) + Function category overflow / scroll cap | mixed | #8, #11 |
| 137 | Mongo switch-DB stale → sidebar reload fix + PG row-count 라벨/툴팁 명확화 | mixed | #10, #12 |
| 138 | DBMS-aware connection form 분리 (PG / MySQL / SQLite / Mongo / Redis) + DBMS별 기본값 | mixed | #4 |
| 139 | Paradigm-aware query editor 분리: MongoQueryEditor 별 컴포넌트 + RDB dialect별 keyword 사전 (pg/mysql/sqlite) | mixed | #3 |
| 140 | 암호화 export/import (master password / AES-GCM) + 부분 선택 UI | mixed | #5 |

각 sprint는 독립 구현·평가 가능하며, 앞 sprint의 acceptance criteria가 그린이어야 다음 sprint를 시작한다. harness chain은 PASS evaluator 직후 commit 자동.

---

## Per-Sprint Acceptance Criteria

### Sprint 134 — ConnectionSwitcher 제거 + Home swap fix + Disconnect + Dirty marker

**Goal**: Toolbar의 connection 선택 기능을 완전 제거하고, Home double-click을 단일 swap 경로로 통합한다. Workspace에서 active connection을 끊을 수 있는 "Disconnect" 컨트롤을 refresh 옆에 두고, 잘못된 탭에 떠 있던 dirty marker를 실제 dirty 탭으로 옮긴다.

**Verification Profile**: mixed (vitest + manual UI)

**Acceptance Criteria**:
- **AC-S134-01**: `src/components/workspace/ConnectionSwitcher.tsx` 및 `ConnectionSwitcher.test.tsx`가 저장소에서 삭제되고, `WorkspaceToolbar.tsx`가 더 이상 import 하지 않는다. `pnpm tsc --noEmit`이 0 에러로 통과한다.
- **AC-S134-02**: `src/App.tsx`에서 Cmd+K 핸들러(`open-connection-switcher` dispatch)가 제거된다. `App.test.tsx`의 Cmd+K 시나리오가 "no-op (deprecated)" 어서션으로 갱신된다.
- **AC-S134-03**: `src/components/shared/ShortcutCheatsheet.tsx`의 SHORTCUT_GROUPS에서 "Open connection switcher" / "Cmd+K" 항목이 제거되고, 동봉 테스트가 더 이상 그 라벨을 기대하지 않는다.
- **AC-S134-04**: Home에서 현재 active connection이 아닌 다른 connection을 double-click하면 `connectionStore`의 active/focused id와 workspace의 active tab이 새 connection으로 전환된다 — 신규 vitest test가 이를 검증한다 (이전에는 focus만 바뀌고 swap 안 됨).
- **AC-S134-05**: Workspace에서 새 컴포넌트(예: `<DisconnectButton>`)가 refresh 아이콘 인접 위치에 렌더링되고, 클릭 시 `connectionStore.disconnectFromDatabase(activeId)` + active tab이 disconnected 상태로 전이. 버튼은 `aria-label="Disconnect"` + tooltip 노출. Disconnected 상태에서 disabled.
- **AC-S134-06**: Dirty marker는 `dirtyTabIds.has(tab.id)`에 따라 그려지며 active tab과 무관하게 정확한 탭에 표시된다. 신규 vitest test가 (a) tab1 dirty + tab2 active → tab1에만 dot, (b) tab2로 dirty 이동 + tab1 focus 유지 → tab2에만 dot 케이스를 검증.
- **AC-S134-07**: 회귀 가드: Cmd+1..9, Cmd+,, Cmd+W, Cmd+T, Cmd+S 단축키 기존 테스트 미파손. e2e static compile (`pnpm exec eslint e2e/**`) 그린.
- **AC-S134-08**: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`, `cargo test --lib`, `cargo clippy -- -D warnings`, `pnpm contrast:check` 6개 게이트 모두 그린.

**Components to Create / Modify**:
- DELETE `src/components/workspace/ConnectionSwitcher.tsx`
- DELETE `src/components/workspace/ConnectionSwitcher.test.tsx`
- MODIFY `src/components/workspace/WorkspaceToolbar.tsx` — ConnectionSwitcher import 제거
- MODIFY `src/App.tsx` — Cmd+K 효과 제거, Cmd+, / Cmd+1..9 보존
- MODIFY `src/App.test.tsx` — Cmd+K 시나리오 갱신
- MODIFY `src/components/shared/ShortcutCheatsheet.tsx` — Cmd+K 항목 제거
- MODIFY `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx`
- MODIFY `src/components/connection/ConnectionItem.tsx` 또는 `ConnectionList.tsx` — double-click 핸들러가 단순 focus가 아닌 active swap을 호출하도록 (기존 `onActivate` 분기 강화)
- MODIFY `src/pages/HomePage.tsx` — `handleActivate`가 다른 connection 더블클릭 시에도 동작하도록 보장
- CREATE `src/components/workspace/DisconnectButton.tsx` + `.test.tsx`
- MODIFY `src/components/layout/MainArea.tsx` (또는 refresh 버튼 호스트) — DisconnectButton mount
- MODIFY `src/components/layout/TabBar.tsx` (또는 dirty 마커 그리는 곳) — `dirtyTabIds.has(tab.id)` 사용 확인 + 회귀 테스트

---

### Sprint 135 — SchemaSwitcher 제거 + Sidebar DBMS-agnostic + Tooltip 갱신

**Goal**: Toolbar에서 schema를 선택하는 UI를 제거하고 schema 선택권은 sidebar tree에 통합한다. Sidebar tree는 DBMS shape에 따라 schema layer를 동적으로 생략한다 (PG/MSSQL은 database→schema→table, MySQL/SQLite는 database→table 2-레벨, Mongo는 database→collection 2-레벨 — 이미 처리됨). 비활성 toolbar 버튼들의 stale 안내 문구("Coming in Sprint 130")는 모두 현실에 맞는 이유 설명으로 교체.

**Verification Profile**: mixed (vitest + visual)

**Acceptance Criteria**:
- **AC-S135-01**: `src/components/workspace/SchemaSwitcher.tsx`와 `SchemaSwitcher.test.tsx`가 삭제되고 `WorkspaceToolbar.tsx`에서 import가 사라진다.
- **AC-S135-02**: PG connection의 sidebar tree는 `database → schema → table` 3-레벨 그대로 표시. MySQL connection은 `database → table` 2-레벨, schema 노드를 절대 그리지 않는다 (현재 placeholder schema 행이 있다면 제거).
- **AC-S135-03**: SQLite connection은 file = DB이므로 sidebar에 단일 root → table list 1-레벨. 인공적인 "main" schema 행 없음.
- **AC-S135-04**: Mongo connection은 `database → collection` 2-레벨 (S129 회귀 가드).
- **AC-S135-05**: 모든 disabled toolbar 컨트롤(예: 남아있는 read-only 표시기)의 tooltip이 "Coming in Sprint 130" 등 stale 문구를 포함하지 않는다 — 대신 "Read-only — change schema in the sidebar tree" 류의 현실 안내. grep test가 "Coming in Sprint" 정규식 0 매치를 강제한다.
- **AC-S135-06**: `<SchemaTree>` 또는 sidebar 트리 컴포넌트가 `connection.db_type`에 따라 schema layer를 fold/skip 하는 분기를 가진다. 신규 vitest test가 db_type별 트리 깊이를 어서션한다.
- **AC-S135-07**: 회귀 가드: PG schema/expand/collapse/즐겨찾기/검색 동작 미파손. Sprint 126/129 sidebar swap 테스트 그린.
- **AC-S135-08**: 6개 게이트 그린.

**Components to Create / Modify**:
- DELETE `src/components/workspace/SchemaSwitcher.tsx` + `.test.tsx`
- MODIFY `src/components/workspace/WorkspaceToolbar.tsx`
- MODIFY `src/components/schema/SchemaTree.tsx` — db_type-aware 트리 깊이 분기 (혹은 `pickSidebar` 확장)
- MODIFY `src/components/workspace/RdbSidebar.tsx` — db_type 전달
- MODIFY `src/components/workspace/DocumentSidebar.tsx` — 회귀 가드만
- MODIFY `src/components/workspace/DbSwitcher.tsx` — disabled tooltip stale 문구 교체
- CREATE/UPDATE 신규 vitest test `src/components/schema/SchemaTree.dbms-shape.test.tsx`
- 회귀 검색용 grep test (e.g. `tests/no-stale-sprint130-tooltip.test.ts`)

---

### Sprint 136 — Sidebar 클릭 통일 + Function category overflow

**Goal**: Sidebar에서 single-click = preview tab(임시), double-click = persistent tab으로 PG와 Mongo 양쪽 모두 동일하게 동작한다 (현재 PG는 single로 즉시 persist, Mongo만 preview semantics). Function 카테고리 클릭 시 모든 함수가 펼쳐져 sidebar 레이아웃을 깨는 버그를 max-height + 가상화/scroll로 cap 한다.

**Verification Profile**: mixed

**Acceptance Criteria**:
- **AC-S136-01**: PG sidebar에서 table row 단일 클릭 → preview tab이 열린다 (`tab.preview === true`). 같은 클릭을 다른 row로 옮기면 동일한 preview tab 1개가 새 row로 swap (탭 누적 X). 신규 vitest test가 어서션.
- **AC-S136-02**: PG sidebar에서 같은 row를 double-click → preview flag가 false로 promote 되어 persistent. 다른 row 클릭해도 닫히지 않음.
- **AC-S136-03**: Mongo sidebar의 collection 클릭이 동일 모델을 따른다 (single=preview, double=persist).
- **AC-S136-04**: 같은 row를 단일 클릭 두 번하면 preview tab이 자기 자신 위에 머물고 새 탭이 생기지 않는다 (idempotent).
- **AC-S136-05**: Function 카테고리(또는 임의 카테고리) 노드 expand 시 sidebar 컨테이너가 max-height(예: 50vh) + overflow-y-auto로 스크롤되며, 외부 레이아웃을 밀지 않는다. 신규 vitest test가 함수 50개 fixture로 컨테이너 scroll 가능성을 어서션.
- **AC-S136-06**: 같은 카테고리 안에서 사용자 입력 가능한 filter input이 등장 (function 이름 substring) — 이미 SchemaTree에 검색이 있다면 카테고리 단위 scope. 옵션이지만 max-height와는 독립.
- **AC-S136-07**: 회귀 가드: 즐겨찾기, 우클릭 메뉴, 키보드 네비게이션 미파손.
- **AC-S136-08**: 6개 게이트 그린.

**Components to Create / Modify**:
- MODIFY `src/stores/tabStore.ts` — `preview: boolean` 필드 + `promoteTab(tabId)` action (이미 존재 시 통합)
- MODIFY `src/components/schema/SchemaTree.tsx` — single-click handler가 `addQueryTab({ preview: true })` 또는 swap, double-click이 promote
- MODIFY `src/components/schema/DocumentDatabaseTree.tsx` — 동일 모델 적용
- MODIFY `src/components/layout/TabBar.tsx` — preview tab은 italic / dotted underline 시각 단서 (기존 컨벤션 따름)
- MODIFY `src/components/schema/SchemaTree.tsx` — function category container max-height + overflow
- 신규 vitest tests for preview semantics + overflow

---

### Sprint 137 — Mongo switch-DB stale fix + PG row-count 명확화

**Goal**: Mongo에서 toolbar로 DB를 swap해도 sidebar collection list가 default DB를 고집하는 버그를 잡는다. PG sidebar의 row-count 숫자가 estimate인지 exact인지 사용자가 알 수 없으므로 라벨/툴팁을 명확히 한다.

**Verification Profile**: mixed (vitest + cargo test + manual)

**Acceptance Criteria**:
- **AC-S137-01**: `src-tauri/src/db/mongodb.rs::list_collections`가 stored default db가 아닌 "현재 active db"(S131에서 `use_db`로 설정한 값)를 사용한다 — 현재 stale 원인을 코드/테스트로 식별 후 fix. 신규 cargo test가 `use_db("alpha")` 후 `list_collections()` 결과가 alpha의 컬렉션을 반환함을 어서션.
- **AC-S137-02**: 프런트: `DbSwitcher`에서 Mongo DB 전환이 일어나면 `DocumentDatabaseTree`가 새 DB의 collections를 즉시 fetch (이전 캐시 invalidate). 신규 vitest test (모킹된 invoke).
- **AC-S137-03**: PG sidebar의 table row count 숫자에 (a) `aria-label`/tooltip "Estimated row count (pg_class.reltuples)" 포함, OR (b) 우클릭 → "Show exact COUNT(*)" 액션 + 결과 inline 표시 — 둘 중 하나가 구현되어야 한다. 사용자가 숫자의 의미를 알 수 있어야 함.
- **AC-S137-04**: 거대 테이블(예: reltuples > 10M) 가드: 우클릭 exact count 실행 시 confirm dialog "This may be slow on large tables — continue?" 노출.
- **AC-S137-05**: 회귀 가드: PG sidebar 트리 expand/collapse, S132 raw-query DB-change 감지 미파손.
- **AC-S137-06**: 6개 게이트 + cargo test 그린.

**Components to Create / Modify**:
- MODIFY `src-tauri/src/db/mongodb.rs` — `list_collections` 인자/내부 상태 정정 + cargo test
- MODIFY `src-tauri/src/commands/document/` 관련 command (메타 fetch 진입점)
- MODIFY `src/components/schema/DocumentDatabaseTree.tsx` — DB 변경 시 fetch 트리거 (effect deps에 active db 추가)
- MODIFY `src/components/schema/SchemaTree.tsx` — row count cell에 tooltip / 컨텍스트 메뉴 액션
- CREATE `src-tauri/src/commands/rdb/exact_row_count.rs` (또는 기존 query.rs에 핸들러 추가) — `SELECT COUNT(*)` 실행
- 신규 vitest + cargo test 동반

---

### Sprint 138 — DBMS-aware Connection Form

**Goal**: 단일 ConnectionDialog가 모든 DBMS에 대해 같은 필드(host/port/user/password/db)를 보여주고 user 기본값이 "postgres"로 박혀있던 버그를 해결한다. DBMS별로 다른 필드 집합과 기본값을 가지는 form을 분리.

**Verification Profile**: mixed (vitest + visual)

**Acceptance Criteria**:
- **AC-S138-01**: `ConnectionDialog`가 선택된 `db_type`에 따라 다음 form shape를 보인다:
  - PG: host, port (default 5432), user (default `postgres`), password, database (default `postgres`), SSL
  - MySQL: host, port (default 3306), user (default `root`), password, database, SSL
  - SQLite: file path picker (host/port/user/password 필드 자체 부재), database name = file path basename
  - MongoDB: host, port (default 27017), user (optional), password (optional), auth_source, replica_set, tls_enabled, default database
  - Redis: host, port (default 6379), username (optional, ACL), password (optional), database index (0–15, default 0), tls_enabled
- **AC-S138-02**: db_type을 변경하면 form이 그 DBMS의 기본값으로 reset (단, 사용자가 이미 입력한 host 등은 보존하는 보수적 머지). 신규 vitest test로 어서션.
- **AC-S138-03**: 어떤 DBMS도 default user가 `postgres`로 박히지 않는다 (PG만 `postgres`).
- **AC-S138-04**: SQLite form은 "Choose file" 버튼 + native file picker 또는 textbox (Tauri file picker plugin) — host/port 필드는 렌더링되지 않는다.
- **AC-S138-05**: 폼 UI는 `<ConnectionDialog>` 단일 컴포넌트가 내부에서 DBMS별 sub-component(`<PgFormFields>`, `<MysqlFormFields>`, `<SqliteFormFields>`, `<MongoFormFields>`, `<RedisFormFields>`)를 routing — paradigm enum + db_type switch에 `assertNever`.
- **AC-S138-06**: URL parsing 모드는 PG/MySQL/Mongo/Redis에 대해 그대로 작동, SQLite는 file path 직접 입력으로 fallback.
- **AC-S138-07**: 신규 vitest test 5개 (DBMS당 1개) — 기본값, 필드 존재/부재, db_type 전환, save payload shape.
- **AC-S138-08**: 6개 게이트 그린. 백엔드 connection_test command 변경 없음 (form payload는 기존 ConnectionConfig 스키마와 호환).

**Components to Create / Modify**:
- MODIFY `src/types/connection.ts` — `DATABASE_DEFAULTS`를 port 외에 user/db까지 포함하는 형태로 확장 (예: `DATABASE_DEFAULT_FIELDS: Record<DatabaseType, { port; user; database }>`).
- CREATE `src/components/connection/forms/PgFormFields.tsx` (+ test)
- CREATE `src/components/connection/forms/MysqlFormFields.tsx`
- CREATE `src/components/connection/forms/SqliteFormFields.tsx`
- CREATE `src/components/connection/forms/MongoFormFields.tsx`
- CREATE `src/components/connection/forms/RedisFormFields.tsx`
- MODIFY `src/components/connection/ConnectionDialog.tsx` — db_type switch routing (escape-hatch dialog 위치 유지)
- MODIFY `src/components/connection/ConnectionDialog.test.tsx` — DBMS별 시나리오 추가

---

### Sprint 139 — Paradigm-aware Query Editor

**Goal**: SQL editor가 paradigm 분기 없이 SQL keyword 사전을 쓰는 lesson(2026-04-27)을 닫는다. Mongo는 별도 컴포넌트(`MongoQueryEditor`)로 추출, RDB는 단일 SQL editor가 connection의 db_type에 따라 dialect별 keyword 사전(pg / mysql / sqlite)을 swap.

**Verification Profile**: mixed

**Acceptance Criteria**:
- **AC-S139-01**: `MongoQueryEditor`가 신규 컴포넌트로 추출된다. 자체 autocomplete provider는 MQL operators(`$match`, `$group`, `$lookup`, `$project`, …) + collection 필드명만 제공하고 SQL keyword 0개.
- **AC-S139-02**: `QueryTab`이 `paradigm === "document"` 일 때 `<MongoQueryEditor>`를 렌더, `paradigm === "rdb"` 일 때 `<SqlQueryEditor>` (또는 기존 `<QueryEditor>` rdb-only로 정정).
- **AC-S139-03**: Rdb editor는 connection.db_type에 따라 CodeMirror `SQLDialect`를 swap 하고, autocomplete keyword 집합도 dialect별로 (pg → `RETURNING`, `ILIKE`, `SERIAL`; mysql → `LIMIT n,m`, `AUTO_INCREMENT`; sqlite → `PRAGMA`, `WITHOUT ROWID`). 사전 swap이 실제로 일어남을 vitest로 어서션.
- **AC-S139-04**: Redis paradigm은 query editor에서 collection 개념이 없으므로 placeholder ("Redis ad-hoc query is coming in Phase 11") 또는 단순 textarea — 이 sprint는 PG/MySQL/SQLite + Mongo만 active, Redis editor는 non-goal.
- **AC-S139-05**: paradigm/db_type swap 시 mongo extensions가 SQL editor에 새지 않고 그 역도 마찬가지 — 회귀 vitest test.
- **AC-S139-06**: 6개 게이트 그린. e2e static compile 그린.

**Components to Create / Modify**:
- MODIFY `src/lib/sqlDialect.ts` — dialect별 keyword 사전 export
- CREATE `src/lib/sqlDialectKeywords.ts` (or extend) — `getKeywordsForDialect(dialect: SqlDialectId): string[]`
- CREATE `src/components/query/MongoQueryEditor.tsx` + test
- RENAME / NARROW `src/components/query/QueryEditor.tsx` → `SqlQueryEditor.tsx` (또는 thin router)
- CREATE `src/components/query/SqlQueryEditor.tsx`
- MODIFY `src/hooks/useSqlAutocomplete.ts` — dialect 인자
- MODIFY `src/hooks/useMongoAutocomplete.ts` — MongoQueryEditor 전용
- MODIFY `src/components/query/QueryTab.tsx` — paradigm switch routing

---

### Sprint 140 — Encrypted Export/Import + Multi-select 선택 UI

**Goal**: Export 파일이 plain JSON이라 password를 못 싣는 현 상태를 닫는다. Master password 기반 AES-GCM 암호화 export, import 시 master password 입력 → 복호화. 선택 UI는 (a) 전체, (b) 그룹 단위, (c) 단일 connection, (d) 다중 connection multi-select, (e) 그룹 다중 multi-select, (f) 그룹 내 일부만 선택 (partial group).

**Verification Profile**: mixed (vitest + cargo test + visual)

**Acceptance Criteria**:
- **AC-S140-01**: 새 백엔드 command `export_connections_encrypted(ids, master_password)`가 AES-256-GCM (random nonce, PBKDF2 또는 Argon2id KDF, salt + nonce 포함) ciphertext payload를 반환. 신규 cargo test 가 (a) 라운드트립 (b) wrong password rejection (c) tamper detection (auth tag fail) 검증.
- **AC-S140-02**: 새 command `import_connections_encrypted(payload, master_password)`가 payload를 복호화 후 ConnectionConfig[] 반환. 잘못된 password → `AppError::AuthFailed` 또는 동등한 식별 가능한 에러.
- **AC-S140-03**: 프런트 `ImportExportDialog`에 Master password 입력란이 추가된다. Export 시 빈 password 거부 (min length 8); Import 시 빈 password로는 복호화 시도 안 함.
- **AC-S140-04**: Export pane의 selection UI:
  - "All" 체크박스 (이미 존재) + 그룹 헤더 체크박스 (그룹 단위) + 개별 connection 체크박스
  - 그룹 헤더 체크박스는 indeterminate 상태(부분 선택)를 시각적으로 표현
  - 선택된 connection 카운트가 헤더에 표기 ("X connections, Y groups selected")
  - 신규 vitest test가 6개 시나리오(전체 / 단일 그룹 / 단일 conn / 멀티 conn / 멀티 그룹 / partial group) 모두 어서션
- **AC-S140-05**: Export 결과는 plain JSON이 아닌 envelope 포맷 (e.g. `{ version, kdf, salt, nonce, ciphertext, ... }`). 기존 plain JSON export와 별도 format으로 명시 — backward import는 plain JSON도 받지만 password 필드는 `null` 처리.
- **AC-S140-06**: Wrong password로 import 시도 시 사용자에게 명확한 inline error ("Incorrect master password — the file could not be decrypted"). 토큰 5개 미만 차이로 멈추는 oracle attack 방지: 항상 동일한 message + 동일한 latency 범위.
- **AC-S140-07**: 회귀 가드: Sprint 96/이전 import-export e2e 미파손 — plain JSON 파일은 여전히 import 가능 (passwords are skipped, 사용자에 notice).
- **AC-S140-08**: 6개 게이트 + cargo test 그린.

**Components to Create / Modify**:
- MODIFY `src-tauri/src/storage/crypto.rs` — `aead_encrypt(plaintext, master_password)` / `aead_decrypt(payload, master_password)` (KDF + AES-GCM)
- MODIFY `src-tauri/src/commands/connection.rs` — `export_connections_encrypted`, `import_connections_encrypted`
- MODIFY `src/lib/tauri.ts` — 신규 command 시그니처
- MODIFY `src/components/connection/ImportExportDialog.tsx` — master password 필드 + 새 selection UI
- CREATE `src/components/connection/import-export/SelectionTree.tsx` (group/conn checkbox tree, indeterminate)
- CREATE `src/components/connection/import-export/MasterPasswordField.tsx`
- 신규 vitest + cargo test 동반

---

## Global Acceptance Criteria (모든 sprint 공통)

1. `pnpm vitest run` 통과, 신규 테스트 동반.
2. `pnpm tsc --noEmit` 0 에러.
3. `pnpm lint` 0 에러.
4. `pnpm contrast:check` 0 새 위반.
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` 통과.
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` 0 경고.
7. e2e static compile (`pnpm exec eslint e2e/**`) 그린.
8. 기존 회귀 가드(Sprint 122–133) 미파손.
9. 신규 컴포넌트는 다크 모드 지원 + a11y(`aria-label`/role) 동반.
10. 사용자 입력에 따른 destructive 동작(예: import overwrite, disconnect)은 명시적 confirm 또는 reversible.

---

## Data Flow Notes (cross-cutting)

### S134 ConnectionSwitcher 제거 — 영향받는 SoT
```
Before  ToolbarConnSwitcher.onValueChange → setActiveTab (only)
After   Home doubleClick → connectionStore.connectToDatabase + setActiveConnection + setScreen('workspace')
```
Cmd+K hook(`App.tsx`) 제거 → ShortcutCheatsheet 항목 제거 → ConnectionSwitcher event listener 자체가 사라지므로 `open-connection-switcher` event 발신/수신부 모두 dead code.

### S134 Disconnect 동작
```
DisconnectButton.onClick
  → invoke('disconnect_database', { connection_id })
  → connectionStore.activeStatuses[id] = { type: 'disconnected' }
  → 활성 탭은 그대로 두되 query/edit 시도 시 reconnect prompt
```

### S135 Sidebar tree shape
```
DbAdapter.list_databases / list_schemas / list_tables 호출 패턴은 동일.
프런트 SchemaTree가 db_type → tree depth resolver를 통해 schema layer를 skip:
  postgresql / mssql → render schema row
  mysql / mariadb / sqlite → schema row 자체 미렌더 (tables가 database 자식)
  mongodb → DocumentDatabaseTree 분기 (이미 분리)
```

### S136 Preview tab semantics
```
TabStore add: { preview: boolean }
Single click row → if preview tab exists with same paradigm → mutate target; else create with preview=true
Double click row → upsert with preview=false (promote)
Editing a preview tab (sql change) auto-promotes to preview=false (이미 dirty 시).
```

### S137 Mongo active-db propagation
```
DbSwitcher (mongo) → invoke('use_db', { connection_id, db_name })
  → backend MongoAdapter.use_db sets stored_active_db
  → frontend invalidates DocumentDatabaseTree cache for connection
  → fetch_collections() reads adapter.list_collections() which now uses stored_active_db
```

### S140 Encrypted envelope shape (decision lock)
```json
{ "v": 1, "kdf": "argon2id", "salt": "<b64>", "nonce": "<b64>",
  "alg": "aes-256-gcm", "ciphertext": "<b64>", "tag_attached": true }
```

---

## UI States

### Loading
- DisconnectButton(S134): clicking disables button + spinner until backend ack.
- Sidebar tree(S135/S136/S137): db_type-aware skeleton — 동일 폭 placeholder rows.
- Encrypted import/export(S140): "Decrypting…" / "Encrypting…" with progress dots.

### Empty
- Workspace with no active connection (S134): 안내 문구 + "Open a connection from Home (Cmd+,)" 안내.
- Function category(S136) 빈 경우: "No functions in this schema" — 기존 텍스트 유지.

### Error
- Wrong master password(S140): inline error 아래 master password input.
- Mongo use_db 실패(S137): toast.error "Failed to switch DB: <reason>".
- Disconnect 실패(S134): toast.error + 버튼 enabled로 복귀.

### Success
- Export(S140) 성공 시 download 트리거 + toast "Exported N connections (encrypted)".
- Sidebar swap(S135/S137): tree가 새 모양으로 즉시 렌더 + smooth transition.

---

## Edge Cases

- **Schema-less DBMS sidebar(S135)**: MySQL connection이 PG 시절 schema가 들어있던 stale localStorage state를 가졌을 때 — sidebar는 schema row를 렌더하지 않고 zustand 마이그레이션이 schema 키를 무시.
- **Redis paradigm + query editor(S139)**: Redis는 collection 개념이 없으므로 query editor 자체를 placeholder로 두거나, 단순 RESP 명령 textarea — 이 phase는 placeholder만 유지하고 본격 구현은 비-목표.
- **암호화 import wrong password(S140)**: 동일 메시지/latency로 응답 (timing oracle 방지). UI에서는 5번 실패 후 30초 throttle (best effort, 백엔드 enforce 권장).
- **Dirty marker race(S134)**: tab 저장(commit)이 진행 중인 상태에서 사용자가 다른 탭으로 focus 변경 → save가 끝나기 전 dirtyTabIds에서 제거되지 않음(저장 완료 시점에서 제거). active tab 변경은 dirty 표시에 영향을 주지 않음. 회귀 vitest test로 보장.
- **Preview tab clicking same row twice(S136)**: idempotent — 새 탭 X, preview tab이 동일 row에 머무르며 promote 안 됨. 사용자가 explicit double-click 시에만 promote.
- **Home double-click을 active connection에 했을 때(S134)**: no-op 또는 단순 workspace로 swap (이미 active이므로 connect 재시도 X).
- **DBMS-aware form db_type 전환(S138)**: 사용자가 PG에서 MySQL로 전환할 때 host/password는 보존, port/user는 신 DBMS의 default로 reset (현재 user="postgres" 박힌 버그를 비추는 핵심 시나리오).
- **Mongo switch DB 후 stale 사이드바(S137)**: backend stored_active_db만 바뀌고 frontend cache가 갱신 안 되는 케이스를 vitest로 강제 reproduce 후 fix.
- **Encrypted export with 0 selected connections(S140)**: "Select at least one connection to export" inline error, save 버튼 disabled.
- **partial group 선택(S140)**: 그룹 헤더 indeterminate 체크박스 상태 + 선택된 자식만 export payload에 포함.
- **Function category overflow(S136)**: 함수 1000개 fixture에서 sidebar 외부 레이아웃이 변하지 않아야 함 (`getBoundingClientRect` 어서션).

---

## Non-goals

- 새 paradigm 추가 (Cassandra, ClickHouse, DynamoDB, Snowflake, BigQuery 등).
- 실시간 collaboration / multi-user.
- 모바일/태블릿 반응형 레이아웃.
- Redis ad-hoc query editor 본격 구현 (S139은 placeholder만).
- Phase 7 Elasticsearch / Phase 8 Redis 어댑터 본격 구현 (S138 form은 시그니처만; 백엔드 어댑터 추가는 별 sprint).
- Master password key escrow / recovery.
- 자동 패스워드 강도 측정기.
- AES-GCM 외 다른 cipher 옵션.

---

## Verification Hints (per sprint, most useful evidence)

| Sprint | 가장 빠른 sanity check |
|--------|---------------------|
| S134 | `pnpm vitest run src/App.test.tsx src/pages/HomePage.test.tsx src/components/layout/TabBar.test.tsx` + grep `ConnectionSwitcher` returns 0 hits |
| S135 | `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` + grep `Coming in Sprint 130` returns 0 hits |
| S136 | `pnpm vitest run src/stores/tabStore.test.ts src/components/schema/SchemaTree.test.tsx` |
| S137 | `cargo test --lib mongodb::tests::list_collections_uses_active_db` + frontend vitest mongo cache test |
| S138 | `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx` (5 DBMS 시나리오) |
| S139 | `pnpm vitest run src/components/query/QueryTab.test.tsx src/components/query/MongoQueryEditor.test.tsx` |
| S140 | `cargo test --lib storage::crypto::tests::roundtrip` + `cargo test --lib storage::crypto::tests::wrong_password_rejected` + frontend selection-tree vitest |

---

## References

- Architecture: `memory/architecture/memory.md`
- Conventions: `memory/conventions/memory.md`
- Roadmap: `memory/roadmap/memory.md`
- Decisions (focused id, paradigm enum): `memory/decisions/memory.md`
- Phase 10 trigger lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Phase 9 master spec (shape reference): `docs/sprints/sprint-125/spec.md`
- Sprint 133 evidence (toolbar/Cmd+K state of the world we are unwinding): `docs/sprints/sprint-133/handoff.md`

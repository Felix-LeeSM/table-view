# Phase 11 — 2026-04-27 사용자 피드백 12건 master spec

> 본 spec은 사용자와 합의된 **고정 스펙**이다 (lesson:
> `2026-04-27-feedback-spec-first-tdd`). 각 sprint는 이 spec의 슬라이스를
> 받아 **실패하는 테스트 → 구현 → 통과** 사이클로 진행한다. 테스트가
> 구현보다 먼저다 — 단위/통합/e2e 중 항목 성격에 맞게 선택.

## Feature Description

Phase 10 종료 후 사용자가 실제 사용에서 발견한 12개 UX/기능 갭을 한번에
정리한다. 핵심은 (1) **Launcher / Workspace 분리 창 아키텍처**(Q1=C),
(2) **paradigm + DBMS-aware 자동완성 분리**(Q3=B with shared helpers),
(3) **Sidebar 단일화된 schema 표시**(Q4=B), (4) **테이블 단일 클릭 +
preview tab parity**, (5) **암호 포함 / 임의 선택 가능한 encrypted
export**.

## Decisions (사용자 합의)

- **Q1 = C** — Launcher (720×560 fixed) / Workspace (1280×800 resizable)
  분리된 Tauri 윈도우, in-process 백엔드 단일.
- **Q2 = B** — Connection 전환 SoT는 Launcher만. Workspace 내부의
  connection switcher / Cmd+K connection picker 제거.
- **Q3 = B** — Completion engine을 DBMS별로 완전 분리(`PgCompletion`,
  `MysqlCompletion`, `SqliteCompletion`, `MongoCompletion`). 단,
  공통 로직(접두사 매칭, FROM-clause 컨텍스트 추출, identifier escape
  규칙 helper)은 `lib/completion/shared.ts` 로 추출해 재활용.
- **Q4 = B** — 모든 schema 가 sidebar 트리에 동시에 펼쳐져 보임. Topbar
  schema selector 제거. **DBMS에 schema 개념이 없으면(MySQL/SQLite/
  MongoDB) 테이블/컬렉션을 flat list 로** 표시 (schema 폴더 노드 없음).
- **Q5 = iv** — 추정치(`n_live_tup` 등) 즉시 `~12,345` 로 표시 → 셀
  hover 시 백엔드 `count_rows_exact` 호출로 정확값 fetch & 캐시 → tilde
  제거. SQLite 는 추정 메타가 없어 즉시 `?` → 동일 lazy fetch.

## Sprint Breakdown (실행 순서)

> 사용자 합의에 따라 **isolated fix 들을 먼저** 끝내고 큰 architectural
> 변경(launcher/workspace 분리)은 마지막에 실행. 디렉토리 번호 =
> 실행 순서. AC 라벨은 topic id (변경 시 churn 없게 유지).

| 실행 # 디렉토리 | 주제 | 원래 topic | 항목 |
|---|---|---|---|
| sprint-141 | Disabled tooltip 카피 정리 | AC-146-* | #7-tooltips |
| sprint-142 | Tab UX (PG 단일 클릭 preview + dirty marker) | AC-147-* | #8 #9 |
| sprint-143 | Row count UX + Mongo DB persistence | AC-148-* | #10 #12 |
| sprint-144 | Sidebar 단일 schema view + Functions filter | AC-145-* | #7-schema #11 |
| sprint-145 | Completion engine split (4 DBMS) | AC-144-* | #3 |
| sprint-146 | DBMS-aware ConnectionDialog | AC-143-* | #4 |
| sprint-147 | Selective encrypted export | AC-149-* | #5 |
| sprint-148 | Connection SoT 정리 + Disconnect | AC-142-* | #2 #6 |
| sprint-149 | Launcher/Workspace 분리 창 | AC-141-* | #1 |

## Per-Sprint Acceptance Criteria

### Sprint 141 — Launcher/Workspace 분리 창 (#1)
- AC-141-1 앱 시작 시 **launcher 윈도우만** 표시, 720×560 고정
  (resize/maximize 비활성), 화면 중앙. Workspace 윈도우는 hidden.
- AC-141-2 launcher 의 connection 항목 더블클릭 → 백엔드 connect 성공
  시 Tauri event `workspace:open` emit → workspace 윈도우가 visible+
  focus, launcher 는 `hide()` (메모리/state 유지).
- AC-141-3 workspace 의 "Back to connections" 버튼 → event
  `launcher:show` → workspace `hide()`, launcher 다시 visible.
  **백엔드 connection pool 은 유지** (재오픈 시 재연결 없이 즉시).
- AC-141-4 launcher 닫기 → 앱 종료. workspace 닫기 → launcher 로 복귀
  (Back 과 동일 동작).
- AC-141-5 새로 생긴 두 윈도우 lifecycle 통합 테스트 (vitest +
  WebviewWindow mock 또는 e2e wdio 기반) — 시작/오픈/Back/종료 4단계가
  의도한 visibility 상태를 거치는지 검증.

### Sprint 142 — Connection SoT + Disconnect (#2 #6)
- AC-142-1 Workspace 안의 모든 connection switcher / Cmd+K connection
  picker UI 가 제거되어 코드에 더 이상 존재하지 않는다.
- AC-142-2 launcher 에서 다른 connection 더블클릭 → workspace 가 그
  새 connection 으로 swap (sidebar/topbar 가 새 이름·DB 반영). 기존
  workspace 탭은 새 connection 에 맞게 close 또는 graceful migrate
  (테스트로 동작 명시).
- AC-142-3 Workspace toolbar 에 `[aria-label="Disconnect"]` 버튼이
  존재하고, 클릭 시 백엔드 disconnect → launcher 복귀 (`Back` 과 동일
  최종 상태).
- AC-142-4 Disconnect 후 launcher 에서 같은 connection 다시 더블클릭
  하면 정상 재연결 (pool eviction 후 재생성).

### Sprint 143 — DBMS-aware ConnectionDialog (#4)
- AC-143-1 DBMS 드롭다운에서 PostgreSQL 선택 시 default user=
  `postgres`, port=5432.
- AC-143-2 MySQL 선택 시 default user=`root`, port=3306.
- AC-143-3 SQLite 선택 시 host/port/user/password 입력란 비표시,
  대신 `[aria-label="Database file"]` 파일 경로 입력 + 파일 picker
  버튼 표시.
- AC-143-4 MongoDB 선택 시 default user= 빈 문자열 (atlas-style),
  port=27017. URI 모드 토글 노출은 향후 Sprint 로 이월(out-of-scope).
- AC-143-5 DBMS 전환 시 이전 form 값 중 호환되는 건 유지(name 등),
  비호환 필드(SQLite ↔ 기타)는 reset.

### Sprint 144 — Completion engine split (#3)
- AC-144-1 `lib/completion/` 아래 `pg.ts`, `mysql.ts`, `sqlite.ts`,
  `mongo.ts`, `shared.ts` 가 존재. 각 DBMS 모듈은 자체 keyword set +
  catalog-aware 후보 생성기 export.
- AC-144-2 `shared.ts` 는 prefix matching, identifier quoting helper,
  FROM/INTO 컨텍스트 파서 (SQL 공통)를 export — PG/MySQL/SQLite 모듈은
  이를 import 해 사용. Mongo 모듈은 `shared.ts` 의 prefix matching 만
  공유.
- AC-144-3 QueryEditor 가 connection paradigm + db_type 으로 모듈을
  스위치한다. 잘못된 페어링(예: PG connection 에 mongo completion
  로드)은 unit test 로 reject.
- AC-144-4 PG editor 에 `RETURNING` 자동완성, MySQL editor 에는
  `RETURNING` 비-제안. 반대로 MySQL 에 `LIMIT n,m` 패턴 도움말, PG 에
  비-제안. (각 모듈 한 항목 이상 DBMS-specific 차이 단언.)
- AC-144-5 Mongo editor `db.` 입력 시 `find`, `aggregate`,
  `insertOne` 후보 표시. SQL 키워드(`SELECT`)는 제안 후보에 절대
  포함되지 않음.

### Sprint 145 — Sidebar schema unified view + Functions filter (#7-schema #11)
- AC-145-1 PG workspace sidebar 가 connection 의 모든 schema 를 동시
  expand 하여 표시 (public, custom schemas 모두). Topbar schema
  selector 제거.
- AC-145-2 MySQL/SQLite/MongoDB workspace sidebar 는 schema 노드 없이
  `Tables` (또는 `Collections`) flat list 로 표시. 즉 `schema folder >
  table` 2단 hierarchy 가 아니라 1단.
- AC-145-3 sidebar 에서 `Functions` 노드 클릭 시 children 로드가
  컨테이너 width 를 변형하지 않는다 (클릭 전후 sidebar
  `getBoundingClientRect().width` 차이 ≤ 1px). 함수 100+ 가 있더라도
  수직 스크롤로 처리.

### Sprint 146 — Disabled tooltip 카피 정리 (#7-tooltips)
- AC-146-1 코드 전체에서 사용자에게 노출되는 문자열 중 `/sprint\s*\d+/i`
  패턴 매칭 0건 (테스트로 단언).
- AC-146-2 disabled 상태 버튼/메뉴 아이템 모두 `[role="tooltip"]` 또는
  `title` 로 disable 사유 안내문을 가지며, 안내문은 사용자 액션 가능
  조건을 한 문장 평어체로 설명. (예: "Switching database is coming
  soon" 대신 "Database switching is not available for this connection
  type yet" 같은 사용자 관점 카피.)
- AC-146-3 disabled 안내문은 hover 시에만 표시되며 leave 후 즉시
  사라진다 (현재 "계속 보이는 군" 버그 fix). Radix Tooltip 의 기본
  delay/close 타이밍에 맞춤.

### Sprint 147 — Tab UX (#8 #9)
- AC-147-1 PG sidebar 에서 테이블 row 단일 클릭 → italic preview tab
  이 새로 열린다 (`[data-preview="true"]`). Mongo 와 동일 UX.
- AC-147-2 두 번째 테이블 단일 클릭 → 기존 preview tab 이 새 tab 으로
  **교체**(추가 아님), 총 탭 수는 그대로.
- AC-147-3 preview tab 더블클릭(또는 헤더 더블클릭) → 영구 탭으로
  pin 됨 (`[data-preview]` 제거).
- AC-147-4 두 query tab A, B 가 있을 때 A 에 입력하고 B 로 포커스 →
  dirty 표식이 **A 에만** (`[data-dirty="true"]`) 붙는다. B 엔
  data-dirty 없음. (현재 "보고 있는 탭에 표식이 생긴다" 버그 fix.)

### Sprint 148 — Row count UX + Mongo switch DB persistence (#10 #12)
- AC-148-1 PG/MySQL sidebar table row count 셀이 즉시 `~12,345` (tilde
  prefix + locale separator) 로 표시. 추정치 출처는 PG `n_live_tup`,
  MySQL `information_schema.TABLES.TABLE_ROWS`.
- AC-148-2 SQLite table row count 셀은 즉시 `?` 로 표시 (추정 메타
  부재).
- AC-148-3 사용자가 row count 셀 hover (또는 키보드 focus) 200ms 이상
  유지 → 백엔드 `count_rows_exact(connection_id, schema, table)` 호출
  → 정확값 fetch 시 셀이 `12,345` (tilde 제거, locale separator
  유지)로 교체. 결과는 connection-scoped 메모리 캐시 (탭 전환에도
  유지, 다음 hover 즉시 캐시 hit).
- AC-148-4 Mongo workspace 에서 DB switcher 로 다른 DB(예: `admin`)
  선택 → 닫기 → 다시 열기 → trigger label 이 여전히 `admin`. 페이지
  새로고침(또는 connection 재오픈)에도 마지막 선택 DB 가 유지된다.

### Sprint 149 — Selective encrypted export (#5)
- AC-149-1 ImportExportDialog SelectionTree 에서 단일 connection
  선택 → encrypted JSON 생성 시 envelope 복호화 후 connections 배열
  길이가 정확히 1.
- AC-149-2 group 헤더 체크 → 그 group 의 모든 connection 만 export
  (다른 group + ungrouped 은 제외). 카운터가 `N connections, 1 group
  selected` 로 표시.
- AC-149-3 group 의 일부 connection 만 체크 → 그것만 export, group
  헤더는 indeterminate, 카운터는 `N connections, 0 group selected`.
- AC-149-4 envelope 의 ciphertext 안에 모든 선택 connection 의
  password 가 포함되며(round-trip import 후 has_password=true), 평문
  으로 노출되지 않는다.
- AC-149-5 ImportExportDialog 에 평문 export 버튼/옵션은 코드에
  존재하지 않는다 (legacy `Generate JSON` 텍스트 매칭 0건).

## Components to Create / Modify

### 새로 생성
- `src-tauri/src/window/launcher.rs` (Sprint 141) — launcher window
  생성 + IPC handler.
- `src/screens/Launcher.tsx` (Sprint 141) — Home 컨텐츠를 launcher
  윈도우로 이동.
- `src/lib/completion/{pg,mysql,sqlite,mongo,shared}.ts` (Sprint 144).
- `src/lib/rowCount/cache.ts` (Sprint 148) — connection-scoped 메모리
  캐시.

### 주요 수정
- `src-tauri/tauri.conf.json` — windows 배열에 launcher 추가.
- `src-tauri/src/lib.rs` — workspace window builder + window event
  handler.
- `src/components/connection/ConnectionDialog.tsx` (Sprint 143) —
  DBMS-별 form 분기.
- `src/components/workspace/Workspace.tsx` — connection switcher 제거
  (Sprint 142), Disconnect 버튼 추가 (Sprint 142), preview tab 단일
  클릭 진입점 (Sprint 147).
- `src/components/sidebar/Sidebar.tsx` — schema 단일 view + DBMS-aware
  flat 모드 (Sprint 145), Functions 필터 (Sprint 145).
- `src/components/query/QueryEditor.tsx` — completion 모듈 스위처
  (Sprint 144).
- `src/components/schema/SchemaTree.tsx` — tilde 표시 + hover 핸들러
  (Sprint 148), dirty marker 위치 (Sprint 147).
- `src/components/connection/ImportExportDialog.tsx` — 평문 path 제거,
  selection 단일/group 검증 (Sprint 149).
- `src-tauri/src/commands/schema.rs` — `count_rows_exact` 추가
  (Sprint 148).

## Data Flow

```
[App start]
   └─> launcher window only (visible)
[user double-clicks connection in launcher]
   └─> invoke('connect', id) ─> backend opens pool
   └─> emit('workspace:open', { connection_id }) on success
   └─> launcher.hide(); workspace.show().focus()
[Workspace renders sidebar via cached schema fetch]
[user clicks Back / Disconnect]
   └─> emit('launcher:show'); workspace.hide()
   └─> (Disconnect 만) invoke('disconnect', id) ─> backend evicts pool
[Row count hover 200ms]
   └─> invoke('count_rows_exact', { id, schema, table })
   └─> SchemaTree 셀 update + connection-scoped cache write
```

## Edge Cases

- launcher 와 workspace 가 동시에 열린 상태에서 launcher 의 connection
  리스트에서 현재 workspace 가 사용 중인 connection 을 삭제 시도 →
  백엔드는 `connection-in-use` 에러 반환, launcher 가 해당 메시지를
  inline alert 로 표시. workspace 는 영향 없음.
- workspace 가 visible 한 상태에서 사용자가 OS-레벨 close 버튼 클릭 →
  Back 과 동일 흐름 (launcher 복귀, pool 유지). (Disconnect 가 아닌
  점에 주의.)
- 추정치가 `null` 인 경우 (방금 생성된 빈 테이블, ANALYZE 미실행) →
  `~0` 이 아니라 `?` 로 표시 (사용자에게 "값을 모름"을 명시).
- Completion 모듈이 일치하지 않는 paradigm 으로 mount 되는 잘못된 호출
  → unit test 가 throw 또는 noop 동작을 단언, 런타임에 silent fallback
  하지 않음.
- Selective export 가 0 connection 선택 상태에서 generate 클릭 → 버튼
  disabled (이미 S140 구현).

## Verification Strategy

- 각 sprint 의 AC 마다 실패 테스트(red) 를 먼저 작성한 후 Generator 가
  green 으로 만든다 (lesson: spec 합의 → 실패 테스트 → 구현).
- 테스트 레이어는 항목 성격에 맞게 선택:
  - 단위 (vitest): completion 후보 매칭, row count 캐시, ConnectionDialog
    DBMS 전환 form 상태.
  - 통합 (vitest + jsdom): SelectionTree + 백엔드 mock, dirty marker
    flow.
  - e2e (wdio): launcher↔workspace 윈도우 lifecycle, sidebar Functions
    layout, Mongo DB persistence.
- 매 sprint PR 은 `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`,
  관련 cargo 테스트 통과 + 새로 추가된 e2e 가 (CI 환경에서) green 일
  때 머지.

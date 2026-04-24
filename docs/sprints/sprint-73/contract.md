# Sprint Contract: sprint-73 (Phase 6 plan E-2 — Frontend Find/Aggregate UI)

## Summary

- Goal: Mongo paradigm 쿼리 탭에 Find/Aggregate 모드 토글을 추가하고, CodeMirror 언어 extension 을 JSON 으로 스왑하며, `QueryTab` 이 paradigm + queryMode 에 따라 `findDocuments` / `aggregateDocuments` 를 분기 호출하도록 구현한다. Sprint 72 가 제공한 `aggregate_documents` 커맨드를 실제로 소비해 Phase 6 의 Sprint E 를 완성한다.
- Audience: Sprint 80 (Phase 6 F — 인라인 편집 + MQL Preview) 이 이 UI 경로를 확장한다.
- Owner: Sprint 73 harness generator.
- Verification Profile: `command` (pnpm vitest + tsc + lint + cargo clippy 회귀).

Phase 6 master plan 의 Sprint E (Find/Aggregate) 를 E-1 (Sprint 72, 백엔드) / E-2 (Sprint 73, 프런트) 로 쪼갠 두 번째 절반. Sprint 74~79 는 병렬 agent 의 UX Hardening 이 선점했으므로, Phase 6 Sprint F 는 Sprint 80 으로 밀림.

## In Scope

### tabStore (`src/stores/tabStore.ts`)

- `QueryTab` 인터페이스에 신규 필드 2개 추가:
  - `paradigm: Paradigm` — 탭이 속한 연결의 paradigm. 기본 `"rdb"`.
  - `queryMode: "sql" | "find" | "aggregate"` — 실행 모드. `paradigm === "rdb"` 면 항상 `"sql"`, `paradigm === "document"` 면 `"find"` 또는 `"aggregate"`.
- `addQueryTab` 시그니처 확장: 현재 `(connectionId, title)` 형태를 `(connectionId, title, opts?: { paradigm?: Paradigm; queryMode?: "sql" | "find" | "aggregate" })` 로 확장. 기존 호출자는 인자 변경 없이 `"rdb"` + `"sql"` 로 동작.
- `setQueryMode(tabId, mode)` 액션 추가 — 사용자가 Find ↔ Aggregate 토글 시 호출.

### Type layer (`src/types/document.ts`)

- 신규 타입 `AggregateBody { pipeline: Record<string, unknown>[] }` 추가.
- 기존 `DocumentQueryResult`, `FindBody` 불변.

### Tauri wrapper (`src/lib/tauri.ts`)

- 신규 wrapper `aggregateDocuments(connectionId: string, database: string, collection: string, pipeline: Record<string, unknown>[]): Promise<DocumentQueryResult>` 추가. 내부적으로 `invoke("aggregate_documents", { connectionId, database, collection, pipeline })` 호출.
- 기존 `findDocuments` 불변.

### documentStore (`src/stores/documentStore.ts`)

- `runAggregate(connectionId, database, collection, pipeline)` 메서드 추가. `runFind` 와 동일한 stale-guard + `queryResults[key]` 캐시 패턴.
- 캐시 key 는 `mongo:agg:${connectionId}:${database}:${collection}:${JSON.stringify(pipeline)}` 또는 간결한 형태. Sprint 72 의 `find` 경로와 key prefix 로 분리.

### QueryEditor (`src/components/query/QueryEditor.tsx`)

- `paradigm: Paradigm` + `queryMode: "sql" | "find" | "aggregate"` prop 추가.
- `paradigm === "document"` 면 CodeMirror extension 을 `@codemirror/lang-json` 의 `json()` 으로 스왑. SQL 모드는 기존 `@codemirror/lang-sql` 유지.
- `Mod-Enter` 단축키는 paradigm 무관하게 `onExecute()` 호출. 유지.
- `Compartment` 패턴으로 mode 전환 시 에디터 재생성 없이 extension reconfigure.
- `schemaNamespace` prop 은 paradigm === "rdb" 에서만 의미. document 모드에서는 무시.

### QueryTab (`src/components/query/QueryTab.tsx`)

- `tab.paradigm`, `tab.queryMode` 를 store 에서 읽어 execute 분기:
  - `paradigm === "rdb"` → 기존 `executeQuery(tab.connectionId, sql, queryId)` 경로 유지 (SQL 다중 statement split 포함).
  - `paradigm === "document" && queryMode === "find"` → body 를 `JSON.parse(tab.sql)` 로 파싱 → `FindBody` 로 변환 → `findDocuments` 호출 → 결과 그리드 렌더.
  - `paradigm === "document" && queryMode === "aggregate"` → body 를 `JSON.parse(tab.sql)` → `Record<string, unknown>[]` (pipeline) 로 검증 → `aggregateDocuments` 호출.
- `paradigm === "document"` 일 때 에디터 상단에 `Find | Aggregate` 세그먼트 토글 (shadcn `<Tabs>` 또는 `<ToggleGroup>`) 렌더. 클릭 시 `setQueryMode(tabId, mode)`.
- 에디터 아래 결과 표시부는 paradigm 에 따라:
  - RDB: 기존 DataGrid (무수정)
  - Document: `<QueryResultGrid>` or `<DataGridTable>` 재사용 + `DocumentQueryResult` → 기존 그리드 props 변환 어댑터. Quick Look 마운트는 out of scope (Sprint 71 에서 `DocumentDataGrid` 에 이미 있음 — 쿼리 탭은 별도 경로라 재배선 필요 없음).
- JSON 파싱 실패 시 사용자에게 에러 토스트/패널 표시: `AppError::Validation("Invalid JSON pipeline: <msg>")` 형식의 메시지.
- Cmd+Return 단축키 유지.
- `document` mode 에서 SQL-specific UI (SQL format, uglify, 탭 "Run all" 등) 는 숨김 또는 비활성.

### Tests

- `src/stores/tabStore.test.ts` (존재 시) 또는 신규: `addQueryTab` 의 paradigm/queryMode 기본값, `setQueryMode` 동작, 기존 SQL 경로 회귀.
- `src/lib/tauri.test.ts` (있으면) 또는 기존 유사 테스트 확장: `aggregateDocuments` invoke 인자 형태.
- `src/stores/documentStore.test.ts` (존재 시) 또는 신규: `runAggregate` stale guard, 캐시 동작.
- `src/components/query/QueryEditor.test.tsx` 확장: paradigm="document" 시 JSON syntax highlighting 적용(CodeMirror language extension 확인 — `cm.state.facet(language) === jsonLanguage` 또는 마운트된 DOM 에 `.cm-language-json` 같은 클래스 확인).
- `src/components/query/QueryTab.test.tsx` 확장: paradigm 분기 (rdb→executeQuery, document find→findDocuments, document aggregate→aggregateDocuments), Find/Aggregate 토글 동작, JSON 파싱 에러 표시.

### Dependencies

- `@codemirror/lang-json` 패키지 설치 (package.json + pnpm-lock.yaml).

## Out of Scope

- Sidebar "New Query" 컨텍스트 메뉴 신규 추가. mongo 쿼리 탭 여는 entry point 는 기존 `addQueryTab` 호출자들 (keyboard shortcut / command palette / sidebar double-click) 이 paradigm 을 주입하는 정도로 최소 대응. UI 진입점 다각화는 UX Hardening scope.
- MQL Preview 모달 (insert/update/delete diff 직렬화) — Sprint 80.
- 인라인 편집, insert/update/delete — Sprint 80.
- `$out`, `$merge`, `$indexStats` 같은 side-effect aggregate stage 경고 UI — Sprint 80 이후.
- Aggregate 결과의 explain/execution stats 표시.
- 쿼리 history 에 paradigm/mode 별 필터링 — 후속 스프린트.
- Rust 백엔드 신규/수정 전부 (Sprint 72 가 확정).

## Invariants

- `paradigm === "rdb"` 인 모든 기존 동작 완전 불변: executeQuery, SQL multi-statement split, SQL format/uglify, Cmd+Return, history 기록, DataGrid 렌더.
- 기존 QueryTab 의 기존 호출자들 (`addQueryTab` 을 paradigm 없이 호출하는 곳) 이 default `"rdb"` + `"sql"` 로 여전히 정확히 동작.
- `DocumentDataGrid` 의 기존 `runFind` 경로 불변. 쿼리 탭의 find 는 별도 경로이므로 `DocumentDataGrid` 는 이 스프린트에서 diff 0.
- `findDocuments` tauri wrapper 시그니처 불변.
- `DocumentQueryResult`, `FindBody` 타입 shape 불변.
- `src-tauri/**` diff 0.
- Sprint 74 agent 가 작업 중인 `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/shared/QuickLookPanel*`, `src/components/shared/BsonTreeViewer*` 경로 diff 0 (경로 충돌 방지).
- React convention: function 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix 유지.

## Acceptance Criteria

- `AC-01` `QueryTab` 인터페이스가 `paradigm: Paradigm` + `queryMode: "sql" | "find" | "aggregate"` 를 가진다. 기본값은 `paradigm="rdb"`, `queryMode="sql"`. `src/stores/tabStore.ts` 의 해당 타입 정의에서 확인 가능.
- `AC-02` `addQueryTab(connectionId, title)` (옵션 없이) 호출이 후방 호환으로 SQL 탭을 만든다. 추가로 `addQueryTab(connectionId, title, { paradigm: "document", queryMode: "find" })` 같은 옵션 호출이 지원된다. `setQueryMode(tabId, mode)` 액션이 존재해서 mode 전환이 가능하다.
- `AC-03` `src/lib/tauri.ts::aggregateDocuments(connectionId, database, collection, pipeline)` wrapper 가 존재하고 `invoke("aggregate_documents", {...})` 를 호출한다. `Promise<DocumentQueryResult>` 를 반환한다.
- `AC-04` `src/stores/documentStore.ts::runAggregate` 메서드가 `runFind` 와 동일한 stale-guard 패턴 (예: request id 비교로 stale 응답 덮어쓰기 방지) 으로 동작한다.
- `AC-05` `QueryEditor` 가 `paradigm === "document"` 시 `@codemirror/lang-json` 을 사용하고, `paradigm === "rdb"` 시 기존 SQL extension 을 유지한다. `Compartment` reconfigure 로 에디터 재마운트 없이 전환된다.
- `AC-06` `QueryTab` 이 `paradigm === "document"` 일 때 상단에 `Find | Aggregate` 세그먼트 토글을 렌더한다 (rdb 일 때는 렌더하지 않음). 토글 클릭이 `setQueryMode` 를 호출하고 UI state 가 반영된다.
- `AC-07` `QueryTab::handleExecute` 가 paradigm + queryMode 에 따라 분기한다:
  - rdb → `executeQuery` 경로 (기존).
  - document + find → `JSON.parse(sql)` 로 filter 추출 → `findDocuments(connectionId, database, collection, {filter, ...})`.
  - document + aggregate → `JSON.parse(sql)` 로 pipeline 배열 추출 → `aggregateDocuments(connectionId, database, collection, pipeline)`.
- `AC-08` JSON 파싱 실패 시 사용자에게 명확한 에러 표시 (`Invalid JSON:` 포함 문구). 에러 상태가 이후 `handleExecute` 성공 시 사라짐 (idempotent).
- `AC-09` `Cmd+Return` / `Mod-Enter` 단축키가 paradigm 무관하게 `handleExecute` 를 호출한다. rdb 와 document 양쪽에서 동작.
- `AC-10` `src-tauri/**` 디렉토리의 git diff 가 비어있다 (`git diff --stat HEAD -- src-tauri/` empty).
- `AC-11` 다음 파일은 diff 0: `src/components/DataGrid.tsx`, `src/components/datagrid/**`, `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx`, `src/components/shared/QuickLookPanel.tsx`, `src/components/shared/QuickLookPanel.test.tsx`, `src/components/shared/BsonTreeViewer.tsx`, `src/components/shared/BsonTreeViewer.test.tsx`. Sprint 74 agent 의 병렬 작업과 경로 충돌을 방지한다.
- `AC-12` 테스트 추가: QueryEditor paradigm-aware extension (1+), QueryTab 분기 (rdb / find / aggregate 각 1+, 총 3+), documentStore runAggregate (1+), tabStore addQueryTab 옵션 / setQueryMode (1+). 최소 6 테스트 추가.
- `AC-13` Verification Plan 4 checks + Frontend 회귀 (vitest 전체 suite 통과) 전부 pass.

## Design Bar / Quality Bar

- Find/Aggregate 토글은 shadcn `<ToggleGroup>` 또는 `<Tabs>` 컴포넌트 사용. 커스텀 버튼 HTML 금지. 기존 프로젝트의 shadcn 관례 따라 `variant="outline"` 등 consistent 하게.
- JSON 파싱 에러 표시는 기존 query 에러 패널과 동일한 UI 컴포넌트 재사용 (에러 텍스트 토스트 새로 만들지 말 것). 기존 `tab.queryState.error` 슬롯이 있으면 그걸 재사용.
- `addQueryTab` 의 신규 옵션 객체 파라미터는 default 를 명확히: `opts: { paradigm?: Paradigm; queryMode?: "sql" | "find" | "aggregate" } = {}`. inline destructure 시 default `{ paradigm = "rdb", queryMode = paradigm === "rdb" ? "sql" : "find" }`.
- 기존 `QueryState` 타입에 에러 메시지가 이미 있으면 재사용. 없으면 에러는 Sprint 범위 밖이므로 최소한 `console.error` 는 금지하고 ui 에 노출.
- `runAggregate` 캐시 key prefix 로 `find` 와 구별 (예: `"agg:"`). Sprint 72 백엔드가 find / aggregate 모두 `DocumentQueryResult` 반환하므로 frontend cache 는 prefix 로만 분리.
- React convention: `interface QueryTabProps {...}`, `type` alias 는 utility 용으로만. `any` 0, `unknown` 허용.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 0 type error.
2. `pnpm lint` — 0 ESLint error.
3. `pnpm vitest run src/stores/tabStore.test.ts src/stores/documentStore.test.ts src/components/query/QueryEditor.test.tsx src/components/query/QueryTab.test.tsx` (존재하는 파일만, vitest 는 없는 파일을 자동 skip). 새로 만든 테스트 포함 전부 통과.
4. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — Rust 회귀 0.

**Orchestrator 가 별도로 실행하는 체크**:
- `pnpm vitest run` (전체 suite) — Sprint 72 기준 1288 tests → +6 이상 순증 (Sprint 73 신규 테스트), 0 실패.
- `cd src-tauri && cargo test --lib` — Sprint 72 기준 216 passed 유지 (Rust diff 0 증명).

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 역할.
  - 4개 generator-scope check 실행 커맨드 + 결과 수치.
  - 각 AC (AC-01 ~ AC-13) → 증거 (file:line 또는 테스트 이름).
  - `QueryTab::handleExecute` 분기 코드 스니펫 또는 file:line-range.
  - `QueryEditor` Compartment reconfigure 위치 (file:line).
  - `addQueryTab` signature 변경 전후 비교.
  - `aggregateDocuments` wrapper 정의 위치.
  - `documentStore::runAggregate` 정의 위치 + stale-guard 패턴 확인.
  - Rust 회귀 증명: `git diff --stat HEAD -- src-tauri/` empty.
  - Sprint 74 agent 경로 침범 없음 증명: `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` empty.
- Evaluator must cite:
  - `QueryTab.tsx` 분기 실제 코드 확인.
  - `QueryEditor.tsx` JSON extension 사용 확인.
  - Find/Aggregate 토글 DOM/테스트 확인.
  - `aggregateDocuments` wrapper invoke 인자 shape.
  - Rust diff 0 증명 (git stat).
  - Sprint 74 경로 diff 0 증명 (git stat).
  - 기존 SQL 경로 회귀 0 (vitest 전체 통과).

## Test Requirements

### Unit Tests (필수)

- `QueryEditor` — paradigm="document" 시 json language 활성화 확인 (CodeMirror DOM 에 `.cm-line > .cm-lang-json` 같은 클래스 또는 test-id 사용; 또는 ref 로 state 내부 language facet 확인).
- `QueryTab` — rdb paradigm 에서 handleExecute 가 `executeQuery` mock 을 호출한다.
- `QueryTab` — document + find 에서 `findDocuments` mock 이 `JSON.parse` 된 filter 와 함께 호출된다.
- `QueryTab` — document + aggregate 에서 `aggregateDocuments` mock 이 pipeline 배열로 호출된다.
- `QueryTab` — JSON 파싱 실패 시 "Invalid JSON" 에러 메시지가 DOM 에 표시된다.
- `QueryTab` — Find/Aggregate 토글 클릭이 `setQueryMode` 를 호출한다.
- `tabStore` — `addQueryTab(connId, title)` 가 paradigm="rdb", queryMode="sql" 로 생성.
- `tabStore` — `addQueryTab(connId, title, { paradigm: "document", queryMode: "aggregate" })` 가 그대로 반영.
- `tabStore` — `setQueryMode(tabId, "aggregate")` 가 state 를 업데이트.
- `documentStore` — `runAggregate` 가 `aggregateDocuments` mock 을 호출하고 결과를 cache 에 저장.
- `documentStore` — `runAggregate` stale-guard: 먼저 시작한 느린 응답이 나중에 시작한 빠른 응답을 덮어쓰지 않음.

최소 6 테스트 (위 리스트에서 중복 합산 금지).

### Scenario Tests (필수)

- [x] Happy path — document + find 성공, document + aggregate 성공.
- [x] 에러/예외 — JSON 파싱 실패, find/aggregate 서버 오류.
- [x] 경계 — 빈 pipeline (`[]`), 빈 filter (`{}`).
- [x] 기존 기능 회귀 없음 — SQL 탭 동작 유지.

### Coverage Target

- 신규/수정 코드: 라인 70% 이상.

## Test Script / Repro Script

1. `pnpm install` — `@codemirror/lang-json` 설치 확인.
2. `pnpm tsc --noEmit && pnpm lint`
3. `pnpm vitest run src/stores/tabStore.test.ts src/stores/documentStore.test.ts src/components/query/QueryEditor.test.tsx src/components/query/QueryTab.test.tsx`
4. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
5. `git diff --stat HEAD -- src-tauri/ src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` → 전부 빈 출력.

## Ownership

- Generator: Sprint 73 harness generator.
- Write scope:
  - 수정: `src/stores/tabStore.ts`, `src/stores/documentStore.ts`, `src/lib/tauri.ts`, `src/types/document.ts`, `src/components/query/QueryEditor.tsx`, `src/components/query/QueryTab.tsx`, `src/components/query/QueryEditor.test.tsx`, `src/components/query/QueryTab.test.tsx`, `package.json`, `pnpm-lock.yaml`.
  - 신규 (필요 시): `src/stores/tabStore.test.ts`, `src/stores/documentStore.test.ts` (이미 있으면 수정).
  - 그 외 파일 diff 금지. 특히 `src-tauri/**`, `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx`, `src/components/shared/QuickLookPanel*`, `src/components/shared/BsonTreeViewer*` **전부 read-only**.
- Merge order: Sprint 80 가 이 UI 위에 MQL Preview 를 추가하므로 PASS 후 Sprint 80 착수.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (4개 generator-scope + orchestrator 2개)
- Acceptance criteria evidence linked in `handoff.md`

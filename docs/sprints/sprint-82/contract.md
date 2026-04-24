# Sprint Contract: sprint-82 (Provider-aware SQL dialect)

## Summary

- Goal: SQL 쿼리 탭이 활성 커넥션의 `db_type` 에 맞춰 CodeMirror SQL dialect 를 in-place reconfigure. Postgres / MySQL / SQLite 각각 고유 키워드 하이라이팅 + identifier quoting + autocomplete 후보를 노출. 미해결 / 미연결 케이스는 StandardSQL fallback.
- Audience: Table View 사용자가 Postgres → MySQL → SQLite 커넥션을 오가며 동일 쿼리 탭 워크플로우를 쓰는 시나리오.
- Owner: Generator agent (general-purpose).
- Verification Profile: `mixed`

## In Scope

- `src/components/query/QueryEditor.tsx` — `buildSqlLang` 시그니처에 dialect 인자 추가. paradigm=`rdb` 일 때 `(dialect, namespace)` 를 받아 `sql({ dialect, schema })` 호출. 기존 Compartment reconfigure 경로 유지.
- `src/components/query/QueryTab.tsx` — `useConnectionStore` 에서 활성 커넥션의 `db_type` 조회 → dialect prop 으로 QueryEditor 에 전달. 문서 paradigm 경로는 건드리지 않음.
- `src/hooks/useSqlAutocomplete.ts` — dialect 힌트 받도록 확장하고 dialect-별 identifier casing / quoting 규칙 반영 (Postgres → lowercase 선호, MySQL → backtick-quoted identifier 옵션, SQLite → double-quote 옵션). 기존 `tableColumns` override 시그니처 후방호환.
- `src/components/query/QueryEditor.test.tsx` + `useSqlAutocomplete.test.ts` — dialect swap 테스트 (pg/mysql/sqlite/fallback), EditorView 동일 인스턴스 유지 검증, dialect 별 identifier casing 검증.

## Out of Scope

- MongoDB (document paradigm) autocomplete / 하이라이팅 — Sprint 83 scope.
- Query history entry 에 paradigm/queryMode 저장 — Sprint 84 scope.
- History row / global log 하이라이팅 — Sprint 85 scope.
- 백엔드 (`src-tauri/**`) diff 0.
- DataGrid / DocumentDataGrid / shared BsonTreeViewer / QuickLookPanel — 병렬 Sprint 74~76 agent 작업 영역, 건드리지 않음.

## Invariants

- `src-tauri/**` diff 0.
- Document paradigm 쿼리 탭 동작 완전 불변 (JSON extension 로드 경로, Find/Aggregate 토글, JSON 파싱 분기).
- `QueryEditor` Compartment reconfigure 시 `EditorView` 인스턴스 referential equality 유지 (teardown 금지).
- 기존 `useSqlAutocomplete(connectionId, tableColumns?)` 호출자 (Sprint 73 이전 callers) 무변경 — dialect 인자는 선택적, 미지정 시 StandardSQL 동작.
- `QueryResult`, `DocumentQueryResult` shape 불변.
- 기존 pnpm vitest suite regression 0.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix 유지.

## Acceptance Criteria

- `AC-01` — Postgres 커넥션 탭: 에디터가 `RETURNING`, `ILIKE` 등 Postgres 전용 키워드를 keyword 토큰 클래스로 렌더. autocomplete 후보 세트에 이 키워드들 노출. 테스트가 fixture SQL 을 렌더하고 keyword 클래스 존재 검증.
- `AC-02` — MySQL 커넥션 탭: backtick (`` ` ``) identifier quoting 동작. `REPLACE INTO`, `DUAL` 등 MySQL 전용 키워드가 keyword 클래스로 인식.
- `AC-03` — SQLite 커넥션 탭: `AUTOINCREMENT`, `PRAGMA`, `IIF` 가 keyword 토큰으로 렌더.
- `AC-04` — Schema-driven autocomplete: dialect 기본값 기반 identifier casing 적용. Postgres mixed-case `"Users"` 테이블 → lowercase completion (`users`) 또는 원본 casing 유지 중 명시적 선택. MySQL 은 backtick-quoted identifier 후보 제공. 테스트가 각 dialect 에서 동일 seed data 로 candidate label / apply 필드 검증.
- `AC-05` — Compartment reconfigure: 커넥션 dialect 변경 시 `viewRef.current` 가 이전 인스턴스와 동일. 테스트가 EditorView 참조를 snapshot 해서 reconfigure 전후 referential equality 검증.
- `AC-06` — 문서 paradigm 탭은 SQL dialect 경로에 영향받지 않음. JSON extension 로드 경로 byte-for-byte 불변.
- `AC-07` — Fallback: `db_type` resolve 불가 (탭이 삭제된 커넥션 참조, 미연결) 시 StandardSQL 로드. 기존 `QueryEditor.test.tsx` 테스트 전부 통과.
- `AC-08` — `pnpm tsc --noEmit`, `pnpm lint` 에러 0 / 경고 0.
- `AC-09` — `git diff --stat HEAD -- src-tauri/` empty. Sprint 74 병렬 경로 (`src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/shared/BsonTreeViewer*`, `src/components/shared/QuickLookPanel*`) diff 0.
- `AC-10` — 최소 6 개 신규 테스트 추가 (각 AC 에 최소 1 개 매핑, 에러/fallback 케이스 포함). 모두 pass.

## Design Bar / Quality Bar

- Dialect resolution 은 `QueryTab` → `connectionStore` 에서 1 회 lookup. `QueryEditor` 는 dialect 객체 자체 또는 문자열 enum 을 prop 으로 받는다 (두 형태 모두 허용; Generator 가 단순한 쪽 선택).
- `@codemirror/lang-sql` 의 `StandardSQL`, `PostgreSQL`, `MySQL`, `SQLite` dialect 객체 사용 (v6.x 기준). MariaSQL / MSSQL 은 스코프 밖.
- dialect 매핑은 `paradigmOf` 와 유사한 pure function: `DatabaseType → SQLDialect`. 재사용 가능한 유틸로 `src/lib/` 또는 `src/hooks/` 에 노출.
- Schema-qualified identifier 처리에서 기존 cache key (`connectionId:schema:table`) 로직 불변. casing / quoting 로직만 dialect 결정 후 candidate label / apply 단계에서 분기.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 에러 0.
2. `pnpm lint` — 경고/에러 0.
3. `pnpm vitest run src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.test.ts src/components/query/QueryTab.test.tsx` — dialect swap 테스트 + 기존 케이스 전부 pass.
4. `git diff --stat HEAD -- src-tauri/` 빈 출력 (backend 무변경).
5. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx` 빈 출력.
6. `pnpm vitest run` 전체 suite — Sprint 76 baseline 회귀 없음.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 각 파일 목적.
  - `QueryEditor.tsx` 의 dialect-aware `buildSqlLang` 시그니처 file:line.
  - `QueryTab.tsx` 의 dialect 조회 로직 file:line (connectionStore lookup).
  - `useSqlAutocomplete.ts` 의 dialect-aware casing 로직 file:line.
  - 각 AC-01 ~ AC-10 → 테스트 이름 또는 file:line 매핑.
  - `src-tauri/` 및 Sprint 74 경로 diff empty 증명 스크린샷/커맨드 출력.
- Evaluator must cite:
  - 각 AC 에 대한 pass/fail 판단의 concrete evidence (테스트 출력 라인, DOM 클래스 이름, 파일 offset).
  - 빠진/약한 증거는 finding 으로 기록.

## Test Requirements

### Unit Tests (필수)
- AC-01 ~ AC-07 각각 최소 1 개 테스트.
- 에러/fallback 케이스 최소 1 개 (AC-07).

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)
- [ ] Happy path — Postgres 커넥션 쿼리 탭에서 dialect-specific 키워드가 keyword 클래스로 렌더.
- [ ] 에러/예외 상황 — 탭 연결된 커넥션이 삭제되었을 때 StandardSQL fallback.
- [ ] 경계 조건 — 동일 탭에서 Postgres → MySQL dialect swap 시 EditorView 참조 유지.
- [ ] 기존 기능 회귀 없음 — 기존 `QueryEditor.test.tsx` / `QueryTab.test.tsx` / `useSqlAutocomplete.test.ts` 테스트 전부 pass.

## Test Script / Repro Script

1. `pnpm install` (lock 변경 시) → `pnpm tsc --noEmit && pnpm lint`.
2. `pnpm vitest run` — 전체 suite pass.
3. 수동 스모크: `pnpm tauri dev` → Postgres 커넥션 연결 → 쿼리 탭에서 `RETURNING` 타이핑 → 키워드 하이라이팅 확인. MySQL 커넥션으로 전환 → backtick identifier 노출 확인. 탭 교체 없이 dialect 가 바뀌는지 확인.

## Ownership

- Generator: general-purpose agent (single pass).
- Write scope:
  - `src/components/query/QueryEditor.tsx`
  - `src/components/query/QueryTab.tsx`
  - `src/hooks/useSqlAutocomplete.ts`
  - 신규 유틸 (예: `src/lib/sqlDialect.ts` 또는 동등 위치) — dialect 매핑 함수
  - 위 파일들의 `.test.tsx` / `.test.ts`
- Merge order: Sprint 81 spec 이후, Sprint 83 이전.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`

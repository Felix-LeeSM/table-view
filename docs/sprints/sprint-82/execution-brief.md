# Sprint Execution Brief: sprint-82 (Provider-aware SQL dialect)

## Objective

- SQL 쿼리 탭이 활성 커넥션의 `db_type` 을 조회해 CodeMirror `sql({ dialect })` 를 dialect-specific 으로 구성.
- `QueryEditor` 의 Compartment 를 유지하면서 dialect 객체를 reconfigure payload 로 전달.
- `useSqlAutocomplete` 가 dialect 별 identifier casing / quoting 규칙을 반영해 schema-driven 후보를 생성.
- Fallback: dialect 해석 불가 → `StandardSQL`.

## Task Why

- Phase 6 는 MongoDB 를 최초로 포함한 멀티-paradigm 빌드를 목표로 진행 중이었고, MongoDB 쿼리 경로는 Sprint 72/73 에서 완료. 그러나 RDB 쪽은 모든 dialect 를 StandardSQL 로 처리하고 있어 Postgres/MySQL/SQLite 사용자가 자기 DB 의 키워드 하이라이팅 / autocomplete 를 받지 못함.
- 이 스프린트는 provider-aware 쿼리 경험의 첫 절반 (RDB) 을 매듭짓는다. 두 번째 절반 (MongoDB MQL autocomplete) 은 Sprint 83 이 담당.
- 병렬 Sprint 74~76 agent 가 datagrid/DataGrid/BsonTreeViewer/QuickLookPanel 경로에서 작업 중 — Sprint 82 는 query/** + hooks/** + lib/** 경로에만 집중하면 충돌 없음.

## Scope Boundary

**수정 허용**:
- `src/components/query/QueryEditor.tsx` — dialect prop + `buildSqlLang(dialect, ns)` 호출.
- `src/components/query/QueryTab.tsx` — `useConnectionStore` 에서 `db_type` 조회 → dialect prop 전달.
- `src/hooks/useSqlAutocomplete.ts` — dialect 인자 추가, identifier casing / quoting 분기.
- 신규 유틸: `src/lib/sqlDialect.ts` (또는 동등 위치) — `DatabaseType → SQLDialect` 매핑.
- 테스트 파일 (`*.test.tsx` / `*.test.ts`) — dialect swap / fallback / identifier casing 케이스 확장.

**절대 수정 금지 (diff 0)**:
- `src-tauri/**` 전체.
- `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx` — Sprint 74 agent 작업 경로.
- `src/components/shared/QuickLookPanel*`, `src/components/shared/BsonTreeViewer*` — Sprint 70/71 확정 영역.
- `src/stores/queryHistoryStore.ts`, `GlobalQueryLogPanel.tsx` — Sprint 84/85 scope 이므로 건드리지 않음.

## Invariants

- `src-tauri/**` diff 0.
- Document paradigm 탭 (`paradigm === "document"`) 의 JSON extension 경로 byte-for-byte 불변.
- `QueryEditor.tsx` Compartment reconfigure 시 `viewRef.current` referential equality 유지 (teardown 금지).
- `useSqlAutocomplete(connectionId, tableColumns?)` 기존 호출자 (Sprint 73 이전) 무변경 — dialect 인자는 옵셔널 확장.
- `QueryResult`, `DocumentQueryResult` shape 불변.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.

## Done Criteria

1. `buildSqlLang` 이 dialect 인자를 받고 `sql({ dialect, schema, upperCaseKeywords })` 호출.
2. `QueryEditor.tsx` 의 `buildLangExtension` 이 paradigm=`rdb` 시 dialect 를 합성해 빌드.
3. `QueryTab.tsx` 가 `useConnectionStore((s) => s.connections)` + `tab.connectionId` 로 `db_type` 조회 → dialect 를 QueryEditor prop 으로 전달.
4. `src/lib/sqlDialect.ts` (신규) 가 `databaseTypeToSqlDialect(db_type): SQLDialect` 를 export. `postgresql → PostgreSQL`, `mysql → MySQL`, `sqlite → SQLite`, 기타 → `StandardSQL`.
5. `useSqlAutocomplete` 가 dialect 인자 받고, dialect 별로 identifier label / apply 를 조정 (Postgres 는 lowercase 기본, MySQL 은 backtick-quoted 옵션 보장, SQLite 는 double-quote 옵션).
6. Compartment reconfigure 가 dialect 변경에도 트리거되고 `EditorView` 동일 인스턴스 유지.
7. Postgres / MySQL / SQLite 각 1 개 이상 dialect-specific 키워드 하이라이팅 테스트가 DOM 클래스 단언.
8. Fallback 테스트: dialect 조회 불가 시 StandardSQL 로드, 기존 기본 동작 유지.
9. Document paradigm 탭 테스트 unchanged — JSON 경로 회귀 0.
10. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 전부 통과.
11. 최소 6 개 신규 테스트, 각 AC 매핑.
12. `git diff --stat HEAD -- src-tauri/` empty, Sprint 74 병렬 경로 diff 0.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.test.ts src/components/query/QueryTab.test.tsx` (존재 파일 실행)
  4. `pnpm vitest run` — 전체 suite regression 체크
  5. `git diff --stat HEAD -- src-tauri/` empty 출력
  6. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx` empty 출력
- Required evidence:
  - `buildSqlLang` 시그니처 file:line-range.
  - `databaseTypeToSqlDialect` 매핑 file:line.
  - `useSqlAutocomplete` dialect 분기 file:line.
  - `QueryTab` dialect lookup + prop 전달 file:line.
  - 각 AC → 테스트 이름 매핑.
  - `git diff --stat HEAD -- src-tauri/` 빈 출력 증명.

## Evidence To Return

- 변경/추가 파일 목록 + 각 파일의 역할.
- 6 개 verification check 실행 커맨드 + 결과 수치 (테스트 pass 수, lint/tsc error 수).
- AC-01 ~ AC-10 증거 매핑.
- Assumptions: dialect lookup 실패 케이스 (탭 커넥션 삭제) 에서 StandardSQL 로 degrade 하는 것을 사용자에게 별도 에러로 노출하지 않는다 (조용한 fallback). 이는 Sprint 73 의 document paradigm 에러 처리와 대칭되지 않지만, SQL 경로는 기존 behavior 가 존재하므로 유지.
- Residual risk: MariaSQL / MSSQL / Oracle 등 `DatabaseType` 에 없는 dialect 는 Phase 9 에서 별도 도입 예정 — 이 스프린트에서는 StandardSQL fallback 만 보장.

## References

- Contract: `docs/sprints/sprint-82/contract.md`
- Master spec: `docs/sprints/sprint-81/spec.md` (Sprint 82 섹션)
- Sprint 73 handoff (document paradigm wiring 참고): `docs/sprints/sprint-73/`
- Relevant files (read-only):
  - `src/components/query/QueryEditor.tsx` — Compartment L103, reconfigure L212-220, paradigm 분기 L61-64.
  - `src/components/query/QueryTab.tsx` — schemaNamespace L73, paradigm L119, QueryEditor prop L689-697.
  - `src/hooks/useSqlAutocomplete.ts` — SQL_FUNCTIONS L6-25, namespace 빌더 L52-126.
  - `src/types/connection.ts` — `DatabaseType` L1-7, `paradigmOf` L100-111.
  - `src/stores/connectionStore.ts` — `connections` L12, `loadConnections` L67.
  - `node_modules/@codemirror/lang-sql/dist/index.d.ts` L191-223 — dialect exports.

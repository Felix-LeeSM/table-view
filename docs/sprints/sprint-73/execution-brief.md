# Sprint Execution Brief: sprint-73 (Phase 6 plan E-2)

## Objective

- Mongo paradigm 에서 쿼리 탭을 통해 Find/Aggregate 를 실행할 수 있는 UI 를 완성한다.
- `QueryEditor` 를 paradigm-aware 하게 만들고 CodeMirror language extension 을 SQL ↔ JSON 으로 스왑.
- `QueryTab` 이 `executeQuery` / `findDocuments` / `aggregateDocuments` 를 paradigm + queryMode 에 따라 분기 호출.
- `aggregateDocuments` tauri wrapper + `documentStore.runAggregate` 를 추가해 Sprint 72 백엔드를 소비.
- Rust + 병렬 Sprint 74 경로 diff 0 유지.

## Task Why

- Sprint 72 가 `aggregate_documents` 커맨드를 완성했으므로 이제 UI 만 배선하면 사용자가 mongo 쿼리 탭에서 `{ "status": "active" }` find 나 `[{"$match":{...}},{"$group":{...}}]` aggregate 를 직접 실행할 수 있다.
- Phase 6 master plan 상 Sprint E 는 backend+frontend 묶음이었으나 Sprint 72/73 으로 분리. Sprint 73 가 통과해야 Phase 6 읽기 경로 완료 (편집은 Sprint 80).
- Sprint 74~79 는 병렬 UX Hardening agent 가 선점 중. Sprint 73 가 query/** 에만 집중하면 datagrid/** 와 경로 격리 가능.

## Scope Boundary

**수정 허용**:
- `src/stores/tabStore.ts` — QueryTab 타입 + addQueryTab 시그니처 + setQueryMode 액션.
- `src/stores/documentStore.ts` — runAggregate 메서드.
- `src/lib/tauri.ts` — aggregateDocuments wrapper.
- `src/types/document.ts` — AggregateBody 타입 (필요 시 inline 도 허용).
- `src/components/query/QueryEditor.tsx` — paradigm prop + JSON extension 스왑.
- `src/components/query/QueryTab.tsx` — paradigm/queryMode 분기 + Find/Aggregate 토글.
- `src/components/query/QueryEditor.test.tsx`, `QueryTab.test.tsx` — 테스트 확장.
- `src/stores/tabStore.test.ts`, `documentStore.test.ts` — 존재 시 확장, 없으면 신규.
- `package.json`, `pnpm-lock.yaml` — `@codemirror/lang-json` 추가.

**절대 수정 금지 (diff 0)**:
- `src-tauri/**` 전체 (Sprint 72 확정).
- `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx` — Sprint 74 병렬 agent 작업 중.
- `src/components/shared/QuickLookPanel*`, `src/components/shared/BsonTreeViewer*` — Sprint 70/71 확정.

## Invariants

- 기존 SQL 쿼리 탭 (`paradigm === "rdb"`) 의 executeQuery, multi-statement split, SQL format/uglify, Cmd+Return, history 기록, DataGrid 렌더 동작 완전 불변.
- 기존 `addQueryTab(connectionId, title)` 호출자 (paradigm 없이) 는 후방 호환으로 `"rdb"` + `"sql"` 생성.
- `DocumentDataGrid` 의 runFind 경로 불변 (쿼리 탭은 별도 경로).
- `findDocuments` tauri wrapper 시그니처 불변.
- `DocumentQueryResult`, `FindBody` shape 불변.
- `src-tauri/**` diff 0.
- React convention: function 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.

## Done Criteria

1. `QueryTab` 인터페이스에 `paradigm: Paradigm` + `queryMode: "sql" | "find" | "aggregate"` 필드 추가, 기본값 rdb/sql, 기존 호출자 무변경.
2. `setQueryMode(tabId, mode)` 액션 존재.
3. `aggregateDocuments(connectionId, database, collection, pipeline)` tauri wrapper 존재하고 `invoke("aggregate_documents", {...})` 호출.
4. `documentStore.runAggregate` 가 runFind 와 동일한 stale-guard + cache 패턴.
5. `QueryEditor` 가 paradigm="document" 시 `@codemirror/lang-json`, "rdb" 시 SQL extension. Compartment reconfigure 사용.
6. `QueryTab` 이 paradigm + queryMode 에 따라 handleExecute 분기 (rdb→executeQuery, document+find→findDocuments, document+aggregate→aggregateDocuments).
7. document paradigm 일 때 `Find | Aggregate` 세그먼트 토글 렌더, 클릭 시 setQueryMode 호출.
8. JSON 파싱 실패 시 "Invalid JSON" 에러 UI 표시.
9. Cmd+Return 단축키 paradigm 무관하게 동작.
10. `git diff --stat HEAD -- src-tauri/` empty, Sprint 74 경로 diff 0.
11. 최소 6 개 신규 테스트 추가, 모두 pass.
12. 4개 generator-scope check 전부 통과.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run src/stores/tabStore.test.ts src/stores/documentStore.test.ts src/components/query/QueryEditor.test.tsx src/components/query/QueryTab.test.tsx` (존재하는 파일만 자동 실행)
  4. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` (Rust 회귀 증명)
- Required evidence:
  - `QueryTab.handleExecute` 분기 file:line-range.
  - `QueryEditor` Compartment reconfigure file:line.
  - `addQueryTab` 변경 전후 signature.
  - `aggregateDocuments` wrapper 정의 file:line.
  - `runAggregate` stale-guard 확인.
  - `git diff --stat HEAD -- src-tauri/` empty 출력 스크린샷.
  - `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/` empty 출력.
  - 각 AC → 테스트 이름 또는 file:line 매핑.

## Evidence To Return

- 변경/추가 파일 목록 + 각 파일의 역할.
- 4개 generator-scope check 실행 커맨드 + 결과 수치 (테스트 pass 수, lint/tsc error 수, clippy warning 수).
- AC-01 ~ AC-13 증거 매핑.
- Assumptions: mongo 쿼리 탭 entry point 는 기존 addQueryTab 호출자가 paradigm 을 주입하는 수준으로 최소 대응, 신규 sidebar 메뉴는 out of scope.
- Residual risk: mongo 쿼리 탭 여는 UI 진입점이 기존과 동일하게 keyboard shortcut 이나 command palette 에만 의존 — 사용자 발견성은 UX Hardening 스프린트에서 개선.

## References

- Contract: `docs/sprints/sprint-73/contract.md`
- Sprint 72 handoff (backend aggregate): `docs/sprints/sprint-72/handoff.md`
- Sprint 71 handoff (QuickLookPanel document mode): `docs/sprints/sprint-71/handoff.md`
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint E 섹션 — E-1/E-2 분할)
- Relevant files (read-only reference):
  - `src/stores/tabStore.ts` (QueryTab 타입 L51-59, addQueryTab L232-251)
  - `src/components/query/QueryEditor.tsx` (Compartment 패턴 L52, Mod-Enter L84-89)
  - `src/components/query/QueryTab.tsx` (executeQuery 호출 L98, handleExecute L65-234)
  - `src/lib/tauri.ts` (findDocuments L373-385, executeQuery L214-224)
  - `src/types/document.ts` (FindBody L58-64, DocumentQueryResult L71-77)
  - `src/stores/documentStore.ts` (runFind L130-146)
  - `src/components/DocumentDataGrid.tsx` (Sprint 71 — 읽기만)
  - `src-tauri/src/commands/document/query.rs` (`aggregate_documents` Sprint 72 확정 — 읽기만)

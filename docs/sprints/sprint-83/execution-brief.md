# Sprint Execution Brief: sprint-83 (MongoDB MQL autocomplete + highlight)

## Objective

- Document paradigm 쿼리 탭이 JSON extension 위에 MQL-aware `autocompletion({ override })` 소스를 주입.
- Find mode 는 MQL query operators, Aggregate mode 는 pipeline stages + accumulators, 두 mode 공통으로 BSON extended-JSON 타입 태그, 그리고 현재 컬렉션 캐시된 필드명을 JSON key position 에서 후보로 노출.
- JSON 토큰 중 MQL operator (`$match`, `$sum`, `$oid` 등) 문자열에 별도 decoration class 를 부여해 시각적으로 구분.

## Task Why

- Sprint 82 가 RDB 쪽 provider-aware autocomplete 를 완성했고, Sprint 83 은 그 대칭으로 document paradigm 의 MQL 지원을 채운다. master spec (sprint-81) 기준 Sprint 82+83 이 editor 편집 경험의 provider 대칭을 완성.
- Phase 6 Sprint E (Sprint 72/73) 이 Mongo find/aggregate 실행 경로를 열었으므로, 이제 편집 경험이 SQL 사용자와 동등해야 TablePlus 대체 가치가 유지된다.
- Sprint 74~78 병렬 agent 가 datagrid/** 와 sprint-78 (출처 미상) 에서 작업 중 — Sprint 83 은 query/** + hooks/** + lib/** 경로에만 집중해 충돌 회피.

## Scope Boundary

**수정 허용**:
- `src/components/query/QueryEditor.tsx` — document paradigm 시 `autocompletion({ override: [mongoSource] })` 합성 + operator decoration 확장.
- `src/components/query/QueryTab.tsx` — 활성 document 탭의 cached field names source 조회 → `useMongoAutocomplete` 에 전달 → QueryEditor prop 으로 forward.
- `src/hooks/useMongoAutocomplete.ts` (신규) — `{ queryMode, fieldNames }` 입력 → `CompletionSource` + `Extension[]` 반환.
- `src/lib/mongoAutocomplete.ts` (신규) — pure module: MQL 상수 리스트, position heuristic, CompletionSource 팩토리, highlight decoration 팩토리. React 비의존.
- 테스트 파일 (`*.test.tsx` / `*.test.ts`).

**절대 수정 금지 (diff 0)**:
- `src-tauri/**` 전체.
- `src/components/datagrid/**`, `src/components/DataGrid.tsx`, `src/components/DocumentDataGrid.tsx`, `src/components/DocumentDataGrid.test.tsx` — Sprint 74 agent 작업 경로.
- `src/components/shared/QuickLookPanel*`, `src/components/shared/BsonTreeViewer*` — Sprint 70/71 확정 영역.
- `src/stores/queryHistoryStore.ts`, `src/components/query/GlobalQueryLogPanel.tsx` — Sprint 84/85 scope.
- `src/lib/sqlDialect.ts`, `src/hooks/useSqlAutocomplete.ts` 의 기능 수정 (import 확장은 허용, 기존 export 제거 금지).

## Invariants

- `src-tauri/**` diff 0.
- RDB 쿼리 탭 (paradigm=rdb) 동작 byte-for-byte 불변. Sprint 82 테스트 (107 개) 모두 pass.
- `QueryEditor` Compartment reconfigure 시 `viewRef.current` referential equality 유지.
- `QueryResult`, `DocumentQueryResult`, `FindBody`, `AggregateBody` shape 불변.
- 기존 `useSqlAutocomplete` 시그니처 + 반환값 불변.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지 (불가피 시 eslint-disable 한 줄 + 주석), `dark:` prefix.
- New pure module 은 `src-tauri` 의존 없음, 테스트 가능하도록 setup-side-effect free.

## Done Criteria

1. `src/lib/mongoAutocomplete.ts` 에 `MONGO_QUERY_OPERATORS`, `MONGO_AGGREGATE_STAGES`, `MONGO_ACCUMULATORS`, `MONGO_TYPE_TAGS` 상수 export.
2. `createMongoCompletionSource({ queryMode, fieldNames }): CompletionSource` 팩토리 export — `$` 트리거 시 mode + position 기반으로 올바른 set 반환.
3. `createMongoOperatorHighlight(): Extension` 팩토리 — JSON 토큰 중 operator 문자열에 `cm-mql-operator` 클래스 (또는 동등) 적용.
4. `src/hooks/useMongoAutocomplete.ts` 가 `{ queryMode, fieldNames }` 를 받아 `{ extension: Extension }` (또는 `Extension[]`) 반환.
5. `QueryEditor.tsx` 가 paradigm=document 시 JSON 언어 extension 과 함께 MongoAutocomplete extension 을 Compartment 에 합성. Compartment 재사용.
6. `QueryTab.tsx` 가 document paradigm 탭일 때 캐시된 컬렉션 필드명 source (document store 또는 schemaStore) 에서 읽어 훅에 전달. rdb 경로는 건드리지 않음.
7. 최소 10 개 신규 테스트: (a) find operator set, (b) aggregate stage set, (c) accumulator set inside stage, (d) BSON type tag set, (e) field-name 후보 포함, (f) operator decoration class, (g) rdb 에 `$` 후보 없음 (regression), (h) paradigm swap 시 EditorView identity, (i) 빈 fieldNames 도 throw 없음, (j) 잘못된 position (문자열 내부 등) 에서 null 반환.
8. `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` 전부 pass.
9. `git diff --stat HEAD -- src-tauri/` empty. 병렬/차후 sprint 경로 diff 0.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `pnpm tsc --noEmit`
  2. `pnpm lint`
  3. `pnpm vitest run src/components/query/QueryEditor.test.tsx src/hooks/useMongoAutocomplete.test.ts src/lib/mongoAutocomplete.test.ts src/components/query/QueryTab.test.tsx src/hooks/useSqlAutocomplete.test.ts`
  4. `pnpm vitest run` — 전체 suite regression
  5. `git diff --stat HEAD -- src-tauri/` empty
  6. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx src/stores/queryHistoryStore.ts src/components/query/GlobalQueryLogPanel.tsx` empty
- Required evidence:
  - 상수 리스트 file:line.
  - `createMongoCompletionSource` position heuristic 구현 file:line + 주석으로 "간단한 heuristic, 깊은 scope 분석 X" 명시.
  - decoration 구현 file:line.
  - `useMongoAutocomplete` 호출 경로 file:line.
  - `QueryTab` 의 field-name source 결정 file:line.
  - 각 AC → 테스트 이름 매핑.
  - diff 빈 출력 증명.

## Evidence To Return

- 변경/추가 파일 목록 + 각 파일 역할.
- 6 개 verification check 결과.
- AC-01 ~ AC-11 증거 매핑.
- Assumptions:
  - Position heuristic 은 CodeMirror `syntaxTree` + 가까운 `:` / `[` / `{` 노드 조회로 충분. 완전한 JSON 파싱 스택 없음.
  - Field-name source 는 document store 의 `raw_documents` 가 아닌 기존 `documentStore` 가 `columns: QueryColumn[]` 를 보관한다면 그 이름 목록 사용. 없으면 빈 list.
  - Aggregate mode 의 stage vs accumulator 위치 구분은 "배열 최상위 객체의 첫 key 면 stage, 그 외 객체 내부 key 면 accumulator" 정도의 경계 heuristic.
- Residual risk: 복잡한 pipeline (`$lookup` 안의 `pipeline: [...]`) 중첩 context 에서 오분류 가능 — execution-brief 에 명시한 "깊은 scope 분석 X" 정책으로 허용.

## References

- Contract: `docs/sprints/sprint-83/contract.md`
- Master spec: `docs/sprints/sprint-81/spec.md` (Sprint 83 섹션)
- Sprint 82 handoff: `docs/sprints/sprint-82/handoff.md` (dialect swap 패턴)
- Relevant files (read-only):
  - `src/components/query/QueryEditor.tsx` — 현 상태는 Sprint 82 반영 완료. paradigm==="document" 시 JSON extension 로드 경로 L54, L64, L98.
  - `src/components/query/QueryTab.tsx` — document paradigm 분기 L74, L119-261 (find/aggregate 실행 경로). schemaNamespace L73.
  - `src/stores/documentStore.ts` — cached columns / raw_documents 경로.
  - `src/stores/tabStore.ts` — `QueryTab` 타입의 `database` / `collection` / `queryMode`.
  - `node_modules/@codemirror/autocomplete/dist/index.d.ts` — `CompletionSource`, `CompletionContext`, `autocompletion({ override })` L360.
  - `node_modules/@codemirror/lang-json/dist/index.d.ts` — JSON language extension.
  - `src/lib/sqlDialect.ts` (참고) — Sprint 82 patterns for pure utility module.

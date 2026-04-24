# Sprint Contract: sprint-83 (MongoDB MQL autocomplete + highlight)

## Summary

- Goal: Document paradigm 쿼리 탭이 JSON 언어 위에 MQL-aware autocomplete 와 operator 토큰 하이라이팅을 제공한다. find mode 는 query operator (`$eq`, `$gt`, `$in`, `$and` 등), aggregate mode 는 pipeline stage (`$match`, `$group` 등) + accumulator (`$sum`, `$avg` 등), 그리고 BSON extended-JSON 타입 태그 (`$oid`, `$date`, `$numberLong` 등) 와 활성 컬렉션의 캐시된 필드명까지 모두 후보에 노출.
- Audience: Mongo 사용자가 쿼리 탭에서 `{"$match": ...}`, `{"status": "active"}`, `{"_id": {"$oid": "..."}}` 를 작성하는 시나리오.
- Owner: Generator agent (general-purpose).
- Verification Profile: `mixed`

## In Scope

- `src/components/query/QueryEditor.tsx` — document paradigm 일 때 JSON 언어에 `autocompletion({ override: [mongoSource] })` 또는 동등 확장 합성. mode-aware (find vs aggregate) candidate set. operator 토큰 decoration.
- `src/hooks/useMongoAutocomplete.ts` (신규) — `useMongoAutocomplete({ queryMode, fieldNames })` 훅. MQL operator / stage / accumulator / type-tag 후보 생성 + 캐시된 필드명 결합.
- `src/lib/mongoAutocomplete.ts` (신규) — 상수 리스트 (operator / stage / accumulator / type tag) + `CompletionSource` 구현. React 비의존 pure module.
- `src/components/query/QueryTab.tsx` — document paradigm 탭에서 활성 컬렉션의 field-name source 해석해 editor 에 전달. rdb 경로는 불변.
- 대응 테스트 (`*.test.tsx` / `*.test.ts`) — find vs aggregate 후보 분리, BSON 타입 태그, field-name 후보, operator 토큰 클래스.

## Out of Scope

- RDB (Sprint 82 완료) — byte-for-byte 불변.
- Query history paradigm metadata — Sprint 84 scope.
- History viewer 하이라이팅 — Sprint 85 scope.
- `$expr`, `$lookup` 의 중첩 pipeline 깊은 context 분석 — execution-brief 에 명시한 "오브젝트 값 위치면 전부 제공" 수준.
- 백엔드 (`src-tauri/**`) diff 0.
- DataGrid / DocumentDataGrid / shared BsonTreeViewer / QuickLookPanel — 병렬 경로, 건드리지 않음.

## Invariants

- `src-tauri/**` diff 0.
- RDB 쿼리 탭의 dialect-aware 경로 (Sprint 82) byte-for-byte 불변 — 회귀 없음, `$` 접두 후보가 rdb candidate set 에 섞이지 않음.
- `QueryEditor` Compartment reconfigure 시 `EditorView` 인스턴스 referential equality 유지.
- `QueryResult`, `DocumentQueryResult`, `FindBody`, `AggregateBody` shape 불변.
- 기존 `useSqlAutocomplete` 시그니처 불변.
- React convention: 함수 컴포넌트, `interface Props`, `any` 금지, `dark:` prefix.

## Acceptance Criteria

- `AC-01` — Document paradigm + `queryMode==="find"` 탭에서 `CompletionContext` 가 JSON 오브젝트 내부 `$`-시작 위치에 있을 때 최소 `$eq`, `$ne`, `$gt`, `$gte`, `$lt`, `$lte`, `$in`, `$nin`, `$and`, `$or`, `$nor`, `$not`, `$exists`, `$type`, `$regex`, `$elemMatch`, `$size`, `$all` 후보를 반환. 테스트가 candidate label set 을 집합 단언.
- `AC-02` — Document paradigm + `queryMode==="aggregate"` 탭에서 배열 내부 stage position 이면 최소 `$match`, `$project`, `$group`, `$sort`, `$limit`, `$skip`, `$unwind`, `$lookup`, `$count`, `$addFields`, `$replaceRoot`, `$facet`, `$out`, `$merge` 후보. 집합 단언.
- `AC-03` — Aggregate mode 안의 accumulator 위치 (stage 객체 내부) 에서는 최소 `$sum`, `$avg`, `$min`, `$max`, `$push`, `$addToSet`, `$first`, `$last`, `$count` 후보. find 후보와 달리 accumulator set 이 반환됨. 두 모드 candidate 집합 차이 단언.
- `AC-04` — 오브젝트 값 position (일반 field key 의 값 자리) 에서 `$` 트리거 시 BSON extended-JSON 타입 태그 (`$oid`, `$date`, `$numberLong`, `$numberDouble`, `$numberInt`, `$numberDecimal`, `$binary`, `$regularExpression`, `$timestamp`, `$minKey`, `$maxKey`, `$symbol`, `$code`) 후보 노출.
- `AC-05` — 활성 document 탭이 cached field names 를 갖고 있으면 (document store 또는 새 전용 store) 그 필드명들이 JSON key position 에서 `find` filter body 또는 `$match` stage body 에서 autocomplete 후보로 나타난다. 테스트가 known field set (`["_id", "email", "status"]`) seed 후 candidate 포함 단언.
- `AC-06` — JSON 하이라이팅 layer 에 MQL operator 문자열이 별도 클래스 또는 token attribute 로 구분된다. fixture 에 `{"$match": {"$eq": 1}}` 렌더 → `$match`, `$eq` 토큰이 ordinary JSON string 과 다른 class/attribute 를 가짐. 테스트가 렌더된 DOM 의 operator span class 단언.
- `AC-07` — RDB 탭 (paradigm=rdb) candidate set 에 `$`-시작 후보가 없음. 정규식 `/^\$/` 단언.
- `AC-08` — `EditorView` referential equality 가 Sprint 82 의 dialect swap + Sprint 83 의 paradigm swap 경로에서 모두 유지. 테스트가 paradigm rdb→document 전환 후 view 동일 단언.
- `AC-09` — `pnpm tsc --noEmit`, `pnpm lint` 에러 0 / 경고 0.
- `AC-10` — `git diff --stat HEAD -- src-tauri/` empty. Sprint 74/78 등 병렬 경로 diff 0 (`src/components/datagrid/**`, `DataGrid.tsx`, `DocumentDataGrid.tsx`, `shared/QuickLookPanel*`, `shared/BsonTreeViewer*`). Sprint 84/85 scope 파일 (`queryHistoryStore.ts`, `GlobalQueryLogPanel.tsx`) 도 diff 0.
- `AC-11` — 최소 8 개 신규 테스트 (operator / stage / accumulator / type-tag / field / highlight / rdb-regression / editor-identity). 모두 pass. 전체 vitest regression 0.

## Design Bar / Quality Bar

- MQL 상수 리스트는 pure module 에 정의 (`src/lib/mongoAutocomplete.ts`) — React 비의존, 다른 컴포넌트에서도 재사용 가능 (Sprint 85 MongoSyntax 도 consumer).
- `CompletionSource` 는 `CompletionContext` 의 `matchBefore(/\$[a-zA-Z]*/)` 등으로 `$`-트리거 감지. context position 을 파싱해 find / aggregate / accumulator / value 위치를 대략적으로 구분. 오브젝트 값 position 은 "가장 가까운 `:` 직후면 value position" 같은 간단한 heuristic 허용 — 깊은 스코프 분석 X (execution-brief 에 명시).
- Operator 하이라이팅은 CodeMirror decoration 또는 StateField + `highlightingFor` 패턴 사용. 성능상 큰 문서에서도 O(문서 크기) 이상이 되지 않도록 viewport-based decoration 권장 (lint 경고 없이).
- 후보 set 은 deterministic (정렬 가능) 해서 테스트 단언이 안정.
- Document paradigm 에서 `autocompletion({ override })` 또는 `autocompletion()` + `@codemirror/lang-json` 의 기본 completion 에 추가 source 합성 중 하나를 택함. override 가 더 단순하고 테스트 가능. 기본 JSON 후보 (bool / null) 는 제거하지 말 것.

## Verification Plan

### Required Checks

1. `pnpm tsc --noEmit` — 타입 에러 0.
2. `pnpm lint` — 경고/에러 0.
3. `pnpm vitest run src/components/query/QueryEditor.test.tsx src/hooks/useMongoAutocomplete.test.ts src/lib/mongoAutocomplete.test.ts src/components/query/QueryTab.test.tsx src/hooks/useSqlAutocomplete.test.ts` — 신규 + 기존 테스트 전부 pass.
4. `pnpm vitest run` — 전체 suite Sprint 82 baseline 회귀 없음.
5. `git diff --stat HEAD -- src-tauri/` 빈 출력.
6. `git diff --stat HEAD -- src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx src/stores/queryHistoryStore.ts src/components/query/GlobalQueryLogPanel.tsx` 빈 출력.

### Required Evidence

- Generator must provide:
  - 변경/추가 파일 목록 + 각 파일 목적.
  - `mongoAutocomplete.ts` 의 operator / stage / accumulator / type-tag 상수 set file:line.
  - `CompletionSource` 구현 file:line + position heuristic 주석.
  - Operator 하이라이팅 decoration file:line.
  - `useMongoAutocomplete` 훅 반환 모양 file:line.
  - `QueryTab` 의 field-name source 전달 file:line.
  - `QueryEditor` 의 document paradigm autocompletion 합성 file:line.
  - 각 AC-01 ~ AC-11 → 테스트 이름 또는 file:line 매핑.
  - `git diff --stat HEAD -- src-tauri/` 및 forbidden-path 빈 출력 증명.
- Evaluator must cite:
  - 각 AC 에 대한 pass/fail 판단의 concrete evidence (candidate label 출력, DOM 클래스 이름, 파일 offset).
  - 빠진/약한 증거는 finding 으로 기록.

## Test Requirements

### Unit Tests (필수)
- AC-01 ~ AC-08 각각 최소 1 개 테스트.
- 에러/예외 케이스: 빈 JSON body, 잘못된 파서 상태 → source 가 null 반환.

### Coverage Target
- 신규/수정 코드: 라인 70% 이상 권장.
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)
- [ ] Happy path — find mode `{ "$` 타이핑 시 operator 후보 노출.
- [ ] Happy path — aggregate mode `[{ "$` 타이핑 시 stage 후보.
- [ ] 에러/예외 상황 — 문서 탭이 컬렉션 필드 캐시 없을 때 static 후보만 (빈 field set 도 throw X).
- [ ] 경계 조건 — paradigm rdb→document 전환 시 view 동일.
- [ ] 기존 기능 회귀 없음 — RDB 탭 candidate 에 `$` 후보 없음, Sprint 82 테스트 전부 pass.

## Test Script / Repro Script

1. `pnpm install` (lock 변경 시) → `pnpm tsc --noEmit && pnpm lint`.
2. `pnpm vitest run` — 전체 pass.
3. 수동 스모크: `pnpm tauri dev` → Mongo 커넥션 → 컬렉션 쿼리 탭 → find mode 에서 `{ "$` 타이핑 → operator popup 확인. aggregate mode → `[{ "$` 타이핑 → stage popup 확인. `{ "_id": { "$` → BSON 타입 태그 확인. 에디터에 실제 operator 가 별색으로 렌더되는지 확인.

## Ownership

- Generator: general-purpose agent (single pass).
- Write scope:
  - `src/components/query/QueryEditor.tsx`
  - `src/components/query/QueryTab.tsx`
  - `src/hooks/useMongoAutocomplete.ts` (신규)
  - `src/lib/mongoAutocomplete.ts` (신규)
  - 위 파일들의 `.test.tsx` / `.test.ts`
- Merge order: Sprint 82 이후, Sprint 84 이전.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`

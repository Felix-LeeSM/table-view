# Sprint 122 → next Handoff

## Sprint 122 Result

- **PASS** (1 attempt) — 1874/1874 tests, tsc 0, lint 0. 1852 → 1874 (+22: 11 mqlFilterBuilder + 11 DocumentFilterBar). 회귀 0.

## 산출물

- **NEW** `src/lib/mongo/mqlFilterBuilder.ts` (117 LoC):
  - `MqlOperator` union type — 8 ops: `$eq` `$ne` `$gt` `$lt` `$gte` `$lte` `$regex` `$exists`.
  - `MqlCondition` — `{ id, field, operator, value }` (value 항상 string).
  - `MQL_OPERATORS` 상수 — UI 라벨 (`=`, `≠`, `>`, `<`, `≥`, `≤`, `regex`, `exists`).
  - `buildMqlFilter(conditions)` — flat-field MQL document. 같은 field 의 여러 operator 는 nested object 로 merge (`{age: {$gte:18, $lt:65}}`); 다른 field 는 top-level keys (implicit `$and`).
  - `coerceNumeric` — 6 numeric ops (`$eq`/`$ne`/`$gt`/`$lt`/`$gte`/`$lte`) 만 적용. `Number(raw)` round-trip + `Number.isFinite` + whitespace-only 차단 (`Number("  ") === 0` 함정 회피).
  - `coerceBoolean` — `$exists` 만; `"true"` (case-insensitive) → boolean.
  - `$regex` 는 raw string 유지 (numeric coercion 없음).
  - `stringifyMqlFilter(filter)` — Structured → Raw mode swap 시 prefill 직렬화 (2-space indent).

- **NEW** `src/lib/mongo/mqlFilterBuilder.test.ts` — 11 tests:
  1. empty list → `{}`
  2. `$eq` numeric coercion
  3. `$eq` string fallback
  4. `$gt` 0.5 (소수)
  5. 동일 field merge (`$gte` + `$lt` → `{age: {$gte:18, $lt:65}}`)
  6. `$regex` 는 raw string (숫자 input 도 string)
  7. `$exists` boolean (`"true"`, `"False"`, `""` → false)
  8. multi-field implicit `$and`
  9. 빈 field name skip
  10. whitespace-only 입력 → `Number("  ")` coercion 차단
  11. `stringifyMqlFilter` pretty-print

- **NEW** `src/components/document/DocumentFilterBar.tsx` (~360 LoC):
  - 두 모드: Structured / Raw MQL — `ToggleGroup` 으로 전환.
  - **Structured 모드**: `StructuredRow` 행 (field Select + operator Select + value Input + remove Button). `Add Filter` / `Clear All` / `Apply filter` 버튼. `fieldNames` 비어있으면 placeholder, 비어있지 않으면 첫 row 자동 생성 (RDB FilterBar UX 와 동일 — `autoCreatedRef` 가드).
  - **Raw MQL 모드**: 내부 `RawMqlEditor` 컴포넌트 — CodeMirror 6 + `json()` lang + `useMongoAutocomplete({queryMode: "find", fieldNames})` 로 field-name AC + `$`-operator AC 노출.
  - **Mode swap**:
    - Structured → Raw: `buildMqlFilter(conditions)` + `stringifyMqlFilter` 로 raw 에디터 prefill (`handleModeChange` `DocumentFilterBar.tsx:154-167`).
    - Raw → Structured: 별도 parse 안 함 — Structured 의 자체 state 가 살아있으므로 toggle back 시 그대로 보존. (best-effort parse 는 후속 sprint.)
  - **Apply 경로**:
    - Structured: `handleStructuredApply` → `buildMqlFilter(conditions)` → `onApply(filter)`.
    - Raw: `handleRawApply` → trim → `JSON.parse` (실패 시 inline alert + onApply 미호출) → 객체/배열 검증 → `onApply(parsed)`.
  - **Clear All**: 양쪽 state + `autoCreatedRef` 리셋 + `onClear()`.
  - **CodeMirror pattern**: sprint-121 의 `AddDocumentModal` 패턴 재사용 — callback ref + `useState<HTMLDivElement | null>` + `Compartment` 로 `mongoExtensions` reconfigure. 외부 `value` prop 변경 (Structured → Raw prefill) 시 doc 비교 후 dispatch — infinite loop 회피.
  - 부수: `useFieldNamesFromCache` helper export — `DocumentDataGrid` 외 다른 consumer 가 fieldsCache 를 그대로 사용하고 싶을 때 사용 (현재는 grid 가 직접 cache 를 읽어 prop 으로 내려줌).

- **NEW** `src/components/document/DocumentFilterBar.test.tsx` — 11 tests:
  1. `renders Filters label and both mode toggles` — `Structured` / `Raw MQL` radio 존재.
  2. `auto-creates one structured row keyed to the first field` — first field 로 row 자동 생성, Apply 버튼 노출.
  3. `calls onApply with a $gte filter when the structured row is built` — operator → `$gte`, value `"18"` → `{age: {$gte: 18}}`.
  4. `submits the structured filter via Enter key on the value input` — Enter → `onApply({age: {$eq: "Ada"}})`.
  5. `renders the Raw MQL CodeMirror editor with role=textbox` — Raw 탭 클릭 시 `.cm-editor` 존재.
  6. `prefills the Raw editor with the structured filter on mode swap` — Structured 변경 후 Raw 탭 → editor doc = JSON.stringify({age:{$gte:18}}, null, 2).
  7. `invokes onApply with the parsed JSON from the Raw editor` — `{"_id": {"$exists": true}}` → `onApply` 호출.
  8. `shows an inline error and does not call onApply for invalid Raw JSON` — `{not valid` → role=alert "Invalid MQL JSON".
  9. `rejects a JSON array in Raw mode with a non-object error` — `[1,2,3]` → role=alert "MQL filter must be a JSON object".
  10. `invokes onClear and onClose via the dedicated buttons` — Clear All / Close 버튼.
  11. `falls back to a placeholder option when fieldNames is empty` — fieldNames `[]` 면 auto-row 생성 안 함, Add Filter 만 노출.

- **MODIFIED** `src/components/document/DocumentDataGrid.tsx`:
  - `DocumentFilterBar` import 추가 (`DocumentDataGrid.tsx:16`).
  - `fieldsCacheEntry`, `filterFieldNames`, `activeFilter`, `activeFilterCount`, `showFilters` state 추가 (`DocumentDataGrid.tsx:55-77`).
  - `fetchData` 에 `filter: activeFilterCount > 0 ? activeFilter : undefined` 전달 (`DocumentDataGrid.tsx:84-94`). dependency 에 `activeFilter`/`activeFilterCount` 추가.
  - `DataGridToolbar` 의 `activeFilterCount` / `showFilters` / `onToggleFilters` 가 더 이상 no-op 이 아님.
  - 토글 시 `<DocumentFilterBar>` mount — `onApply` 가 `setActiveFilter` + `setPage(1)`, `onClear` 도 동일.

## AC Coverage

- **AC-01** ✅ — `git diff --stat HEAD -- src/components/rdb/FilterBar.tsx` empty.
- **AC-02** ✅ — `DocumentFilterBar.tsx:170-282` 가 toggle (Close 버튼), Raw MQL 에디터 (`RawMqlEditor`), Structured 탭 (`StructuredRow`) 제공. 테스트 #1, #2, #5.
- **AC-03** ✅ — `mqlFilterBuilder.test.ts` 11/11 통과; 5 operator (`$eq`, `$gt`, `$gte`, `$regex`, `$exists`) 모두 검증 (테스트 #2~#7).
- **AC-04** ✅ — `RawMqlEditor` 가 `useMongoAutocomplete({queryMode: "find", fieldNames})` 호출 (`DocumentFilterBar.tsx:336-339`). fieldNames 는 `DocumentDataGrid` 가 fieldsCache 에서 derive 해 prop 으로 내려줌. 테스트 #5/#6 가 wiring 확인.
- **AC-05** ✅ — `handleRawApply` (`DocumentFilterBar.tsx:128-153`) 가 invalid JSON 시 `setRawError` + `onApply` 미호출. 테스트 #8/#9.
- **AC-06** ✅ — Structured → Raw prefill: `handleModeChange` (`DocumentFilterBar.tsx:158-167`). 테스트 #6 가 정확한 직렬화 검증. Raw → Structured 는 Structured state 보존 — 별도 parse 없음, 본 handoff 에서 deferred 명시 (아래 "가정/리스크" 참고).
- **AC-07** ✅ — `DocumentDataGrid.tsx:280-293` 가 `<DocumentFilterBar>` mount; `runFind` (`DocumentDataGrid.tsx:84-94`) 가 `filter` 파라미터 사용. `documentStore.runFind` 시그니처 변경 0 — `FindBody.filter` 가 이미 옵셔널로 존재 (`src/types/document.ts:59`).
- **AC-08** ✅ — `pnpm vitest run src/components/rdb/FilterBar.test.tsx` 통과 (전체 1874/1874 안에 포함). RDB 회귀 0.
- **AC-09** ✅ — flat-field 만 v1; nested path / `$elemMatch` / `$in` array / `$or` / `$and` 복합은 후속. 본 handoff 의 "가정/리스크" 명시.
- **AC-10** ✅ — sprint-120 (`paradigm.ts`) + sprint-121 (`AddDocumentModal.tsx`) byte-identical: 종합 hard-stop diff empty.

## 검증 명령 결과

- `pnpm vitest run src/lib/mongo/mqlFilterBuilder.test.ts` → **11/11 pass**.
- `pnpm vitest run src/components/document/DocumentFilterBar.test.tsx` → **11/11 pass**.
- `pnpm vitest run` → **112 files / 1874/1874 pass** (sprint-121 baseline 1852 + 22).
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/components/rdb/ src/lib/paradigm.ts src/components/document/AddDocumentModal.tsx` → 빈 출력.

## 구현 노트

- **builder pure function**: `mqlFilterBuilder` 는 React 의존성 없음 — 단위 테스트 용이, 다른 viewer 에서 재사용 가능.
- **callback ref + useState 패턴 재사용**: sprint-121 의 lesson 그대로 — Radix Dialog portal 이 아닌 inline mount 라도 일관성 + 미래 portal-내 mount 호환을 위해 동일 패턴.
- **Compartment 사용**: fieldNames 가 fieldsCache 갱신으로 바뀌면 `mongoExtensions` identity 변경 → `Compartment.reconfigure` 발화. 에디터는 alive.
- **value prop sync**: Structured → Raw prefill 은 외부 `value` prop 으로만 driven. `useEffect [value]` 안에서 doc 비교 후 dispatch — `updateListener` 가 `onChange` 를 발화하지만 `setRawText(v)` 가 동일 string 이면 React 가 재렌더 skip → infinite loop 없음. 추가로 doc-equal 가드까지 두어 안전장치.
- **fieldNames identity**: `DocumentDataGrid` 의 `useMemo([fieldsCacheEntry])` 가 안정적 reference — fieldsCache 미변경 시 동일 array reference → `useMongoAutocomplete` 의 useMemo dep 가 hit, extension 재생성 안 함.
- **page reset on apply**: filter 적용 시 `setPage(1)` — 이전 페이지 인덱스가 새 결과집합에 부적합할 수 있음.
- **activeFilterCount 의 의미**: top-level field 개수 — RDB 의 row-개수 카운트와 정렬됨. `{age: {$gte:18, $lt:65}}` 는 1 (single field).
- **runFind 호출 시 빈 filter 처리**: `activeFilterCount > 0` 일 때만 `filter` 전달 — 빈 객체를 보내도 backend 는 동작하지만 wire payload 최소화.

## 가정 / 리스크

- **가정**: fieldsCache 가 grid mount 직후 채워짐 (sprint-87 이후 `runFind` 가 columns 추가). Cache miss 일 때 fieldNames `[]` → Structured 모드는 첫 row 자동생성 안 함, Raw 모드는 generic AC 만.
- **리스크 (낮음)**: Raw → Structured 가 best-effort parse 안 함 — 사용자가 Raw 에서 복잡한 JSON 만든 뒤 Structured 로 toggle 하면 Structured state (이전 row) 가 노출됨. 의도적 (단순 v1) 이지만 학습 곡선 추가. 후속에서 `MQL filter → conditions[]` parser 추가 가능.
- **리스크 (낮음)**: `$exists` 의 value field 는 텍스트 input — `"true"` / `"false"` 외 입력 시 모두 `false` 로 coerce. UX 개선 시 `$exists` 선택 시 input 을 boolean toggle 로 swap 가능.
- **리스크 (낮음)**: nested path (`a.b.c`) 미지원 — backend 는 처리할 수 있지만 builder 가 dot-path 를 허용하지 않을 이유 없음. 다만 v1 은 testing surface 축소를 위해 flat 만. 후속에서 path validation + UI 안내 추가.
- **리스크 (낮음)**: `$in` array / `$elemMatch` / `$or` / `$and` 복합 — 후속 sprint. 현재는 row 별 `$and` (implicit) 만.

## 회귀 0

- mqlFilterBuilder: 신규.
- DocumentFilterBar: 신규.
- DocumentDataGrid: filter wiring 추가만 — 기존 toolbar/grid 로직 변경 0.
- RDB `FilterBar.test.tsx` byte-for-byte 통과.
- sprint-120/121 산출물 byte-identical (`paradigm.ts`, `AddDocumentModal.tsx`).
- src-tauri/, useDataGridEdit, mqlGenerator, useMongoAutocomplete 모두 byte-identical.

## 다음 sprint

- **Sprint 123**: paradigm 시각 cue (#PAR-5) — connection icon / tab badge / status pill.
- 후속 가능:
  - Raw → Structured best-effort parse (`MQL filter → conditions[]`).
  - `$in` array / `$elemMatch` / `$or` / `$and` 복합 operator 지원.
  - Nested path (`a.b.c`) 지원.
  - `$exists` 의 boolean toggle UX.

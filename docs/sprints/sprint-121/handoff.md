# Sprint 121 → next Handoff

## Sprint 121 Result

- **PASS** (1 attempt) — 1852/1852 tests, tsc 0, lint 0. 1847 → 1852 (+5: AddDocumentModal sprint-121 cases). 회귀 0.

## 산출물

- **MODIFIED** `src/components/document/AddDocumentModal.tsx`:
  - textarea 제거 → CodeMirror 6 EditorView (callback ref `setContainerRef` + `[containerEl]` deps; useRef 패턴은 Radix Dialog portal 환경에서 첫 effect 시 null 이라 callback ref 채택).
  - 신규 imports: `@codemirror/{state,view,language,commands,autocomplete,lang-json}` + `useMongoAutocomplete` + `useDocumentStore`.
  - 신규 optional props: `connectionId?`, `database?`, `collection?` (3 인자 모두 채워졌을 때만 fieldsCache lookup 활성).
  - `useMongoAutocomplete({ queryMode: "find", fieldNames })` 호출 → 1) JSON key 위치에서 cached field name AC, 2) value 위치에서 BSON helper / `$`-prefix operator AC, 3) operator highlight extension.
  - Cmd/Ctrl+Enter `keymap.of([...])` 의 첫 binding (defaultKeymap 의 Mod-Enter `insertNewlineAndIndent` 보다 우선) — `submitRef.current()` 호출.
  - JSON `parseError` semantics 보존: `Document is required` / `Invalid JSON: …` / `Document must be a JSON object` 메시지 byte-identical. `onSubmit(parsed)` 인자도 동일.
  - 사용자가 다시 타이핑하면 `parseError` 자동 클리어 (`updateListener` 안에서 `setParseError((prev) => prev !== null ? null : prev)`).
  - 부모 `error` prop 은 local `parseError` 가 없을 때만 노출 (`{error && !parseError && ...}` 보존).

- **MODIFIED** `src/components/document/DocumentDataGrid.tsx`:
  - `<AddDocumentModal>` props 에 `connectionId={connectionId} database={database} collection={collection}` 추가. 다른 변경 0.

- **MODIFIED** `src/components/document/AddDocumentModal.test.tsx` — 7 base cases + 5 sprint-121 cases = 12:
  - `setDocumentText(value)` 헬퍼: `EditorView.findFromDOM(.cm-editor)` → `view.dispatch({ changes: ... })` (jsdom 의 fireEvent.change 가 .cm-content 에 안 먹히므로).
  - 기존 7 케이스 (sprint 87) 의 단언/시나리오 byte-identical, helper 만 교체.
  - 신규 5 케이스 (sprint 121):
    1. `renders a CodeMirror editor (no <textarea>) with role=textbox` — DOM 구조 확인.
    2. `falls back to no field-name AC when connection scope is omitted` — 연결 scope 없을 때 popup 미노출.
    3. `surfaces fieldsCache field names when connection scope is provided` — fieldsCache 에서 도출된 fieldNames (`active`, `email`) 가 mongo source 에 전달됨을 store 상태 + DOM 확인으로 검증.
    4. `clears the parseError when the user edits the document after a failure` — invalid → submit → typing → parseError null.
    5. `ignores the parent error prop when a local parseError is active` — alerts 1 개만; parseError 우선.

- **MODIFIED** `src/components/document/DocumentDataGrid.test.tsx` (sprint 87 의 toolbar Add 테스트 1 줄):
  - `fireEvent.change(textarea, ...)` → `EditorView.findFromDOM(.cm-editor) + view.dispatch(...)` (CodeMirror dispatch 패턴; `act()` 로 감쌈). 단언 보존.

- `docs/sprints/sprint-121/{contract.md, execution-brief.md, handoff.md}`.

## AC Coverage

- AC-01 ✅ — `AddDocumentModal.tsx:135-194` 가 EditorView 생성. `AddDocumentModal.test.tsx` "renders a CodeMirror editor" 케이스가 `<textarea>` 부재 + `.cm-editor` 존재 단언.
- AC-02 ✅ — `useMongoAutocomplete({ queryMode: "find", fieldNames })` (`AddDocumentModal.tsx:96-99`); `fieldsCache[${connId}:${db}:${coll}]` 도출 (`AddDocumentModal.tsx:81-93`). 테스트 "surfaces fieldsCache field names …" 가 store 에 ColumnInfo 2 개 채워넣고 derived fieldNames 가 ["active","email"] 임을 단언.
- AC-03 ✅ — `useMongoAutocomplete` 가 `createMongoCompletionSource({ queryMode: "find", fieldNames })` 를 wrap. find 모드에서 dollar-prefix 토큰은 operator/type-tag 후보 (BSON helper 포함 — ObjectId/ISODate/NumberLong/NumberDecimal 는 `MONGO_TYPE_TAGS`) 노출. `mongoAutocomplete.ts:184-193` 의 dollar candidate path.
- AC-04 ✅ — `keymap.of([...])` 의 Mod-Enter binding 이 첫 자리 → defaultKeymap 보다 우선. 테스트 "submits via Cmd+Enter keyboard shortcut from the editor" 가 binding 직접 호출 + onSubmit 호출 인자 단언. Esc/Cancel 은 FormDialog/Radix 표준 경로 — 테스트 "invokes onCancel when the Cancel button is clicked" 가 보존.
- AC-05 ✅ — `parseError` 분기 보존: 빈 입력 / invalid JSON / array. 메시지 + `onSubmit` 미호출 단언 모두 byte-identical. 부모 `error` prop 는 parseError 없을 때만 노출 — 테스트 "ignores the parent error prop when a local parseError is active" 가 parseError 우선 보장.
- AC-06 ✅ — props `connectionId/database/collection` 는 모두 optional. 누락 시 `fieldsCacheEntry` 가 undefined → `EMPTY_FIELDS` → `useMongoAutocomplete` 에 빈 배열 전달 → field name AC 미노출, generic MQL AC 만 (operator/type-tag/aggregate stage). 테스트 "falls back to no field-name AC when connection scope is omitted" 가 popup 미노출 단언.
- AC-07 ✅ — sprint 87 의 7 케이스 모두 통과 (helper 만 교체). 신규 +5 케이스 = 12/12 PASS.
- AC-08 ✅ — `isPlainObject` 체크 그대로. JSON array 입력 → `Document must be a JSON object`; 단일 도큐먼트 scope 유지.
- AC-09 ✅ — `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/hooks/useMongoAutocomplete.ts src/components/rdb/ src/lib/paradigm.ts` empty.

## 검증 명령 결과

- `pnpm vitest run src/components/document/AddDocumentModal.test.tsx` → 12/12 pass.
- `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx` → 15/15 pass (toolbar Add 포함).
- `pnpm vitest run` → 110 files / **1852/1852** pass.
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `git diff --stat HEAD -- src-tauri/ src/components/datagrid/useDataGridEdit.ts src/lib/mongo/mqlGenerator.ts src/hooks/useMongoAutocomplete.ts src/components/rdb/ src/lib/paradigm.ts` → 빈 출력.

## 구현 노트

- **callback ref vs useRef**: useRef 첫 시도 시 effect 안에서 `containerRef.current === null`. Radix Dialog 가 portal + focus-guard span 으로 children 을 mount 하는 경로에서 ref attach 와 effect 발화 사이에 race 가 있는 것으로 보임 (HTML 은 DOM 에 있지만 effect 시점에는 ref 가 비어있음). callback ref + state 패턴으로 바꿔 element mount 가 결정적으로 effect 를 trigger 하도록 함. 동일 사례는 sprint 122/123 의 portal-내-CodeMirror 도입 시 재사용 가능.
- **fieldNames identity**: `useMemo` 로 안정적 reference 보장. fieldsCache 가 동일하면 동일 array reference 반환 → `useMongoAutocomplete` 의 useMemo dep 가 hit, extension 재생성 안 함. 단, fieldsCache 변경 시 새 array → Compartment reconfigure (`useEffect [mongoExtensions]`) — 에디터는 alive.
- **EMPTY_FIELDS module 상수**: 빈 배열을 매 render 새로 만드는 함정 회피. fieldsCache 미설정 시 동일 reference.
- **submitRef 패턴**: keymap binding 안의 `run` closure 가 stale handleSubmit 잡지 않게. `submitRef.current = handleSubmit` 매 render 갱신, binding 은 항상 최신 호출.
- **DocumentDataGrid.test.tsx 1 라인 변경**: textarea 가 사라졌으므로 fireEvent.change 동작 불가. EditorView dispatch 로 교체. 단언 (`insertDocumentMock` arg) 변경 0.
- **Test setup**: `useDocumentStore.setState({ fieldsCache: {} })` 를 beforeEach 에서 호출 — fieldsCache 가 테스트 간 leak 안 되도록.

## 가정 / 리스크

- 가정: fieldsCache 가 도큐먼트 첫 fetch 직후 채워짐 (`runFind` → backend 가 columns 추가 또는 explicit `inferFields` 호출). 본 sprint 의 modal 은 cache hit 만 가정 — cache miss 시 generic AC 로 graceful fallback.
- 리스크 (낮음): CodeMirror 가 Radix Dialog portal 안에서 focus 흡수가 자연스럽지 않을 가능성. 본 구현은 mount 시 `view.focus()` 를 try/catch (jsdom focus 미구현 회피). 실 브라우저에서는 focus 잘 동작 (sprint 73 QueryEditor 패턴 동일).
- 리스크 (낮음): JSON 의 위치-인식 (key vs value) 휴리스틱이 `mongoAutocomplete.ts:153` 의 `classifyPosition` 에 의존. quote 안 일부 위치에서는 noise 가 적게 발생 가능 (sprint 83 contract 가 imprecision 허용 명시). 본 sprint 는 그 동작을 그대로 채용.
- 리스크 (낮음): `MqlPreviewModal` / 다른 도큐먼트 dialog 가 비슷하게 textarea 를 쓴다면 일관성 위해 함께 마이그레이션 필요할 수 있음. 본 sprint 는 AddDocumentModal 한정.

## 회귀 0

- AddDocumentModal sprint 87 7 케이스: 통과 (helper 만 교체).
- DocumentDataGrid 15 케이스: toolbar Add 1 라인 helper 갱신, 단언 보존.
- 다른 110 파일 1840 케이스: 무회귀.
- src-tauri/, useDataGridEdit, mqlGenerator, useMongoAutocomplete, rdb/, paradigm 모두 byte-identical.

## 다음 sprint

- Sprint 122: DocumentFilterBar (#PAR-4) — `src/components/document/DocumentFilterBar.tsx` 생성, `DocumentDataGrid` 가 paradigm 별 FilterBar 를 hot-swap.
- Sprint 123: paradigm 시각 cue (#PAR-5) — connection icon / tab badge / status pill.
- 후속 가능: `MqlPreviewModal` 도 CodeMirror + JSON read-only 로 마이그레이션 (현재 textarea read-only 유지).

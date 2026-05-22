# Phase 28 + Phase 29 Decision Log

> **목적**: 2026-05-14 사용자 directive — "mongodb 관련 변경사항 모두
> 구현하고, 그 다음에 rdbms와 함께 하기로 했던 것들까지 모두 구현해.
> 우선 널 믿을테니 필요한 의사 결정이 있다면 네가 혼자 해보고, 문서로
> 어떤 결정을 어떤 근거로 내렸는 지 적어줘. 단, 모든 의사 결정은 어떤
> 문제를 해결하기 위함인 지를 명시하도록 하고, 그 관점에서 최선의 의사
> 결정을 내려야 해."
>
> 본 문서는 Phase 28 Slice A1-M + Phase 29 U1-U5 진행 중 assistant 가
> 자율적으로 내린 결정을 **(1) 어떤 문제 (2) 결정 (3) 근거 (4) 대안과
> trade-off** 형식으로 누적한다. grill 에서 이미 lock 된 결정은
> `memory/roadmap/phase-28-mongo-full-support/memory.md` 가 source —
> 본 문서는 그 결정 안에서 발생한 implementation-level micro-decision 만
> 기록한다.
>
> 메모리 팔레스 ADR 과 차이: 본 문서는 sprint scope 안 implementation
> trade-off 의 동결 로그 (sprint context 가 없으면 의미가 사라짐). 시스템
> 전반에 영향을 주는 결정은 `memory/decisions/` 에 ADR 로 별도 기록.

## 형식

```
### D-NN: <짧은 결정명> (Sprint XXX, YYYY-MM-DD)

**문제**: 무엇을 해결해야 했는가. (사용자 / 시스템 / 다른 sprint 관점)
**결정**: 무엇을 골랐는가.
**근거**: 왜 이게 최선인가. 다른 결정은 어떤 cost 가 있었는가.
**대안**: 검토했지만 채택하지 않은 선택지 + 채택하지 않은 이유.
**영향**: 어떤 후속 sprint / 모듈이 이 결정에 의존하는가.
```

---

## Phase 28 Slice A2 (Sprint 308 — 2026-05-14)

### D-01: `BulkWriteResult` 의 wire shape 을 snake_case 로 유지 (camelCase 로 바꾸지 않음)

**문제**: A2 에서 `BulkWriteOp` 는 `#[serde(tag = "op", rename_all =
"camelCase")]` 로 camelCase wire (사용자의 `bulkWrite([{ op: "updateOne",
...}])` 입력과 동일 shape 매칭하기 위함). 그렇다면 `BulkWriteResult` 의
필드 (`inserted_count` 등) 도 camelCase 로 바꿔서 wire 일관성 확보해야
하는가?

**결정**: `BulkWriteResult` 는 Rust 측 snake_case 그대로 wire 직렬화한다
(`inserted_count`, `matched_count`, `modified_count`, `deleted_count`,
`upserted_ids`). TS 측 타입도 동일 snake_case key.

**근거**: 기존 `DocumentQueryResult`, `RdbQueryResult` 등 wire 결과 타입이
모두 snake_case (Rust 의 `#[derive(Serialize)]` default). 결과 타입만
camelCase 로 바꾸면 (1) 기존 result-shape consumer 가 분기 처리 필요,
(2) Rust 측 코드 패턴이 불일치, (3) `BulkWriteOp` 와 다르게 사용자가 직접
입력하지 않는 server-out 결과는 camelCase 의 발생가치가 없다. 입력
(`BulkWriteOp`) 만 사용자 mongosh 시그니처와 정합을 맞추고, 출력은
프로젝트 내 wire convention 을 따른다.

**대안**: 모든 신규 타입을 camelCase 로 통일 — 거부. 기존 wire convention
을 깬다.

**영향**: A6 의 `WriteSummaryPanel` 이 `result.inserted_count` 등 snake_case
access. evaluator 가 contract 와의 불일치를 flag 할 수 있음 — handoff
의 assumption 으로 명시.

---

### D-02: `bulk_write([])` empty input short-circuit

**문제**: 사용자가 `db.coll.bulkWrite([])` 를 입력 (또는 dispatch path 가
빈 배열로 도달) 했을 때 driver 가 거부할 수도 있고, 빈 결과를 반환할
수도 있음. 어느 behaviour 를 wire 로 보장하는가?

**결정**: backend `bulk_write_impl` 이 입력이 empty 면 `Ok(BulkWriteResult::default())`
를 즉시 반환 (driver 호출 skip). `insert_many_impl` 도 동일 — empty 면
`Ok(vec![])`.

**근거**: (1) mongo driver (특히 8.0+) 가 빈 배열에 대해 에러를 반환하면
사용자에게 노이즈가 됨 — "0건의 작업을 수행" 이라는 명백한 의도가
에러로 surface 되면 UX 가 깨진다. (2) wire 의 결정성 보장: empty 입력은
항상 empty 출력. (3) Sprint A6 의 `WriteSummaryPanel` 이 빈 결과를
"0건 변경" 으로 자연스럽게 렌더 가능.

**대안**: driver 에 그대로 위임 — 거부. driver 버전마다 행동 분기 위험.

**영향**: 통합 테스트가 empty 케이스 cover 해야 함 — Generator handoff 의
test 목록 확인 필요.

---

### D-03: read-path 4 method 만 cancel-token 인자, write-path 2 method 는 미보유

**문제**: A2 의 6 신규 method 중 어디까지 `cancel: Option<&CancellationToken>`
를 시그니처에 노출하는가?

**결정**: read (`find_one`, `count_documents`, `estimated_document_count`,
`distinct`) 4 method 만 cancel 인자 보유. write (`insert_many`,
`bulk_write`) 2 method 는 미보유.

**근거**: mongo driver 가 in-flight write 의 cooperative abort 를 지원하지
않음. cancel 인자를 노출하면 사용자 / 호출자가 "이 작업은 cancel 가능"
이라 잘못 가정. 명시적으로 인자를 없애 contract 를 표현한다 — type
system 자체가 invariant 의 일부. trait doc 에 이유 명시.

**대안**: 모든 method 가 cancel 인자 받고 write 는 무시 — 거부. type
은 "cancel 가능" 을 약속하는데 런타임은 무시하면 caller 가 잘못된
기대를 갖는다.

**영향**: A5 dispatch 가 write method 호출 시 cancel token 을 넘기지 않음
을 인지. 통합 테스트가 cancel scenario 를 read method 에만 작성.

---

## Phase 28 Slice A3 (Sprint 309 — 2026-05-14)

### D-04: `useMongoAutocomplete` 의 `queryMode` 매개변수를 완전 제거 (sentinel 유지 X)

**문제**: A3 가 Find/Aggregate toggle 을 editor surface 에서 제거하면서
`useMongoAutocomplete` 의 dispatch 분기를 단일 surface 로 collapse 해야
한다. 매개변수를 (a) 시그니처에서 완전 제거 / (b) `"unified"` sentinel
로 유지하는 두 가지 선택지가 있다.

**결정**: 매개변수를 완전 제거. 호출 시그니처는
`useMongoAutocomplete(opts?: { fieldNames?: readonly string[] })`. hook
내부에서 `createMongoCompletionSource({ queryMode: "aggregate", … })`
로 hard-code 해서 underlying source 의 aggregate-mode 경로 (find
operators + aggregate stages + accumulators + type tags 의 union) 를
선택한다.

**근거**:
1. **Call-site cost**: A3 가 끝난 시점에 caller 가 3개 (`QueryTab.tsx`,
   `AddDocumentModal.tsx`, `DocumentFilterBar.tsx`) — 셋 다 더 이상
   queryMode 를 알 필요 없다. sentinel 을 유지하면 모든 caller 가
   `queryMode: "unified"` 라는 의미 없는 boilerplate 를 들고 다녀야 한다.
2. **타입 안전성**: 매개변수 제거 = 컴파일러가 caller 의 dead arg 를
   잡아낸다 (AddDocumentModal / DocumentFilterBar 가 그래서 발견됐다).
   sentinel 이라면 caller 가 `"find"` 를 계속 보내도 컴파일 통과,
   런타임에 silent ignore.
3. **A4 / 후속 sprint**: snippet menu (A4) 는 hook 의 시그니처를
   바꿀 일이 없다. parameter 가 비어있는 편이 A4 에서 추가될 옵션
   (예: snippet-aware filter) 을 깔끔하게 받기에 좋다.
4. **`createMongoCompletionSource` 의 `MongoQueryMode` 는 유지**: 그
   API 는 별도로 `MongoQueryEditor.test.tsx` / `QueryEditor.test.tsx`
   가 직접 호출해서 unit-test 한다. 그래서 deep layer 는 mode-aware
   로 둔 채, hook layer 에서만 collapse 한다. 미래에 mode-aware unit
   test 를 유지하면서 hook 만 union surface 로 둘 수 있는 유연성을
   보존.

**대안**:
- `"unified"` sentinel 유지 — 거부. 위 2번 (silent dead arg) + 1번
  (boilerplate) 이 cost.
- `useMongoAutocomplete` 가 `"aggregate"` 가 아닌 별도 union 모드를
  underlying source 에 새로 만든다 — 거부. underlying source 의
  `aggregate` 가 이미 (operators + stages + accumulators + types) 의
  union 을 반환한다. 새 모드를 추가하면 deep layer 도 함께 수정해야
  하고, 그 변경은 A4 의 snippet menu 가 (constants 를 직접 import 하니)
  의존하지 않는다.

**영향**:
- A4 (Sprint 310) 의 snippet menu 는 hook 시그니처와 무관 — constants
  를 `mongoAutocomplete.ts` 에서 직접 import.
- A5 (Sprint 311) 의 parser-driven dispatch 도 hook 시그니처 무관.
- 후속 sprint 에서 `MongoQueryMode` type 자체를 제거할 때, hook 호출
  사이트 변경 없이 underlying source 만 정리하면 된다.

---

### D-05: `tab.queryMode` 를 optional 로 만들고 `addQueryTab` 의 document 분기에서 default 제거

**문제**: spec 은 "type union 잔존, 신규 tab 미설정, 기존 persisted load
throw 없음" 을 요구한다. 두 가지 구현 선택지:
(a) 타입은 required 유지하고 `addQueryTab` 이 `"find"` 를 계속 설정
(b) 타입을 optional 로 바꾸고 `addQueryTab` 이 document 분기에서
    아예 설정하지 않음

**결정**: (b). `QueryTab.queryMode` 를 `QueryMode | undefined` 로
optional 화. `addQueryTab` 의 document 분기는 `queryMode` 를 명시적으로
설정하지 않는다 (RDB 분기는 `"sql"` 그대로). `persistence.ts` 의 legacy
migration backfill 은 손대지 않음 — 기존 persisted 페이로드가
`queryMode` 를 누락한 경우 `"find"` / `"sql"` 로 backfill 해 legacy
계약을 유지.

**근거**:
1. **Spec 의 의도**: spec invariant 가 "신규 tab queryMode 미설정 →
   `=== 'aggregate'` false → find dispatch" 를 명시. 타입이 required
   이면 "미설정" 이라는 상태가 불가능하다 — JSDoc 만 deprecated 라고
   적어도 런타임은 여전히 값을 들고 다닌다.
2. **A5 의 cleanup 가시성**: optional 마킹 + `@deprecated` JSDoc 가
   결합되면 A5 (Sprint 311) 에서 dispatch 분기를 parser-driven 으로
   교체할 때 IDE 가 모든 consumer 를 표시해 준다. (a) 라면 `"find"` 가
   항상 set 되어 있어 cleanup 시점에 dead consumer 와 살아있는
   consumer 의 구분이 어렵다.
3. **Backward-compat**: `useQueryExecution` 의 `tab.queryMode ===
   "aggregate"` 는 `undefined` 에 대해 자연스럽게 false 를 반환 —
   default 가 find dispatch 가 된다. 기존 persisted aggregate tab 은
   여전히 aggregate dispatch.
4. **`queryHistoryStore.addHistoryEntry` 시그니처가 이미 `queryMode?:
   QueryMode` (optional)**: tab 의 optional 화가 downstream 에 호환.

**대안**:
- (a) — 거부. spec 의 "신규 tab 미설정" 을 type 시스템에서 표현하지
  못함.
- 타입에서 `queryMode` 를 완전 제거하고 `unknown` 캐스트로 dispatch —
  거부. spec 이 "타입 union 잔존" 을 명시. legacy persisted tab 의
  type-safe 접근을 잃는다.

**영향**:
- `useQueryExecution.ts` (A5 target) 은 `tab.queryMode` 를 옵셔널로
  취급. 현행 `=== "aggregate"` 비교는 안전 (undefined 비교 가능).
- `queryHistoryStore` 등 `tab.queryMode` 를 통과시키는 코드 모두 이미
  `?:` optional 로 수용 — 회귀 0.
- `addQueryTab` test (sprint-309) 가 doc 분기 undefined 를 lock.
- `persistence.ts` 의 backfill 은 정책 보존 (legacy payload 가
  queryMode 누락 시 `"find"` 로 backfill) — spec 의 "load throw 없음"
  invariant 와 align.

## Phase 28 Slice A4 (Sprint 310 — 2026-05-14)

### D-06: snippet 의 user-visible placeholder 문법으로 `<name>` 채택, CodeMirror native `${…}` 는 engine 내부 변환

**문제**: snippet 템플릿의 placeholder 문법을 어떻게 표기하는가. (1) `<name>`
(spec/contract 의 표기), (2) `$name`, (3) CodeMirror native `${name}` /
`${1:name}` 의 세 후보.

**결정**: snippet 데이터 모듈 (`mongoshSnippets.ts`) 이 노출하는 템플릿은
`<placeholder>` 문법을 그대로 사용한다 (예: `db.<collection>.find(<filter>)`).
engine 모듈 (`snippetEngine.ts`) 이 삽입 직전에 `<name>` → `${name}` 으로
변환해 CodeMirror 의 `snippet()` 에 넘긴다. 변환 함수는 export 해서 unit
test 로 lock.

**근거**:
1. **Spec 정합**: sprint-310 contract AC-04 / sprint-307 spec UI States 가
   모두 `<placeholder>` 표기를 사용자에게 보여주는 것으로 명시. 데이터
   모듈이 그대로 그 표기를 들고 있으면 spec ↔ source 매핑이 1:1.
2. **CodeMirror native syntax 는 backslash escaping 의 비용** 을 가짐 —
   사용자 / 후속 sprint 가 템플릿을 추가할 때 `{` `}` 를 literal 로
   넣으려면 escape 필요. `<…>` 는 JS string 안에서 escape 가 필요 없는
   문자.
3. **Round-trip 가능성**: snippet template 자체를 dialog / settings 에
   사용자가 보거나 편집할 가능성 (후속 sprint) 을 대비. `<filter>` 가
   `${1:filter}` 보다 훨씬 자연어에 가까움.

**대안**:
- `${name}` raw — 거부. (1) spec 표기와 mismatch, (2) `{` literal 의 escape
  비용, (3) source 의 가독성 떨어짐.
- `$name` — 거부. mongosh 연산자 (`$gt`, `$match`) 와 시각적으로 충돌.
  사용자가 placeholder 와 mongo operator 를 구분 어려움.

**영향**: `snippetEngine.ts` 가 `convertPlaceholders(template: string)` 변환
함수 + `insertMongoshSnippet(view, template)` 두 surface 를 노출. 변환
유닛 테스트가 모든 sprint 310 snippet 의 conversion 정합을 lock.

---

### D-07: snippet 삽입 + Tab/Shift+Tab/Esc placeholder 네비를 `@codemirror/autocomplete` 의 `snippet()` API 로 위임

**문제**: snippet 삽입 후 placeholder 사이를 Tab/Shift+Tab/Esc 으로 이동
하는 동작을 (1) `@codemirror/autocomplete` 의 `snippet()` + `snippetKeymap`
빌트인을 쓸지 / (2) custom 구현 (StateField + cursor selection + key
binding) 을 쓸지.

**결정**: 빌트인 `snippet()` 사용. `MongoQueryEditor` 가 이미
`autocompletion()` extension 을 마운트하고 있으므로 `snippetKeymap`
(Tab/Shift+Tab/Esc 의 default binding) 도 자동으로 활성. snippet wrapper
는 `convertPlaceholders` 후 `snippet(template)(view, null, from, to)` 를
호출하기만 하면 된다.

**근거**:
1. **Zero dependency cost**: `@codemirror/autocomplete` 가 이미 deps —
   추가 패키지 없음. ADR 0029 가 mongosh 파서 strategy 로 CodeMirror
   생태계 의존을 lock.
2. **Tab/Shift+Tab/Esc 의 well-tested 동작**: CodeMirror 가 placeholder
   문서 순서 cycling + 동일 이름 multi-placeholder 의 독립 편집 + Esc
   시 마지막 placeholder 뒤 cursor 위치 등을 모두 covered. AC-04 / AC-05
   가 요구하는 모든 동작이 빌트인.
3. **future-proof**: 다른 paradigm (RDB SQL snippet) 이 추후 같은 engine
   을 재사용 가능. custom 구현이면 매번 dialect 별 키 바인딩 / state
   추적 코드를 새로 작성해야 함.
4. **Test surface**: CodeMirror snippet API 는 EditorView 가 있으면
   바로 호출 가능 — `EditorState.create` + `new EditorView` 패턴이
   기존 `autocompleteTheme.test.ts` 와 동일. JSDOM 으로 충분.

**대안**:
- Custom StateField + KeyBinding 구현 — 거부. (1) Tab cycling /
  Shift+Tab back / Esc clear / 동일 이름 multi-placeholder 처리 모두
  re-implement. (2) CodeMirror 의 snippetKeymap 과 우선순위 충돌 위험
  (default Tab → acceptCompletion 이 이미 우리 코드에 있음, 거기에
  추가 layer 가 끼어들면 race).

**영향**: `snippetEngine.ts` 의 표면이 매우 작아짐 — 변환 1 + 호출 1.
test 가 EditorView 인스턴스 위에서 직접 동작을 검증.

---

### D-08: operator snippet 은 wrapped fragment (`{ $gt: <value> }`) — operator + value 의 완성 fragment 를 삽입

**문제**: Operators 섹션의 `$gt` 같은 항목을 클릭했을 때 (1) operator
이름만 (`$gt:`) / (2) operator + placeholder pair (`$gt: <value>`) /
(3) wrapped object fragment (`{ $gt: <value> }`) 중 무엇을 삽입하는가.

**결정**: wrapped fragment — `{ $gt: <value> }`. 삽입 후 첫 placeholder
(`<value>`) 가 자동 선택.

**근거**:
1. **사용자 mental model**: mongosh 의 query filter 는
   `{ field: { $gt: 30 } }` 패턴. 사용자가 operator menu 를 클릭하는
   시점은 보통 field 의 value position 에 있음 — `{ $gt: <value> }` 가
   곧장 paste-and-go 가능한 fragment.
2. **A4 의 scope 와 align**: A4 는 "boilerplate 를 줄인다" 가 목표.
   `$gt:` 만 주면 사용자가 `{ }` 와 `value` 를 직접 채워야 함 — boilerplate
   reduction 절반밖에 못함.
3. **Operator/Stage 의 균형**: Stages 섹션은 이미 `{ $match: <expr> }`
   pattern 으로 wrapped fragment. Operators 도 동일 패턴을 따르면 두
   섹션 사이의 일관성 + 사용자 학습 곡선 ↓.
4. **AC-04 의 first placeholder selection** 이 wrapped fragment 에서
   자연스럽게 동작: `<value>` 가 첫 placeholder 라서 클릭 즉시 입력
   focus.

**대안**:
- operator name only (`$gt:`) — 거부. 사용자가 fragment 를 완성하려면
  추가 키 입력 필요. menu 의 가치 ↓.
- key+value pair (`$gt: <value>`) — 거부. 외부 `{ }` 가 없어서 multi-line
  filter 안에서 사용 시 syntax 불일치. wrapped fragment 가 일관성 ↑.

**영향**: `mongoshSnippets.ts` 의 Operators / Stages 두 섹션 모두
wrapped fragment 표기. snippet 테스트가 wrapped 형식을 lock.

---

### D-09: editor view ref 는 `useQueryEvents` 에서 이미 만들어진 `editorRef` 를 prop drilling 으로 toolbar 에 전달

**문제**: `InsertSnippetMenu` 가 snippet 삽입 시 EditorView 가 필요.
이를 toolbar 가 어떻게 획득하는가. 후보: (1) `useQueryEvents` 의 기존
`editorRef` 를 toolbar prop 으로 추가, (2) React context (`EditorViewContext`)
신설, (3) Zustand store 에 editor view ref 저장, (4) `MongoQueryEditor`
의 `onEditorViewReady` callback 신설.

**결정**: (1) — `editorRef: RefObject<EditorView | null>` 를
`QueryTabToolbarProps` 에 추가. `QueryTab.tsx` 가 이미 `useQueryEvents`
에서 받은 `editorRef` 를 `MongoQueryEditor` / `SqlQueryEditor` 의 `ref`
로 넘기고 있으므로, 같은 ref 를 toolbar prop 으로도 그대로 넘긴다.

**근거**:
1. **Single source of truth**: editor view 의 ref 는 이미 한 곳
   (`useQueryEvents`) 에서 관리. context / store 를 신설하면 동일 정보가
   두 곳에 존재 → drift 위험.
2. **Minimum diff**: QueryTab.tsx 가 prop 1 개 추가만 하면 됨. context
   신설은 wrapper 컴포넌트 + Provider 추가 + 모든 consumer 변경. 같은
   효과를 prop 1 line 으로 달성.
3. **Test 용이성**: RTL 에서 toolbar 만 단독 mount 시 mock ref 를
   props 로 주입하기 쉬움. context 라면 Provider wrap 필요.
4. **타입 명확성**: prop type `RefObject<EditorView | null>` 가
   toolbar 가 editor 와 결합되어 있다는 사실을 type 으로 표현. context
   는 implicit dependency.

**대안**:
- React context — 거부. wrapper / Provider 의 비용이 추가 prop 1 개의
  비용보다 크다.
- Zustand store — 거부. DOM ref 를 store 에 넣으면 serialization /
  rehydration 시 dangling. ref 의 mutability 가 store 의 immutability
  계약을 깸.
- `onEditorViewReady` callback — 거부. `useQueryEvents` 가 이미 ref 를
  보유하므로 callback 은 중복.

**영향**: `QueryTabToolbarProps` 에 `editorRef` prop 추가.
`InsertSnippetMenu` 는 prop 으로 `editorRef.current` 를 받음. RDB
paradigm 에서는 prop 이 전달되지만 `+ Insert ▾` 자체가
`isDocument` gate 안에 있으므로 사용되지 않음.

---


### D-10: Dispatch logic stays inline in `useQueryExecution.ts`

**문제**: Sprint 311 (Phase 28 Slice A5) 의 parser-driven Run dispatch
를 어디에 놓을 것인가. 후보: (1) `useQueryExecution.ts` 내부 inline,
(2) `queryHelpers.ts` 로 helper 추출, (3) 신규 `mongoDispatch.ts` 모듈.

**결정**: (1) — inline 유지. `dispatchMongoshCall` + 6 method helper
(`runDocumentFind` / `runDocumentFindOne` / `runDocumentCount` /
`runDocumentEstimatedCount` / `runDocumentDistinct` / `runMongoAggregateNow`)
는 모두 `useCallback` 으로 hook 내부에 정의. 각 helper 가 hook scope
의 `tab.id`, `tab.connectionId`, store action (`completeQuery` /
`failQuery` / `updateQueryState`), `recordHistory` 를 클로저로 쓰기에
별도 모듈로 추출하면 6 개 추가 인자를 props 처럼 받아야 함 → 추출
이득보다 인자 churn 비용이 크다.

**근거**:
1. **Hook scope dependency**: 각 method helper 는 store action 5 종 +
   `recordHistory` + `tab.id` 를 사용. 추출 시 helper 가 hook 형태가
   되어야 하며 그러면 사실상 hook decomposition 이 됨. A5 의 scope
   를 넘는 refactor.
2. **Test surface 안정**: `useQueryExecution.test.ts` 는 hook 1 개의
   contract 를 testing. inline 유지 시 테스트 추가만으로 contract
   확장 가능.
3. **A6 (Sprint 312)** 에서 write-path dispatch 가 추가됨 — 그때 8
   write method 가 합류하면 그 시점에 helper 추출 ROI 가 재평가됨.
   지금 추출하면 A6 의 5 추가 helper 도 같은 module 로 묶거나
   helper 들을 다시 정리해야 함.

**대안**:
- `queryHelpers.ts` 로 추출 — 거부. 현재 `queryHelpers.ts` 는 pure
  유틸 (`readDocumentContext`, `isRecord`, `dispatchDbMutationHint`)
  를 담고 있어 dispatch helper 의 store-action coupling 과 결이 다름.
- 신규 `mongoDispatch.ts` — 거부. 위 1 의 인자 churn 비용 + A6 추가
  시 재정리 필요.

**영향**: `useQueryExecution.ts` 가 ~1500 라인. 충분히 큰 함수지만
각 helper 가 자기 책임만 가지고 있어 가독성은 유지됨. A6 이후
helper 가 12 개를 넘으면 그때 추출 그릴링.

---

### D-11: Cursor chain → FindBody mapping은 sort/limit/skip 만 (projection 제외)

**문제**: A1 의 `ParsedMongoshCall.cursorChain` 은 `{ name, args }`
step list. `FindBody` 는 `{ filter, sort, projection, skip, limit }`.
projection 을 chain 으로 받을지 / 따로 받을지.

**결정**: A5 는 `sort` / `limit` / `skip` 만 mapping. `projection`
은 추후 A4 snippet 의 wrapped fragment 로 전달 (A6 이상에서 강화).
`.toArray()` 는 parsed but ignored (default IPC 가 array 반환).

**근거**:
1. **A1 의 chain shape**: A1 의 `CURSOR_CHAIN_METHODS` 는 `sort` /
   `limit` / `skip` / `toArray` 만 허용. projection 은 mongosh 에서
   `.project({...})` 가 아닌 `find({}, projection)` 의 2nd arg 또는
   `.projection({...})` 로 들어옴. A1 이 아직 후자를 캡처하지 않음.
2. **`find(filter, options)` 의 2nd arg**: 추후 A6 / A1 확장에서
   parsed.args[1] 로 capture 가능. A5 는 args[0] (filter) 만 사용.
3. **사용자 routing**: projection 이 필요한 사용자는 A4 snippet
   menu 의 "Projection Query" template (`db.<coll>.find(<filter>,
   <projection>)`) 를 사용. A5 가 두 path 를 동시에 wire 하면
   confusion.

**대안**:
- `.projection({...})` chain step 도 mapping — 거부. A1 의
  `CURSOR_CHAIN_METHODS` 에 추가가 필요한데 그건 A1 동결 위반.
- `find(filter, projection)` 의 2nd arg mapping — 거부. A1 의 parser
  는 args 를 그대로 통과시키지만 A5 에서 mapping 추가 시 추가 test
  + edge case (`null` projection, sparse object). A6 가 더 적합한
  scope.

**영향**: 사용자가 `db.users.find({}).projection({})` 를 쳐도 A5 는
`invalid-cursor-chain` error 를 surface (A1 가 reject). A5 의 documented
limitation 이며 A6 가 polish.

---

### D-12: `findOne(None)` 은 빈 grid 로 렌더링 (A6 가 "No match" 패널로 polish)

**문제**: `findOne` 이 `null` (= 매치 없음) 반환 시 UI 가 어떻게 표현
하는가. 후보: (a) 빈 grid (`columns: []`, `rows: []`), (b) sentinel
row (`columns: [{name: "result"}], rows: [["(no match)"]]`).

**결정**: (a) — 빈 grid. `find({})` 가 0 docs 반환과 동일한 shape.

**근거**:
1. **Consistency**: `find` 와 `findOne` 의 empty case 가 같은 shape →
   grid 가 paradigm 별 분기 없이 동일 path.
2. **A6 polish responsibility**: AC-311 의 scope 는 "wire shapes for
   scalar/list; A6 will polish rendering". findOne empty 도 같은 카테고리.
3. **Cell sentinel vs empty grid 의 ambiguity**: sentinel row 를
   넣으면 사용자가 "1 row matched, value is the string '(no match)'"
   로 오해할 가능성. 빈 grid 가 unambiguous.

**대안**:
- Sentinel row — 거부. 위 3 의 오해 risk + A6 의 "No match" 패널
  scope 침해.

**영향**: A5 의 findOne null case 는 grid 가 row 0 으로 렌더링. A6
가 dedicated "No match" 패널 mount.

---

### D-13: History `queryMode` 는 parsed method 이름이 win (legacy persisted 무시)

**문제**: persisted legacy tab 이 `queryMode: "aggregate"` 를 carry
하지만 사용자가 editor 에 `db.coll.find(...)` 를 쳐 실행. history
entry 의 `queryMode` 는 무엇이 들어가야 하는가.

**결정**: parsed method 이름 (`"find"`) 가 win. 즉 history 가 실제
실행된 method 를 reflect. 사용자 가 `queryMode === "aggregate"` 로
filter 했을 때 보이는 entry 는 "실제로 aggregate 를 실행한 entry" 만.

**근거**:
1. **History 의 의미**: history 는 "내가 무엇을 실행했는가" 의 기록.
   tab.queryMode 는 persisted UI state 이지 "이번 실행" 의 method 가
   아님. 사용자 mental model 과 align.
2. **Filter UI compat**: 기존 `queryMode === "aggregate"` filter 가
   "내가 실행한 aggregate" 만 보여주는 게 더 정확.
3. **Backward-compat**: 사용자가 legacy 의 `tab.queryMode: "aggregate"`
   를 가진 tab 에서 `db.coll.find(...)` 를 실행해도 history 는
   `"find"` 로 기록. 사용자가 새로 만든 tab 의 동작과 일관.

**대안**:
- `tab.queryMode` 우선 — 거부. 위 1 의 mental-model misalignment.
- 둘 다 기록 (`queryMode`, `executedMethod`) — 거부. schema churn +
  filter UI 변경 비용.

**영향**: history 의 `queryMode` 는 6 read method (A5) + 7 write
method (A6) 의 superset union 으로 widening. `QueryMode` type 도
같이 widening (`src/stores/workspaceStore/types.ts`).

---

### D-14: collection-mismatch 에러 메시지는 contract 의 영어 wording 채택

**문제**: tab.collection 이 set 이고 parsed.collection 과 다를 때
surface 할 메시지. 후보: (a) 영어 (contract AC-02 verbatim),
(b) Korean translation.

**결정**: (a) — contract 의 영어 wording 그대로:
`"Editor targets collection '<parsed>' but tab is bound to '<bound>'."`

**근거**:
1. **Contract 정합성**: AC-311-02 가 exact wording 을 명시. wording
   변경은 contract 재협의가 필요.
2. **Codebase 의 다른 에러 메시지**: 대부분 영어 (예: `"Document
   query tabs require a target database and collection."`). 일관성.
3. **i18n**: 추후 i18n 도입 시 일괄 변환 대상.

**대안**:
- Korean wording — 거부. 위 1/2.

**영향**: `useQueryExecution.test.ts` 의 collection-mismatch 회귀가
이 wording 으로 lock.

---

### D-15: Pending confirm payload 는 parsed pipeline 만 보유 (full `ParsedMongoshCall` 아님)

**문제**: `pendingMongoConfirm` / `pendingMongoWarn` 의 payload 는
무엇을 보유하는가. 후보: (a) `{ pipeline: Record<string, unknown>[] }`
(현재 shape), (b) `{ parsed: ParsedMongoshCall }` (전체 보존).

**결정**: (a) — pipeline 만. 기존 dialog consumer 호환성 100% 유지.

**근거**:
1. **Backward-compat**: `ConfirmDestructiveDialog` / `MqlPreviewModal`
   이 이미 `pipeline: Record<string, unknown>[]` shape 을 consume.
   shape 변경은 modal 의 prop type + JSX 변경을 동반.
2. **Confirm-flow 의 isolation 보장**: 사용자가 editor 를 mutate 한
   경우에도 confirm callback 이 parsed pipeline 으로 re-dispatch.
   AC-311-09 의 stale-editor 격리 가드는 pipeline 만 보유해도 충족.
3. **A6 가 method name 을 modal 에 노출하고 싶다면**: 그때 modal
   prop 에 별도 `method?: MongoshMethod` 를 추가하면 됨. 지금은
   needed 아님.

**대안**:
- 전체 `ParsedMongoshCall` 보존 — 거부. 위 1 의 호환성 비용.
- pipeline + method tuple — 거부. 위 3 의 timing.

**영향**: `useQueryExecution.ts` 의 `setPendingMongoConfirm({ pipeline,
reason })` / `setPendingMongoWarn({ pipeline })` 시그니처 불변.
`confirmMongoDangerous` → `runMongoAggregateNow(pipeline, collection)`
재진입 path 도 동일.

---

## Phase 28 Slice A6 (Sprint 312 — 2026-05-14)

### D-16: `updateOne` / `deleteOne` 의 non-`_id` filter 는 `bulkWriteDocuments` single-op 으로 변환

**문제**: 기존 `updateDocument` / `deleteDocument` IPC 는 `DocumentId`
만 받음. mongosh `updateOne(filter, update)` 의 `filter` 가 `_id` 외
임의 조건일 때 wire 매칭 불가. A6 는 신규 IPC 도입 금지 — frontend
만으로 처리.

**결정**: (b) bulkWrite single-op 변환 채택.
- (a) `findOneDocument` 로 `_id` resolve → `updateDocument`
- (b) `bulkWriteDocuments([{op:"updateOne", filter, update}])` 변환
- (c) "filter must include `_id`" reject

**근거**:
1. **Atomicity**: (a) 는 2 round-trip = race condition. (b) 는 단일
   driver call.
2. **Latency**: (a) = 2x. (b) = 1x.
3. **Code reuse**: A2 의 `bulkWriteDocuments` 가 이미 임의 filter / op
   variant 처리.
4. **UX 보존**: editor / history 의 mongosh 텍스트 `updateOne(...)` 유지.
5. **`_id`-only 빠른 경로**: filter 가 `{_id: ...}` 만이면 기존 IPC 직접
   호출.

**대안**: (a) race + latency 거부. (c) 사용자 부담 거부.

**영향**: `useQueryExecution` 의 `updateOne`/`deleteOne` 분기 두 경로
보유. A6 backend 변경 zero.

---

### D-17: `bulkWrite` Safe Mode 분류 — 첫 위반 sub-op 으로 short-circuit

**문제**: sub-op 들이 STOP / WARN / INFO 가 섞인 `bulkWrite` 의 severity?

**결정**: STOP > WARN > INFO 우선순위. 첫 STOP 즉시 `danger`, 없으면 첫
WARN 으로 `warn`, 그것도 없으면 `info`.

**근거**:
1. **ordered default short-circuit**: driver 가 첫 실패 시 정지 — STOP
   포함 시 미확인 부분 실행 방지.
2. **사용자 모델**: STOP sub-op 포함 = "확인 받기 원함" 의도.

**대안**: max severity 일괄 분석 — 결과 동일 verbose.

**영향**: `analyzeMongoOperation` 의 `bulkWrite` variant 가 sub-op 순회
short-circuit.

---

### D-18: `insertMany` 는 항상 INFO (배치 크기 무관)

**문제**: 매우 큰 N 의 `insertMany` 를 WARN 으로 escalate?

**결정**: 항상 INFO.

**근거**: insert = 신규 doc 추가만, 손실 위험 없음. 사용자 의도 explicit.
threshold 의 임의성.

**대안**: N>threshold WARN — 임계 임의성 거부.

**영향**: `insertMany` variant 항상 `severity: "info"`.

---

### D-19: `findOne` 빈 결과 — `resultKind: "scalar"` + sentinel

**문제**: `findOne(...)` 매칭 없음 — grid 인가 scalar 인가?

**결정**: `resultKind: "scalar"` + `ScalarOrListPanel mode="findOne-empty"`.

**근거**: 빈 grid 의미 모호. "No matching document" 의도 명확. `findOne`
자체가 0/1 boolean 의미.

**영향**: A5 의 빈 grid → A6 의 sentinel panel polish.

---

### D-20: KV / Search placeholder 의 `data-query-mode` 속성 제거

**문제**: A3 가 MongoQueryEditor 의 `data-query-mode` 제거했지만 KV /
Search placeholder 분기에 잔존. Global Slice A AC #1 위반.

**결정**: KV / Search placeholder 에서도 제거.

**근거**:
1. KV / Search 는 mongosh queryMode 의미 없음.
2. 속성 사용처 없음.
3. Global AC #1 만족.

**영향**: `grep queryMode in QueryTab.tsx` 정확히 0.

---

## Sprint 313 (Slice B.1) — `$in` / `$nin` field-level ops

### D-21: Slice B 의 13 operators 를 2 sub-sprint 로 분할

**문제**: phase-28 Q7 (13 ops 빈도순) — 한 sprint 에 모두 구현하면
generator/evaluator scope 가 너무 넓고, composite (`$or`/`$and`/`$not`)
는 `MqlCondition` (field-keyed flat) 모델로 자연 매핑이 안 됨.
flat row + composite group 을 한 PR 에 묶으면 (a) builder shape 양극화,
(b) UI layout 재설계, (c) 회귀 가드 부담이 동시에 들어옴.

**결정**: Slice B 를 두 sub-sprint 로 분할.
- **B.1 (Sprint 313)**: field-level 10 ops 중 신규 2 (`$in`, `$nin`).
  CSV → array. `MqlCondition` 모델 미변경.
- **B.2 (Sprint 314)**: composite 3 (`$or`, `$and`, `$not`). MqlGroup
  모델 도입, nested condition tree, group row UI.

**근거**: 빈도 우선순위에서 `$in` / `$nin` 이 `$or`/`$and`/`$not` 보다
사용 빈도 높음. 먼저 field-level 을 잠그면 Raw MQL fall-back 의존이
감소. composite UI 는 별 모델이 필요해 분리 변경이 자연스러움.

**대안**: 한 sprint 에 묶기 (큰 PR, 회귀 가드 위험), 또는 composite 를
Raw MQL 만으로 노출하고 영구 미구현 (사용자 자율 directive 의 "모두
구현" 위반).

**영향**: Slice B 일정이 2 commit 으로 늘어남. 단 각 commit 회귀 면적
좁아져 검토/롤백 용이.

---

### D-22: operator dropdown 순서 = 빈도순, label = SQL idiom (`IN` / `NOT IN`)

**문제**: 기존 `MQL_OPERATORS` 순서는 `$eq $ne $gt $lt $gte $lte $regex
$exists` — 빈도순과 불일치 (`$gt $lt $gte $lte` vs 빈도순 `$gt $gte $lt
$lte`). 신규 `$in` / `$nin` label 도 `"in"` (Mongo) vs `"IN"` (SQL)
선택 필요.

**결정**:
- 순서 = phase-28 Q7 의 빈도순 정합: `$eq $ne $gt $gte $lt $lte $in
  $nin $exists $regex`.
- Label = SQL idiom: `=`, `≠`, `>`, `≥`, `<`, `≤`, `IN`, `NOT IN`,
  `exists`, `regex`. RDB FilterBar 의 `LIKE` / `IS NULL` 와 같은
  upper-case SQL 관용을 따른다.

**근거**:
1. memory palace 의 명세와 정합.
2. RDB ↔ Mongo 전환 시 사용자가 같은 단어 (`IN`, `LIKE`) 를 인식 —
   인지 부하 감소.
3. `$exists` / `$regex` 는 SQL 대응이 약해 Mongo 이름 유지.

**대안**: lower-case `"in"` / `"not in"` (Mongo-native) — 정합성은
좋지만 SQL 사용자와의 단절. Generator 가 `IN` / `NOT IN` 채택.

**영향**: 기존 dropdown 순서 변경 — 신규 RTL 테스트는 dropdown order
의존 안 함 (`getByRole("option", { name })`).

---

### D-23: `$in: []` / `$nin: []` 빈 array clause 자동 drop

**문제**: 사용자가 `$in` 선택 후 value 입력 비움 또는 `", , "` 같은
공백만 입력. `coerceArray` 가 빈 `[]` 반환. `{ field: { $in: [] } }`
는 Mongo 에서 항상 매칭 0건 — 거의 항상 사용자 실수.

**결정**: `buildOperatorClause` 가 빈 array 일 때 `null` 반환 →
`buildMqlFilter` 가 해당 condition 통째로 skip. 결과적으로 row 가
no-op 으로 degrade.

**근거**:
1. `$in: []` 은 합법적 의도가 거의 없음 (전체 결과 제거 의도라면 사용자가
   다른 더 명확한 방식 사용).
2. 다른 op (`$eq: ""`, `$exists: false`) 은 자연스러운 의미가 있어 emit
   유지. `$in: []` 는 그렇지 않음.
3. row 가 silent zero 대신 no-op 으로 degrade → 사용자가 다른 row 의
   결과를 정상 관찰 가능.

**대안**: 빈 array 그대로 emit (사용자 책임), 또는 row 자체에 inline
warning 표시. 후자는 layout 변경 + RDB parity 깨짐. 본 결정은 silent
& safe.

**영향**: `mqlFilterBuilder.test.ts` 에 "skips a $in clause when input
parses to an empty array" case 2건 추가.

---

### D-24: `$in` / `$nin` placeholder hint = CSV 예시 (`"1, 2, 3"`)

**문제**: row 의 value input 은 모든 op 에 대해 단일 `<Input>`. 사용자가
`$in` 선택했을 때 array 형태로 입력해야 한다는 신호 필요.

**결정**: operator 가 `$in` / `$nin` 일 때 placeholder = `"1, 2, 3"`.
`$exists` 의 `"true / false"`, `$regex` 의 `"^pattern"` 과 동일 패턴.

**근거**:
1. placeholder 는 row layout 변경 없이 hint 전달 — RDB parity 유지.
2. CSV 가 결정된 입력 grammar 이므로 (D-Q1) `"1, 2, 3"` 이 즉시
   가르침.
3. operator dropdown 의 `IN` label 이 SQL 사용자에게 의미 전달 +
   placeholder 가 grammar 전달 = 학습 곡선 최소화.

**대안**: chip / token UI (입력 시각화 강화, 그러나 row 구조 변경),
별도 multi-value modal (오버킬). placeholder 가 마찰 최소화 옵션.

**영향**: `placeholderFor()` 헬퍼 함수 추가. `$regex` placeholder 도
함께 명시화 (`"^pattern"`) — 기존 generic "Value..." 보다 명확.

---

## Sprint 314 (Slice B.2) — composite ops (`$or` / `$and` / `$not`)

### D-25: `$and` 는 implicit 만 emit (explicit `$and: [...]` 미사용)

**문제**: ALL 모드의 multi-field/multi-row 결과를 implicit (`{ age:
..., name: ... }`) 와 explicit (`$and: [{ age: ... }, { name: ... }]`)
중 무엇으로 emit 할지 결정 필요.

**결정**: implicit 만 emit. `buildMqlFilter` 는 ALL 모드에서 flat
object 를 만든다. explicit `$and` wrap 은 코드 경로에 존재하지 않음.

**근거**:
1. Mongo 가 두 표현을 동등 처리 — 결과 집합 동일.
2. implicit object 가 훨씬 짧음 — Raw MQL prefill 시 가독성, 콘솔
   debug 시 가독성.
3. nested grouping (`(A AND B) OR (C AND D)`) 같은 시나리오는 본
   sprint scope 밖 (Raw MQL).
4. 같은 field 의 multiple ops (`age $gte 18` + `age $lt 65`) 도
   `{ age: { $gte: 18, $lt: 65 } }` 로 merge → object 가 자연.

**대안**: explicit `$and` (Mongo official docs 의 한 예시 — 같은
field 에 같은 op 두 번 쓸 때 필요). 본 sprint 의 UI 는 그런 입력을
생성하지 못함 (operator merge 가 sole-key 보존).

**영향**: `buildMqlFilter` 의 ALL branch = 기존 동작 (B.1 까지)
유지. test 에 "does not emit explicit $and even for many same-field
rows" assertion 추가.

---

### D-26: ANY 모드 single-element collapse — `{ $or: [single] }` → `single`

**문제**: matchMode="any" + 1 row 만 있을 때 결과를 `{ $or: [...] }`
로 wrap 할지 `single` 그대로 둘지.

**결정**: 1 element 일 때 array wrap 생략 — inner clause 그대로
return. 2+ element 일 때만 `$or` array 생성.

**근거**:
1. `$or: [single]` 과 `single` 는 Mongo 결과 동일.
2. shorter object → Raw prefill / log 가독성.
3. 사용자가 ANY 모드로 toggle 한 후 row 1개만 남기는 시나리오에서
   visual noise 감소.

**대안**: 항상 array wrap (consistent shape). 그러나 빈 `[]` /
single `[X]` 모두 의미 없는 wrap — Lean shape 채택.

**영향**: `mqlFilterBuilder.test.ts` 의 "collapses a single-row
matchMode='any' to the inner clause" case 가 lock.

---

### D-27: per-row `$not` toggle — operator wrap (not standalone op)

**문제**: `$not` 을 (a) `MqlOperator` union 에 추가하여 row 의 op
선택지로 노출 vs (b) `MqlCondition.negate` boolean 으로 wrap 옵션.

**결정**: (b). `negate?: boolean` 필드 + `wrapNot` 헬퍼.

**근거**:
1. `$not` 은 standalone op 가 아니라 다른 op 를 wrap — Mongo 문법
   상 `{ field: { $not: { $gt: 18 } } }` 형태로 항상 다른 op 가
   안에 들어가야 함.
2. `MqlOperator` union 에 `$not` 을 추가하면 사용자가 value 만
   입력하고 inner op 없이 row 가 invalid 상태가 됨.
3. row UX 는 "op + value" 가 메인, NOT 은 modifier — 별도 toggle
   button 으로 표현하는 게 mental model 정합.
4. `$exists` / `$regex` 등 모든 field-level op 와 자유 조합 가능.

**대안**: standalone `$not` op + nested sub-row UI (a more advanced
nested editor). overkill — flat row 모델이 충분.

**영향**: `MqlOperator` union 크기 유지 (10). `MqlCondition` 에
optional 필드 1 개 추가. RTL test 에서 `aria-pressed` 단언.

---

### D-28: NOT button 위치 = operator dropdown 좌측 prefix

**문제**: row 의 NOT toggle 을 어디에 둘지 — operator 좌 / operator
우 / value input 우 / 별도 prefix column / 별도 prefix row.

**결정**: operator dropdown 좌측 prefix button (`<Ban>` icon, amber
when active).

**근거**:
1. 사용자가 operator 결정 전 NOT 결정 → 자연스러운 좌→우 흐름.
2. 좌 prefix 는 row 의 시작 시각 anchor — active NOT 가 즉시 보임.
3. value input 우는 remove 버튼과 충돌 + row 끝이 시각 종료
   anchor 라 modifier 두기 부적합.
4. 별도 prefix column 은 RDB FilterBar parity 깨짐 (RDB 는 column
   structure 4 단). NOT 만 column 추가는 oversized.

**대안**: 모든 row 좌측에 한 칸 추가 — RDB parity 손상. 별도 row
prefix — 작은 modifier 에 row layout 오버킬. icon-xs button 이
minimal & accessible.

**영향**: `StructuredRow` 의 첫 번째 element 다음에 `<Button>` 삽입.
`aria-label="Negate filter"`, `aria-pressed="true|false"`. RTL 이
`aria-pressed` 단언으로 lock.

---

## Sprint 315 (Slice C.1) — Mongo DataGrid multi-column sort wire-up

### D-29: sort state 는 local `useState`, workspaceStore 미사용

**문제**: Mongo collection tab 의 sort 를 (a) workspaceStore.tab.sorts
(RDB 와 동일) 또는 (b) DocumentDataGrid local `useState` 중 어디에
둘지.

**결정**: (b) local `useState<SortInfo[]>([])`. Slice C.1 단계에선
collection tab 의 store 모델 확장 없이 sort mechanic 만 lock.

**근거**:
1. workspaceStore 의 `tab.sorts` 는 RDB table tab 의 `type: "table"`
   에 결합되어 있음. Mongo collection tab 의 type 정합 작업이
   필요 — 별 sub-sprint 의 모델 변경 수반.
2. 사용자가 collection tab 닫고 다시 열면 sort 초기화 — 합리적
   default. cross-session persist 는 Slice D (hide column) 와 같은
   per-collection persist 작업 묶음에 흡수 가능.
3. blast radius 최소화. C.2 (context menu) 까지 끝낸 뒤 store
   통합 가치 재평가.

**대안**: workspaceStore 직접 확장 — Mongo tab 의 `sorts` 필드 추가
+ updateTabSorts 의 paradigm 분기. 두 paradigm 통합 좋은 시그널이나
Slice C.1 의 단일 task 범위에 안 들어감.

**영향**: collection tab 닫고 다시 열면 sort 리셋. 단 한 세션 내
sort 유지 (re-render 영향 없음).

---

### D-30: HeaderRow 컴포넌트 재사용 (Mongo 전용 헤더 신설 안 함)

**문제**: DocumentDataGrid 의 inline header div 를 (a) 직접 sort 로직
추가 / (b) Mongo 전용 헤더 컴포넌트 신설 / (c) RDB 의 `HeaderRow` 재사용
중 무엇으로 처리.

**결정**: (c) `HeaderRow` 재사용. `data: TableData`, `order: number[]`,
`sorts: SortInfo[]`, `editingCell`, `onSort`, `onSaveCurrentEdit`,
`onResizeStart` 만 prop 으로 받는 paradigm-agnostic shape 임이 확인됨.

**근거**:
1. 이미 paradigm-agnostic — `TableData` 는 RDB/Mongo 공통 표면이고
   `SortInfo` 도 그렇다.
2. RDB↔Mongo 의 sort UX (▲/▼ + rank, drag-threshold 4px) 완벽 일치
   보장.
3. 향후 sort 의 polish (rank 표시 변경, accessibility) 가 한 곳에서.
4. DocumentDataGrid 의 inline 헤더 코드 ~30 line 제거.

**대안**: inline 추가는 RDB 변경과 어긋남 lockstep 불가능. Mongo
전용 헤더는 paradigm parity 의 핵심을 깨뜨림.

**영향**: `HeaderRow` 미수정. DocumentDataGrid 가 import 추가.
column reorder 미지원 — `order` 는 identity `[0..n-1]` (RDB 도 동일).

---

### D-31: executed_query history 텍스트가 sort 반영

**문제**: history 의 user-readable string 이 항상
`db.coll.find({}).skip(...).limit(...)` 였다. sort 가 적용됐는데
history 는 그걸 모름.

**결정**: `mongoSort` 가 있으면 `.sort({...})` chain 삽입. mongo
shell syntax (`{ field: 1 }`).

**근거**:
1. history 행은 사용자 reproducibility 의 핵심 — 실행된 query 를
   그대로 보여줘야 신뢰.
2. mongosh chain 형식 (`.sort({...})`) 이 mongosh editor (Slice A)
   와 일치 — 사용자가 history → editor 로 붙여넣어 재실행 가능.
3. `JSON.stringify` 는 cell-domain lint 룰이 차단 → 수동 `Object
   .entries(...).join(", ")` 으로 spell. mongoSort 의 값이 `1 | -1`
   고정이라 안전.

**대안**: history 미반영 (사용자 가시성 손실), `safeStringifyCell`
재사용 (BigInt/Decimal 가 아니라 overkill).

**영향**: `useDocumentGridData` 의 `executed_query` template 에 sort
chain 삽입. 기존 history snapshot 호환 (sort 없으면 빈 chain).

---

## Sprint 316 (Slice C.2 — Slice C FINAL) — Column header context menu

### D-32: "Sort ASC" = 명시적 override (toggle 아님)

**문제**: Context menu 의 "Sort ASC" 가 (a) 현재 sort 와 무관하게 ASC
override vs (b) toggle (이미 ASC면 no-op or DESC).

**결정**: (a) override. 현재 sort 가 어떤 상태든 클릭한 column 만
ASC single-key 로 set.

**근거**:
1. Context menu 는 **명시적** intent. user 가 "Sort ASC" 를 누른 건
   "ASC 로 정렬해" 의 직설적 요청.
2. toggle 은 plain click 으로 이미 제공 (Sprint 315 의 `handleSort`).
   context menu 가 동일 동작 또 노출하면 redundancy.
3. 사용자가 multi-key 후에 "Sort ASC" 누르면 → single-key reset. 이게
   "이 column 만 정렬해" intent 와 정합.

**대안**: toggle (이미 ASC 면 DESC) — context menu 안의 모든 item 이
다른 효과를 줘야 sense make. 하지만 5+1 item 분리 (ASC / DESC /
Add ASC / Add DESC / Clear col / Clear all) 가 더 좋은 UX.

**영향**: `handleSortColumn(col, "ASC", append=false)` 가 무조건 `[{
col, ASC }]` 로 set. `append=true` 분기에서만 push.

---

### D-33: HeaderRow 가 paradigm-shared, context menu 는 한 곳에서

**문제**: RDB DataGrid 와 Mongo DocumentDataGrid 가 각자 context menu
를 구현하면 6 item × 2 grid = 12 callsite. 변경 비용 + 회귀 면적
양극화.

**결정**: `HeaderRow` 가 context menu 를 mount. callback 3개를
optional prop 으로 받는다. 두 grid 가 각자 helper 작성하여 prop 으로
전달.

**근거**:
1. `HeaderRow` 는 이미 paradigm-shared (Sprint 315 D-30). context
   menu 추가도 자연.
2. callback shape (`onSortColumn` / `onClearColumnSort` /
   `onClearAllSorts`) 가 paradigm 분기 없음.
3. 6 item 의 UX (label, separator, disabled 상태) 가 한 곳에 모임 →
   향후 polish 시 한 곳만 변경.
4. callback 셋 모두 optional — HeaderRow 의 다른 caller (test 등) 가
   회귀 없음.

**대안**: 각 grid 가 자기 context menu — 중복 코드 + UX divergence
위험. HeaderRow 의 단일 책임 위반.

**영향**: DataGridTable 의 prop forwarding 추가 (RDB 경로). RDB
DataGrid + DocumentDataGrid 의 callback helper 3개씩. test 는
HeaderRow 단위 RTL (paradigm-agnostic verify).

---

### D-34: disabled state — sort 안 된 column 의 "Clear column" + 빈 sorts 의 "Clear all"

**문제**: context menu 의 "Clear sort for this column" 이 sort 안 된
column 에서 클릭되면 no-op. "Clear all sorts" 도 sorts 가 빈 상태면
의미 없음. visual feedback 부재 → 사용자 혼란.

**결정**: 각 item 에 `disabled` 조건:
- "Clear sort for this column" → `!isSorted` 일 때 disabled.
- "Clear all sorts" → `sorts.length === 0` 일 때 disabled.

**근거**:
1. disabled 가 Radix `data-disabled` 속성으로 자연 표현 → CSS 가
   opacity 50% 처리 (`data-[disabled]:opacity-50`).
2. 사용자가 클릭해도 callback 호출 안 됨 — bug 가능성 차단.
3. 의미 없는 액션을 click 했을 때 grid 가 아무 반응 없으면 사용자가
   "버그?" 의문. disabled 가 "할 게 없다" 신호.

**대안**: 항상 enabled (callback 이 no-op 처리) — UX feedback 부재.
또는 item 자체 hide — UX inconsistency (어떤 때는 보이고 어떤 때는
안 보임).

**영향**: RTL 의 "Clear sort for this column is disabled when the
column is not sorted" + "Clear all sorts is disabled when sorts is
empty" 2 case 가 lock.

---

## Sprint 317 — Slice D.1 (Mongo hide column) — 자율 결정 dict

### D-35: persist 단위 = `document:<db>:<coll>` (column-widths 와 namespace 공유)

**문제**: hide column 상태를 어느 단위로 persist 할지. workspaceStore
의 활성 connection 단위? collection 단위? schema 단위? sprint-265
이후 documentStore 의 캐시도 `(connId, db, collection)` 단위로 분리됨.

**결정**: localStorage key = `hidden-columns:document:<db>:<coll>`.
즉, `useColumnWidths` 의 persist namespace (`document:<db>:<coll>`) 와
동일한 키 공간을 공유. 단순 prefix 만 다름 (`column-widths:` vs
`hidden-columns:`).

**근거**:
1. column width 와 hide 는 동일한 사용자 의도 — "이 collection 에서
   이 column 을 어떻게 보고 싶다" — 한 묶음으로 라이프사이클 관리.
2. workspace 가 바뀌어도 같은 collection 으로 돌아오면 hide 상태
   유지 (column-widths 와 동일 정책).
3. workspaceStore 가 아니라 hook-local state + localStorage 로
   격리해 sprint-262 의 workspaceStore migration 종료 이후 추가
   migration 부담 0.

**대안**:
- workspaceStore `documentTab.hiddenColumns` 필드 → migration 비용,
  cross-window 비호환.
- session-only (메모리) → 페이지 reload 마다 다시 hide 작업 필요.
- per-database (`document:<db>` 만) → 다른 collection 에 영향, UX
  의도 어긋남.

**영향**: `useHiddenColumns.ts` 의 STORAGE_PREFIX = `hidden-columns:`,
DocumentDataGrid 가 `useColumnWidths` 와 동일 `persistenceKey`
재사용. `DocumentDataGrid.hide.test.tsx` 의 5번 case (mount-load
회귀) 가 이 키 형식을 lock.

---

### D-36: hidden columns 배지 위치 = Toolbar 와 grid 사이 inline strip

**문제**: column 이 hide 되면 사용자가 (a) "지금 몇 개가 숨어있는가"
(b) "어떻게 복원하는가" 를 인지할 수단 필요. 배치 위치 선택:
toolbar 안의 chip? grid header 위 separate strip? floating button?

**결정**: DataGridToolbar 와 grid container 사이의 inline strip.
좌측에 `"N column(s) hidden"`, 우측에 ghost variant "Show all" button.
배경은 `bg-muted/40`, 텍스트 `text-xs`, 1.5px padding.

**근거**:
1. DataGridFilterBar / filterCount 와 시각적 일관성 — 둘 다
   "현재 grid 상태에 대한 modifier" 카테고리. 동일 위치에 등장.
2. Toolbar 안에 chip 추가 시 toolbar 가 비좁아짐 (현재 7+ icon
   button 이 우측에 있음).
3. floating button 은 grid 위에 떠 row 가려서 NO.
4. hidden columns 가 0 개일 때는 strip 자체를 unmount → DOM
   부담 0.

**대안**:
- toolbar 내부 chip (Filters 옆) — 공간 부족.
- grid header 위 좌측 inline link — header sticky 와 layering 충돌.

**영향**: `aria-label="Hidden columns badge"` 로 RTL 가 strip 의
존재/부재를 단언. "Show all hidden columns" aria-label 의 button
이 wipe action.

---

### D-37: Show all = 전체 clear + localStorage 도 clear (per-column show 는 별도 슬라이스)

**문제**: 배지의 우측 액션을 어떤 의미로 만들지. 모든 hidden column
을 한 번에 복원? 아니면 hidden column 리스트 popover 에서 개별
복원?

**결정**: 단일 "Show all" 액션. 클릭 시 `hiddenColumns.clear()` →
in-memory + localStorage entry 둘 다 wipe. 개별 복원 UI 는 Slice D
의 추가 sub-sprint 또는 Slice H (field projection dialog) 로 연기.

**근거**:
1. Slice D.1 의 scope 는 "hide column" 본체 + 회복 lifeline. lifeline
   은 "한 번에 다 복원" 하나로도 회복 가능 — 안전망 1개면 충분.
2. per-column show 는 popover/listbox UI 가 필요 — 별도 디자인
   결정 + 테스트 부담. Slice D.1 의 blast radius 를 좁힘.
3. 사용자 use case: hide 는 "이 column 한두 개 안 보고 싶음", 복원은
   "다시 전부 보기" 가 압도적으로 흔함 (TablePlus / DataGrip 도
   동일 정책).
4. localStorage 도 clear — 다음 mount 때 부활하면 사용자 의도와
   충돌.

**대안**:
- 배지 클릭 → popover 안에 column list + per-row show button →
  Slice D.1 scope 초과.
- "Show all" 만 두고 localStorage 는 보존 → unmount/remount 시 hide
  부활 → 사용자가 또 Show all 눌러야. NO.

**영향**: RTL "Show all clears every hidden column and removes the
badge" + localStorage entry null assertion 으로 lock.

---

### D-38: "전부 hide" 가드레일 없음 — column 0개 visible 허용

**문제**: 사용자가 모든 column 을 hide 하면 grid 가 빈 column space
가 됨. 가드레일 (마지막 column 은 hide 못 함) 둘지?

**결정**: 가드레일 없음. 0 column visible 도 허용. 단, badge 가
계속 표시되어 "Show all" 로 즉시 복원 가능.

**근거**:
1. 가드레일은 implicit "이 column 만은 못 숨김" rule → 사용자가
   왜 disabled 인지 추측해야. UX 복잡도 증가.
2. 회복 affordance ("Show all") 가 항상 visible 하니 막다른 골목
   아님.
3. row 가 0 col 로 rendered 되어도 aria-rowcount 는 정상, "No
   documents" 빈상태는 row 0 일 때 별도 처리 (기존 로직).

**대안**:
- 마지막 column hide 시 disabled 처리 → 어떤 column 이 "마지막"
  인지 모호 (visible order 의 마지막? 원본 order 의 마지막?).
- toast "최소 1개 column 이 보여야 합니다" → 사용자 행동 막힘.

**영향**: HeaderRow 의 ContextMenu "Hide column" item 은 항상 enabled.
guard 코드 부재. RTL 의 "Show all" 5번째 case 가 0-column 복원
회귀를 lock 하진 않지만, 후속 슬라이스 (D.2 RDB) 에서 동일 정책
적용 가능.

---

## Sprint 318 — Slice D.2 (RDB DataGrid hide column) — 자율 결정 dict

### D-39: RDB hide column persist 단위 = `hidden-columns:rdb:<schema>:<table>`

**문제**: Mongo D.1 의 persist namespace 가 `document:<db>:<coll>`.
RDB 도 schema.table 단위로 분리할지, server-only / connection-only
로 묶을지.

**결정**: `rdb:<schema>:<table>` (즉, `hidden-columns:rdb:<schema>:<table>`).
`useColumnWidths` 의 RDB 측 key 와 namespace 공유.

**근거**:
1. column widths 와 동일한 lifecycle — schema 가 같아도 table 마다
   다른 column 구성을 가질 수 있고, 사용자가 "이 테이블에서 이 column
   만 안 보고 싶다" 가 가장 흔한 use case.
2. Mongo D.1 의 결정 (D-35) 과 paradigm parity. paradigm prefix
   (`rdb:` vs `document:`) 가 어휘 충돌 차단.
3. workspaceStore migration 0 — 그 store 와 무관하게 hook 단독 persist.

**대안**:
- per-schema (`rdb:<schema>`) — 다른 table 에 영향.
- per-connection — 너무 거친 단위.
- workspaceStore.tab.hiddenColumns — migration 비용.

**영향**: `useHiddenColumns('rdb:${schema}:${table}')` 호출. RDB
`DataGrid.hide.test.tsx` 의 "persists ..." case 가 이 key 형식을 lock.

---

### D-40: DataGridTable 가 visible filter 책임 (RDB DataGrid 는 prop 만 전달)

**문제**: hide 의 visible-column filter 를 어디에 둘지. paradigm-shared
`DataGridTable` 안? RDB caller 안에서 columnOrder 를 거른 뒤 전달?

**결정**: `DataGridTable` 안에 `hiddenColumnNames` prop + `order =
baseOrder.filter(!hidden)` 도입. 모든 down-stream (HeaderRow, DataRow,
pendingNewRows, aria-colcount, --cols template) 가 이 단일 `order`
를 소비.

**근거**:
1. `DataGridTable` 가 이미 `useColumnWidths` 를 자기 안에서 호출 —
   width 와 hide 가 paradigm-shared shell 의 책임. caller 가 한 번 더
   filter 하면 책임 분산 → 회귀 위험 증가.
2. RDB caller 는 hook 호출 + 배지 + prop 전달만. Mongo `DocumentDataGrid`
   는 HeaderRow / row map 을 자체 inline 하므로 caller 차원에서 filter
   (현재 구조).
3. `useMemo([baseOrder, hiddenColumnNames, data.columns])` 로 identity
   안정성 보장 → virtualizer 의 `count` / `rowCtx` deps churn 없음.

**대안**:
- caller-level filter — 책임 분산, 회귀 위험.
- HeaderRow 와 DataRow 가 각자 받음 — 두 곳 동기화 부담.

**영향**: `DataGridTable.tsx` 의 `order` 가 hidden 적용된 `visibleOrder`.
`DataGridTable.hide.test.tsx` 6 case 가 header / row / pendingNewRows /
aria-colcount / --cols / no-callback fallback 모두 lock.

---

### D-41: 배지 마크업은 Mongo 와 1:1 — paradigm 간 UX uniformity

**문제**: RDB 배지 strip 의 마크업·라벨·a11y 를 Mongo 와 다르게
디자인할지? 예: "row hidden" 어휘, 다른 위치.

**결정**: Mongo `DocumentDataGrid` 의 strip 을 그대로 복제.
`aria-label="Hidden columns badge"`, "1 column hidden" / "N columns
hidden" 어휘, ghost variant `Show all hidden columns` 버튼.

**근거**:
1. 한 paradigm 에서 한 번 익힌 UX 가 다른 paradigm 에서도 즉시 인식
   가능 → 학습 비용 0.
2. RTL 의 `screen.findByLabelText("Hidden columns badge")` selector
   가 paradigm 간 일치 → 미래의 paradigm-shared component refactor
   여지.
3. 어휘 "row" 대신 "column" 은 RDB 에서도 정확. "columns" 라는 단어
   가 paradigm-neutral.

**대안**:
- 토스트로 노출 → 영구 visible 한 affordance 필요 (회복 lifeline).
- toolbar 안 chip → 좁음 (이미 7+ icon button).

**영향**: RDB `DataGrid.tsx` 의 strip JSX 가 Mongo 와 동일. RTL
"Show all" + "1 column hidden" + "2 columns hidden" 라벨 셋 모두 lock.

---

### D-42: hidden 미제공 caller (기존 RDB grid 테스트) 회귀 0 — prop 둘 다 optional

**문제**: `DataGridTable` 의 신규 prop 두 개를 required 로 만들면
기존 caller (test setup 포함) 모두 수정 필요. blast radius 증가.

**결정**: `hiddenColumnNames?` + `onHideColumn?` 둘 다 optional.
- 미제공 시 `order = baseOrder` (필터 미적용).
- HeaderRow 는 `onHideColumn` 미제공 시 "Hide column" item 미렌더
  (sprint 317 의 HeaderRow 기 결정 D-32).

**근거**:
1. `DataGridTable.column-sort.test.tsx`, `DataGridTable.aria-grid.test.tsx`
   등 기존 11 axis test 가 hide 무관 — required 로 만들면 모두 수정.
2. Mongo `DocumentDataGrid` 는 `DataGridTable` 미사용 (자체 inline) —
   prop 강제 의미 없음.
3. ad-hoc 사용 (query result grid 등) 도 hide 가 필요 없는 경우 prop
   생략 가능.

**대안**:
- required 로 강제 + 기본값 — defensive 하지만 caller 수정 폭증.
- 별도 `DataGridTableWithHide` wrapper — 책임 분기 의미 없음 (filter
  로직이 동일).

**영향**: 기존 11 DataGridTable axis test 모두 수정 0. 신규
`DataGridTable.hide.test.tsx` 가 미제공 case 를 명시적으로 단언
("renders every column when hiddenColumnNames is not provided").

---

## Sprint 319 — Slice E.1 (Document schema accumulator hook) — 자율 결정 dict

### D-43: 누적 단위 = `(connId, db, collection)` triple — sprint 265 cache 패턴 정합

**문제**: schemaless accumulator 가 무슨 단위로 격리될지. db 단위?
collection 단위? connection 단위?

**결정**: `(connId, db, collection)` triple. hook 의 `key` prop 으로
받고, 그 stringified spelling 이 useEffect dep → 변경시 auto-reset.

**근거**:
1. sprint-265 의 documentStore cache 가 이미 동일 triple 단위. UI
   상태 (hidden columns, accumulator) 도 같은 결 단위로 유지하면
   사용자 멘탈 모델 일치.
2. 다른 collection 으로 navigate 시 field 가 leak 되면 grid 가
   "다른 collection 의 잔재" 를 보여줘 혼란.
3. server / db 단위는 너무 거침 — 같은 db 안 다른 collection 은
   완전 별개 schema.

**대안**:
- 컴포넌트별 fresh state — 누적 의미 상실 (페이지 이동마다 column
  깜빡).
- localStorage persist — schemaless 흔들림이 영구화. UX overshoot.

**영향**: hook signature `useDocumentSchemaAccumulator(key?: {connId,
db, collection})`. test 의 "auto-resets when the (connId, db,
collection) triple changes" case 가 lock.

---

### D-44: 정렬 = `_id` first + 그 외 case-insensitive alphabetical

**문제**: 누적된 field 의 column order 를 어떻게 정할지. 발견순?
random? 알파벳? `_id` 따로?

**결정**: `_id` 항상 first. 그 외는 case-insensitive 알파벳
(localeCompare).

**근거**:
1. `_id` 는 Mongo 의 universal PK — RDB grid 에서 PK 가 left 첫
   column 인 관습 정합.
2. 발견순은 random — 사용자가 페이지 넘기는 순서에 의존. 같은
   collection 도 다른 세션에선 다른 order. 예측 불가.
3. case-insensitive 알파벳은 `name` / `Name` / `NAME` 의 인접
   grouping 보장 — 같은 의미의 field 가 흩어지지 않음.

**대안**:
- 발견순 보존 — 예측 불가.
- case-sensitive 알파벳 — `Z*` 가 `a*` 보다 먼저. 사용자 직관과 불일치.
- backend 가 정한 순서 따라가기 — 페이지 마다 다른 순서 가능 (BFS).

**영향**: hook 의 `sortColumns()` 가 두 단계 정렬. test 의 "orders
`_id` first, then case-insensitive alphabetical" + "preserves
existing fields..." 가 lock.

---

### D-45: type 충돌 = first-wins (subsequent type 무시)

**문제**: 같은 field 가 page A 에선 int, page B 에선 string 으로
inferred 될 수 있음 (schemaless). type 표시를 어떻게 할지.

**결정**: 최초 발견된 type 만 유지. 후속 호출의 다른 type 은 무시.

**근거**:
1. heuristic 단순 + 예측 가능. "mixed" 표기는 grid 표현 복잡도
   증가 (지금은 column header 가 단일 type subtitle 만 출력).
2. 실제 use case 의 압도적 다수는 단일 type. "mixed" 가 정말
   필요한 경우는 Slice G (BSON type editor) 또는 후속 explain
   pane 의 책임.
3. 사용자가 cell 값 보면 실제 type 즉시 확인 가능. column-level
   type 은 hint 일 뿐.

**대안**:
- 마지막 본 type 으로 overwrite → flicker.
- "mixed" 라벨 → grid 표시 복잡도 + i18n 추가.
- type histogram → over-engineering.

**영향**: hook 의 `seen.has(name)` 체크가 first-wins 보장. test 의
"keeps the first-seen type for a given field (first-wins)" 가 lock.

---

### D-46: in-memory only — persist 미적용

**문제**: hidden columns 처럼 localStorage 에 persist 할지.

**결정**: in-memory only. 페이지 reload 시 reset 허용.

**근거**:
1. accumulator 는 fetch 마다 자동 채워짐 (페이지 1만 fetch 해도
   대부분의 field 가 등장). reload 후 첫 fetch 에 다시 누적 시작.
2. persist 하면 stale schema 가 새 collection 변경 / TTL 미반영
   문제 발생. 누적 schema 가 outdated 되어도 사용자 알아차리기
   어려움.
3. hidden columns 와 다른 의미 — hide 는 명시적 사용자 선택, accumulator
   는 자동 학습. 자동 학습 결과를 persist 하면 사용자가 통제 못 함.

**대안**:
- sessionStorage — 페이지 reload 마다 reset 되어 의미 약함.
- IndexedDB — over-engineering.

**영향**: hook 에 localStorage 코드 0. test 의 "auto-resets when
triple changes" 가 leak 방지 단언.

---

## Sprint 320 — Slice E.2 (DocumentDataGrid schema accumulator wire-up) — 자율 결정 dict

### D-47: accumulator merge 시점 = `queryResult.columns` 변경 useEffect

**문제**: backend 의 fetch 결과를 accumulator 에 넘길 트리거를 어디
둘지. `fetchData` 끝에서 merge 호출? `queryResult` 변경 useEffect?

**결정**: `queryResult?.columns` 를 deps 로 한 useEffect 에서
`schemaAccumulator.merge(queryResult.columns)` 호출.

**근거**:
1. `queryResult` 는 documentStore 의 reactive cache (sprint-265
   path: `(connId, db, coll)`). store 외부에서 다른 surface 가 같은
   collection 을 fetch 해도 (예: 다른 grid 마운트) cache 가 갱신될
   수 있음. useEffect 가 reactively 따라가서 accumulator 가 모든
   reactive 변경에 반응.
2. `fetchData` 안에서 호출 하면 stale-guard race 와 결합 — fetchId
   다시 검사해야 함. useEffect path 가 stale 감안 불필요 (zustand
   selector 가 최종 상태만 surface).
3. eslint `react-hooks/exhaustive-deps` 는 `schemaAccumulator.merge`
   도 dep 추가 요구. 그러나 merge 는 ref 기반 stable callback —
   `// eslint-disable-next-line` 으로 deps 명시 (D-48 과 함께 정당화).

**대안**:
- fetchData 안에서 직접 merge — stale race 와 결합, 회귀 표면 증가.
- documentStore 내부에서 자동 merge — 다른 grid (예: 짧은 ad-hoc
  query) 와 결합. 분리 유지.

**영향**: useEffect 1줄. test "accumulates new fields across pages"
가 lock.

---

### D-48: accumulator 빈 상태 = backend columns fallback (flicker 방지)

**문제**: accumulator 가 비어 있을 때 (첫 fetch 이전 한 frame, 혹은
collection 직후) grid 가 빈 columns 로 잠시 렌더되면 flicker.

**결정**: `schemaAccumulator.columns.length === 0` 이면 backend `data`
를 그대로 surface. accumulator merge useEffect 가 다음 cycle 에
호출되어 누적되면 그때부터 accumulator-driven render.

**근거**:
1. accumulator 는 누적 의도. 첫 fetch 직후엔 backend columns 와 100%
   일치 — fallback 이 사용자 경험에 차이 0.
2. flicker (빈 grid → backend columns → accumulator columns) 가 한
   frame 이라도 보이면 산만. fallback 이 첫 frame 부터 의미 있는
   columns 를 표시.
3. backend 가 0 column 을 반환하면 그대로 빈 grid — 그건 backend
   의도 그대로 보존 (rows 0 인 empty collection).

**대안**:
- `schemaAccumulator.merge(...)` 를 first render 에 동기 호출 — render
  중 set state → React warn. NO.
- useLayoutEffect 로 merge — same 문제 + render race.
- 빈 grid 노출 — UX overshoot.

**영향**: `data` memo 의 `if (schemaAccumulator.columns.length === 0)
return backendData` 분기. test "renders the columns from the first
fetch alphabetically" 가 fallback path 의 결과를 lock (첫 페이지에선
backend columns == accumulator columns 라 visually identical).

---

### D-49: row 의 missing field cell = null (기존 NULL chip 재사용)

**문제**: accumulator 가 보유한 field 가 현재 page backend columns 에
없을 때, row 의 해당 cell 을 어떻게 표시할지.

**결정**: cell value 를 `null` 로 채워 grid 의 기존 NULL chip 로직
(`<span className="italic text-muted-foreground">null</span>`) 재사용.

**근거**:
1. Document paradigm 에서 schema 상 "이 field 가 이 document 에 없음"
   과 "field 는 있지만 값이 null" 은 의미가 다름. 단, grid 시각화
   레벨에서는 둘 다 "값이 비어있음" — 사용자가 둘을 구분해야 할 use
   case 가 거의 없음. 통합 표현이 단순.
2. 별도 "absent" chip 디자인은 i18n + a11y 추가 부담. Slice E.2 의
   scope 초과.
3. inline edit 시도 → backend 에서 reject (없는 field 에 update 시
   $set new field 가 됨, 사용자 의도 일치). edit 흐름 변경 0.

**대안**:
- "absent" 라벨 chip → UX 복잡도 + 신규 디자인 결정.
- 빈 cell (visual 아무것도 없음) → 사용자가 빈 cell 의 의미 모름.
- `"undefined"` 문자열 → 데이터 와 표현 혼동.

**영향**: `data` memo 가 `idx === undefined ? null : row[idx]` 로
채움. test "renders 'null' chips for accumulated fields missing in
the current page" 가 NULL chip 의 visible 회귀 가드.

---

### D-50: backend → accumulator column index map = O(1) cell lookup

**문제**: accumulator 의 column 별로 backend rows 의 인덱스를 찾는
순회 cost. row 수 × column 수 곱이면 N×M.

**결정**: `data` memo 안에서 `Map<columnName, backendIdx>` 를 한 번
빌드 후 row map 이 그 map 으로 O(1) lookup.

**근거**:
1. N×M 의 column-name lookup (linear scan per cell) 은 grid 의
   가독성 한계 (수십 columns × 수백 rows) 에서 무시할 정도이지만,
   Map 이 같은 코드 라인 수로 더 명확. 미래의 large schema 도 호환.
2. memo deps `[backendData, schemaAccumulator.columns]` 안에서만 map
   생성 — 페이지 안에서는 map 재사용.

**대안**:
- 순회 linear (`findIndex`) — 작은 grid 에선 OK 지만 의미 없는
  비효율.
- accumulator 가 자체적으로 map 도 expose — hook API 비대.

**영향**: `data` memo 의 6 line. test 의 모든 page-2 row 단언이 cell
의 정확한 값을 단언 (`carol@example.com`, `42`, `high` 등) — index
map 동작 회귀.

---

## Sprint 321 — Slice F.1 (Nested expand popover, read-only) — 자율 결정 dict

### D-51: 1-depth 만 expose, nested-of-nested 는 sentinel 유지

**문제**: nested cell 의 popover 가 임의 깊이까지 재귀 expand 하면
popover 가 폭주. 어디까지 보여줄지.

**결정**: 1-depth 만. nested-of-nested 는 popover 안에서도 sentinel
(`{...}` / `[N items]`) 으로 표시. 깊은 inspect 가 필요하면 Quick
Look 패널 (BSON tree viewer).

**근거**:
1. cell-context inspect 의 목표는 "이 cell 안에 뭐 있나" 의 빠른
   답. 깊은 탐색은 Quick Look 의 책임. 책임 분리.
2. 재귀 expand 는 popover layout 복잡도 폭증 + 키 처리 (Tab 으로
   focus 이동) 부담.
3. Slice F.2 의 edit flow 도 1-depth 만 인라인 edit. 깊은 edit 은
   raw JSON 편집 (Quick Look 또는 Cell Detail dialog).

**대안**:
- 전 depth recursive expansion — popover 폭주.
- "Expand more" 링크로 deeper popover stack — 키 처리 복잡, UX 부담.
- click 시 Quick Look 강제 open — 사용자 cell-local inspect 차단.

**영향**: `getNestedExpansion` 의 `isNested` flag. test "marks
nested-of-nested entries with isNested=true" + integration 의 popover
content "{...}" 표기.

---

### D-52: BSON canonical singleton (`$oid`, `$date`, `$numberLong`) 은 scalar 취급

**문제**: nested object 의 일부 field 는 BSON wrapper (`{ $oid: "..."
}`, `{ $date: "..." }`). 이것을 nested expansion 으로 펼치면
사용자에게 `$oid` 라는 의미 없는 key 가 노출되어 혼란.

**결정**: 단일 key 가 `$` 로 시작하는 object 는 scalar 로 취급.
expansion 의 isNested=false, value 가 그대로 (wrapper 포함) 노출되되
type subtitle 이 `oid` / `date` / `numberLong` 등.

**근거**:
1. Quick Look 의 BSON tree viewer 도 canonical wrapper 를 자동
   unwrap 해 보여줌. UX 일관.
2. 사용자 멘탈 모델: ObjectId / Date 는 "값 그 자체" — composite
   아님.

**대안**:
- raw object 그대로 expand — `$oid` 라벨이 노출, 의미 없음.
- BSON 형 unwrap 후 string 변환 — 데이터 표현 손실 (raw 가 사라짐).

**영향**: `isComposite()` 의 single-`$key` 분기. test "treats
canonical BSON singletons ($oid, $date, $numberLong, ...) as scalars"
가 lock.

---

### D-53: trigger 클릭 stopPropagation — row selection 부작용 차단

**문제**: trigger button 이 row container 안에 있어 click 이 row
의 onClick 으로 propagate → row selection 토글. 사용자가 inspect 만
의도해도 selection 변동.

**결정**: trigger button + popover content 모두 `onClick` 에서
`e.stopPropagation()`. inline `onDoubleClick` 도 stopPropagation
(편집 흐름과 충돌 차단).

**근거**:
1. inspect 와 selection 은 독립적 인터랙션. 두 의도가 한 클릭에
   합쳐지면 UX 혼동.
2. Radix Popover 자체는 stopPropagation 안 함 — caller 책임.
3. test 로 회귀 가드 (component 단위 + grid 통합 2 단).

**대안**:
- 사용자가 Cmd+click 으로만 popover — 발견성 낮음.
- inspect 가 row selection 까지 같이 → 두 의도 결합, 회귀 표면 증가.

**영향**: component "stops the click event from propagating to the
row container" + grid integration "trigger click does not toggle
row selection" 2 case 가 lock.

---

### D-54: sentinel cell 의 표시 = sentinel 문자열 + trigger (옆 mount)

**문제**: cell 의 시각 표현을 어떻게 바꿀지. sentinel 문자열 제거하고
trigger 만? 둘 다 유지?

**결정**: sentinel 문자열 (`{...}` / `[N items]`) 그대로 + 옆에
ChevronRight 아이콘 trigger. flex layout 으로 두 child.

**근거**:
1. sentinel 문자열은 "이 cell 이 composite 임" + "size hint" (배열 N
   items) 정보 운반. 제거하면 정보 손실.
2. trigger 만 노출하면 cell content 가 너무 sparse, 빈 cell 처럼 보임.
3. 두 child 의 layout = `flex items-center gap-1` 로 단일 row 유지,
   width 폭주 없음.

**대안**:
- trigger 만 (sentinel 제거) — 정보 손실.
- sentinel 문자열을 자체 trigger 로 (별도 button 없음) — sentinel 의
  click 이 기존 selection 동작과 충돌.

**영향**: grid integration test "mounts the expand trigger on
sentinel cells" + 기존 "renders composite sentinels via
isDocumentSentinel with muted italic styling" 회귀 0.

---

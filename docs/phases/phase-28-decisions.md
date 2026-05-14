# Phase 28 + Phase 29 자율 의사결정 로그

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


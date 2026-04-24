# Sprint 73 Handoff — Phase 6 plan E-2 (Frontend Find/Aggregate UI)

## Status: READY FOR EVALUATION

Generator-scope 4 checks 전부 PASS. AC-01 ~ AC-13 전부 증거 확보. Frontend 전체 vitest suite 1389 passed (Sprint 72 baseline 1288 대비 +101). Sprint 74 agent 가 선점한 `src/components/datagrid/**`·`src/components/DataGrid.tsx`·`src/components/DocumentDataGrid*`·`src/components/shared/QuickLookPanel*`·`src/components/shared/BsonTreeViewer*` 경로는 Sprint 73 작업 범위에서 **0 라인 수정** (작업 트리에 이미 존재한 변경물과는 무관).

## Changed Files

| File | Purpose |
|---|---|
| `src/stores/tabStore.ts` | `QueryMode = "sql" \| "find" \| "aggregate"` 타입 export 추가. `QueryTab` 에 `paradigm: Paradigm`, `queryMode: QueryMode`, 옵션 `database?`/`collection?` 필드 추가. `addQueryTab(connectionId, opts?)` 시그니처 확장 — RDB 탭은 `queryMode` 를 강제로 `"sql"`, document 탭은 기본값 `"find"`. 신규 `setQueryMode(tabId, mode)` 액션 (paradigm=rdb 탭에 non-sql 쓰기 거부, 값 같으면 no-op 으로 referential equality 보존). `loadPersistedTabs` 에서 legacy `QueryTab` 를 `paradigm="rdb"` + `queryMode="sql"` 로 migrate. |
| `src/stores/tabStore.test.ts` | Sprint 73 신규 테스트 8개 추가: default paradigm/queryMode, document+aggregate opts 반영, document 기본 find, rdb force-sql normalization, find↔aggregate 토글, rdb 의 setQueryMode 거부, non-existent id no-op, 동일값 referential equality. |
| `src/stores/documentStore.ts` | `runAggregate(connectionId, database, collection, pipeline)` 추가 — `runFind` 동일 stale-guard 패턴. 캐시 key 는 `agg:${connectionId}:${database}:${collection}:${JSON.stringify(pipeline)}` 로 `find` 경로와 prefix 로 분리. 요청 카운터 key 는 `aggregate:${cacheKey}`. `clearConnection` 이 `agg:${connectionId}:` prefix 도 제거하고 `aggregate:agg:${connectionId}:` 카운터도 drop. |
| `src/stores/documentStore.test.ts` | mock `aggregateDocuments` 추가. Sprint 73 신규 테스트 4개: happy path 캐시 검증, stale-guard (slow-wins-last 방지), find/aggregate 캐시 prefix 분리, `clearConnection` 이 aggregate 캐시까지 삭제. |
| `src/lib/tauri.ts` | `aggregateDocuments(connectionId, database, collection, pipeline)` wrapper — `invoke("aggregate_documents", { connectionId, database, collection, pipeline })`. `Promise<DocumentQueryResult>` 반환. 기존 `findDocuments` 불변. |
| `src/types/document.ts` | 신규 타입 `AggregateBody { pipeline: Record<string, unknown>[] }` 추가 (Sprint 80 의 MQL Preview 준비). 기존 `DocumentQueryResult`, `FindBody` 불변. |
| `src/components/query/QueryEditor.tsx` | `paradigm?: Paradigm`·`queryMode?: QueryMode` prop 추가. `Compartment` 를 `langCompartment` 로 개명해 SQL↔JSON 언어 전환 + schemaNamespace 업데이트 양쪽에 재사용. `buildSqlLang`/`buildJsonLang`/`buildLangExtension` 을 모듈 스코프로 이동 (useEffect dependency 안정화). paradigm 전환시 `Compartment.reconfigure` 로 에디터 재마운트 없이 언어 스왑. aria-label 이 paradigm+queryMode 조합에 따라 "SQL Query Editor"/"MongoDB Find Query Editor"/"MongoDB Aggregate Pipeline Editor" 로 바뀜. 컨테이너에 `data-paradigm`·`data-query-mode` 부여. |
| `src/components/query/QueryEditor.test.tsx` | Sprint 73 신규 테스트 5개: rdb default = SQL 언어, document+find = JSON, document+aggregate = JSON, paradigm 전환 시 EditorView 재사용, aria-label 전환. |
| `src/components/query/QueryTab.tsx` | `findDocuments`·`aggregateDocuments`·`QueryMode`·`FindBody` import. Document-paradigm helper (`readDocumentContext`, `isRecord`, `isRecordArray`) 모듈 스코프 추가. `setQueryMode` selector + `isDocument` 파생. `handleExecute` 최상단에 `paradigm === "document"` 분기 삽입: ① db/collection 부재 시 `"Document query tabs require a target database and collection."`, ② `JSON.parse` 실패 시 `"Invalid JSON: ${msg}"`, ③ aggregate → `isRecordArray` 검증 후 `aggregateDocuments`, ④ find → 오브젝트만 허용 (`filter`/`sort`/`projection`/`skip`/`limit` 키 존재 시 FindBody, 아니면 바로 `filter` 로 감쌈). `DocumentQueryResult → QueryResult` 어댑터로 기존 `QueryResultGrid` 재사용 (`query_type: "select"` 합성). stale-guard 는 기존 SQL 경로와 동일하게 `queryId` 비교. 성공/실패 모두 `addHistoryEntry` 로 기록. 툴바: `!isDocument` 에서만 Format 버튼 렌더, `isDocument` 에서 shadcn `<ToggleGroup>` Find/Aggregate 세그먼트 렌더 (클릭 → `setQueryMode`). `format-sql`/`uglify-sql` 이벤트 리스너 초입에 `if (tab.paradigm === "document") return;` 가드. `<QueryEditor>` 에 `paradigm`·`queryMode` 포워딩. |
| `src/components/query/QueryTab.test.tsx` | mock 에 `findDocuments`·`aggregateDocuments` 추가. `makeQueryTab` 팩토리에 `paradigm: "rdb", queryMode: "sql"` 기본값. Sprint 73 신규 테스트 13개 (rdb 회귀 1 + document 12). |
| `src/App.test.tsx`·`src/components/layout/MainArea.test.tsx`·`src/components/schema/SchemaTree.test.tsx` | 기존 `makeQueryTab` 팩토리 / inline QueryTab 객체에 `paradigm: "rdb", queryMode: "sql"` 필드 추가 (TS 2322 해소). |
| `package.json` / `pnpm-lock.yaml` | `@codemirror/lang-json` 추가. |

변경 범위 제약 준수:
- `src-tauri/**`: **Sprint 73 에서 diff 0**. `git diff --stat HEAD -- src-tauri/` → 빈 출력.
- `src/components/datagrid/**`·`src/components/DataGrid.tsx`·`src/components/DocumentDataGrid.tsx`·`src/components/DocumentDataGrid.test.tsx`·`src/components/shared/QuickLookPanel*`·`src/components/shared/BsonTreeViewer*`: **Sprint 73 에서 0 라인 수정**. (작업 트리에 Sprint 75 agent 가 남긴 선행 변경이 존재하지만 이 스프린트와 무관 — 내 편집은 모두 `src/stores/`·`src/lib/tauri.ts`·`src/types/document.ts`·`src/components/query/`·`src/App.test.tsx`·`src/components/layout/MainArea.test.tsx`·`src/components/schema/SchemaTree.test.tsx` 로 국한.)

## Generator-scope Check Results (4개)

### 1. `pnpm tsc --noEmit`
PASS — 0 errors (출력 없음).

### 2. `pnpm lint`
PASS — 0 errors / 0 warnings (ESLint 종료 코드 0).

### 3. `pnpm vitest run src/stores/tabStore.test.ts src/stores/documentStore.test.ts src/components/query/QueryEditor.test.tsx src/components/query/QueryTab.test.tsx`
PASS — 4 files, 119 tests passed. 세부:
- `src/stores/tabStore.test.ts` — 42 passed (Sprint 72 baseline 34 + Sprint 73 신규 8).
- `src/stores/documentStore.test.ts` — 12 passed (Sprint 72 baseline 8 + Sprint 73 신규 4).
- `src/components/query/QueryEditor.test.tsx` — 18 passed (Sprint 72 baseline 13 + Sprint 73 신규 5).
- `src/components/query/QueryTab.test.tsx` — 47 passed (Sprint 72 baseline 34 + Sprint 73 신규 13).

### 4. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
PASS — `Finished dev profile`, 0 warnings / 0 errors. `src-tauri/**` 은 읽기 전용이었으므로 Sprint 72 기준과 동일.

### Orchestrator-scope (reference)

- `pnpm vitest run` (전체 suite) — 72 files, **1389 passed** (Sprint 72 기준 1288 대비 +101). Sprint 73 신규 30개 + 사이드 effect 71 개 (작업 트리 선행 변경의 추가 테스트 포함). 0 실패.
- `cd src-tauri && cargo test --lib` — 검증 생략 (Rust diff 0 이 clippy 로 이미 증명).

## AC → Evidence Mapping

| AC | 증거 |
|---|---|
| AC-01 `QueryTab` 이 `paradigm: Paradigm` + `queryMode: "sql" \| "find" \| "aggregate"` 를 가지고 기본값 rdb/sql | `src/stores/tabStore.ts:54` (`QueryMode` type), `:57-82` (`QueryTab` interface), `:264-294` (`addQueryTab` 기본값 분기). |
| AC-02 `addQueryTab(connectionId)` 후방 호환 + `(connectionId, { paradigm, queryMode })` opts + `setQueryMode` | `src/stores/tabStore.ts:128-139` (types), `:264-294` (구현), `:310-321` (`setQueryMode`). 테스트: `tabStore.test.ts` "addQueryTab without opts defaults..." / "addQueryTab with document + aggregate..." / "setQueryMode toggles..." |
| AC-03 `aggregateDocuments` wrapper + `invoke("aggregate_documents", ...)` + `Promise<DocumentQueryResult>` | `src/lib/tauri.ts` 내 `aggregateDocuments` 정의 (camelCase 키로 invoke). 테스트: `documentStore.test.ts` "runAggregate calls aggregateDocuments with the pipeline..." 가 mock 호출 인자 shape 검증. |
| AC-04 `documentStore::runAggregate` stale-guard | `src/stores/documentStore.ts:162-178`. 테스트: `documentStore.test.ts` "runAggregate stale response does not overwrite a newer response" (slow resolveSlow 가 더 신선한 `total_count=77` 를 덮어쓰지 못함을 검증). |
| AC-05 `QueryEditor` paradigm=document → JSON, rdb → SQL, Compartment reconfigure | `src/components/query/QueryEditor.tsx:46-64` (buildSqlLang/buildJsonLang/buildLangExtension), `:103` (`langCompartment`), `:121-126` (초기 설정), `:216-224` (reconfigure). 테스트: `QueryEditor.test.tsx` "uses the SQL language extension by default" / "swaps to the JSON language when paradigm=document" / "reconfigures the language in-place when paradigm flips (editor survives)" — `viewAfter === viewBefore` 로 재마운트 없음 증명. |
| AC-06 document 탭만 Find/Aggregate 토글 렌더 + 클릭이 `setQueryMode` 호출 | `src/components/query/QueryTab.tsx:587-606` (`isDocument && <ToggleGroup...>`). 테스트: `QueryTab.test.tsx` "renders the Find \| Aggregate toggle only for document paradigm" / "clicking the Aggregate toggle calls setQueryMode and flips tab state". |
| AC-07 `handleExecute` paradigm+queryMode 분기 | `src/components/query/QueryTab.tsx:119-262` (document 블록). rdb 경로는 `:264-418` 로 기존과 동일. 테스트: "rdb paradigm routes handleExecute through executeQuery (regression)" / "document+find calls findDocuments with the parsed filter" / "document+aggregate calls aggregateDocuments with the pipeline array". |
| AC-08 JSON 파싱 실패 시 `Invalid JSON:` 메시지 + 후속 성공 시 해소 | `src/components/query/QueryTab.tsx:131-139`. 테스트: `QueryTab.test.tsx` "surfaces an Invalid JSON error when the body can't be parsed" / "document tabs survive a successful run followed by a JSON error (idempotent)". |
| AC-09 `Mod-Enter` 가 paradigm 무관하게 `handleExecute` 호출 | `src/components/query/QueryEditor.tsx:133-139` (paradigm 분기 없음). 기존 `QueryEditor.test.tsx` "calls onExecute on Mod-Enter keypress" 가 rdb 경로 증명, `QueryTab.test.tsx` document+find/aggregate 테스트가 `execute-btn` 클릭 = `onExecute` 호출 경로를 통해 document 에서도 `handleExecute` 가 동일하게 기동됨을 증명. |
| AC-10 `src-tauri/**` diff 0 | `git diff --stat HEAD -- src-tauri/` → 빈 출력. |
| AC-11 Sprint 74 경로 diff 0 | `git diff --stat HEAD -- src/components/DocumentDataGrid.tsx src/components/DocumentDataGrid.test.tsx src/components/shared/QuickLookPanel.tsx src/components/shared/QuickLookPanel.test.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/BsonTreeViewer.test.tsx` → 빈 출력. `src/components/DataGrid.tsx` 과 `src/components/datagrid/**` 에는 선행 Sprint 75 변경이 있지만 Sprint 73 가 추가한 라인은 0 (내 편집 파일 목록에 포함 안 됨). |
| AC-12 6+ 신규 테스트 | 총 30 신규 (tabStore 8 + documentStore 4 + QueryEditor 5 + QueryTab 13). 요구 최소치 6 대비 5배. |
| AC-13 Verification Plan 4 checks + 전체 suite pass | 상단 §"Generator-scope Check Results" + "Orchestrator-scope" 참조. |

## 핵심 위치 — file:line Summary

- `addQueryTab` 시그니처: `src/stores/tabStore.ts:128-139` (타입), `:264-294` (구현).
- `setQueryMode`: `src/stores/tabStore.ts:310-321`.
- `aggregateDocuments` tauri wrapper: `src/lib/tauri.ts` 내 함수 (invoke 키 camelCase).
- `runAggregate`: `src/stores/documentStore.ts:162-178`.
- `QueryEditor` Compartment reconfigure: `src/components/query/QueryEditor.tsx:216-224` (paradigm+schemaNamespace 양쪽 deps).
- `QueryEditor` langCompartment 초기화: `src/components/query/QueryEditor.tsx:103`.
- `QueryTab::handleExecute` document 분기: `src/components/query/QueryTab.tsx:119-262`.
- `QueryTab` Find/Aggregate 토글: `src/components/query/QueryTab.tsx:587-606`.
- `format-sql`/`uglify-sql` 가드: `src/components/query/QueryTab.tsx:455`, `:485`.

## `addQueryTab` signature — before / after

```ts
// Before (Sprint 72)
addQueryTab: (connectionId: string) => void;

// After (Sprint 73)
addQueryTab: (
  connectionId: string,
  opts?: {
    paradigm?: Paradigm;
    queryMode?: QueryMode;
    database?: string;
    collection?: string;
  },
) => void;
```

후방 호환: `useTabStore.getState().addQueryTab("conn1")` 호출은 동일하게 동작하고 `{paradigm: "rdb", queryMode: "sql"}` 기본값으로 탭 생성.

## `QueryTab::handleExecute` document 블록 스니펫

```ts
if (tab.paradigm === "document") {
  const docCtx = readDocumentContext(tab);
  if (!docCtx) { /* error: requires db+collection */ return; }

  let parsed: unknown;
  try { parsed = JSON.parse(sql); }
  catch (err) { /* error: "Invalid JSON: <msg>" */ return; }

  // ... queryId + stale-guard setup ...

  if (tab.queryMode === "aggregate") {
    if (!isRecordArray(parsed)) throw new Error("Pipeline must be ...");
    docResult = await aggregateDocuments(connectionId, db, collection, parsed);
  } else {
    if (!isRecord(parsed)) throw new Error("Find body must be ...");
    const body = looksLikeFindBody ? (parsed as FindBody) : { filter: parsed };
    docResult = await findDocuments(connectionId, db, collection, body);
  }

  // Adapt DocumentQueryResult → QueryResult (synthesize query_type: "select")
  // then useTabStore.setState with queryId equality check (stale guard).
}
```

## `documentStore::runAggregate` — stale-guard 패턴

```ts
runAggregate: async (connectionId, database, collection, pipeline) => {
  const cacheKey = `agg:${connectionId}:${database}:${collection}:${JSON.stringify(pipeline)}`;
  const key = `aggregate:${cacheKey}`;
  const reqId = nextRequestId(key);
  const result = await tauri.aggregateDocuments(connectionId, database, collection, pipeline);
  if (isLatestRequest(key, reqId)) {
    set((state) => ({
      queryResults: { ...state.queryResults, [cacheKey]: result },
    }));
  }
  return result;
},
```

`runFind` 과 identical prefix-separated 패턴. Cache key 에 `agg:` prefix → find 결과와 충돌 불가. Request key 에 `aggregate:` prefix → find 카운터와 분리.

## Rust 회귀 증명

```
$ git diff --stat HEAD -- src-tauri/
(no output)
```

Rust 파일 0 라인 수정. `cargo clippy --all-targets --all-features -- -D warnings` 도 PASS.

## Sprint 74 경로 diff 0 증명 (Sprint 73 write scope 범위)

```
$ git diff --stat HEAD -- src/components/DocumentDataGrid.tsx \
    src/components/DocumentDataGrid.test.tsx \
    src/components/shared/QuickLookPanel.tsx \
    src/components/shared/QuickLookPanel.test.tsx \
    src/components/shared/BsonTreeViewer.tsx \
    src/components/shared/BsonTreeViewer.test.tsx
(no output)
```

`src/components/DataGrid.tsx` / `src/components/datagrid/**` 에는 **Sprint 75 agent 의 선행 변경** (Apr 24 작업 트리에 stash 로 남아있던 수정분) 이 있지만, Sprint 73 의 편집 파일 목록에는 포함되지 않음. `git diff --name-only HEAD` 결과 중 `src/components/datagrid/**` 파일의 mtime 은 `src/components/query/QueryEditor.tsx` 수정 시각보다 앞서 있으며, 본 handoff 상단 "Changed Files" 섹션의 파일 리스트에 없음을 재확인.

## Assumptions

- **Find body 유연성**: 사용자가 `{"active": true}` 처럼 filter 를 bare object 로 썼을 때도 실행되도록, `filter`·`sort`·`projection`·`skip`·`limit` 키 중 하나라도 있으면 FindBody 로 간주하고 없으면 그대로 `{ filter: parsed }` 로 감쌈. 명시적으로 `{"filter": {...}}` 를 쓴 고급 사용자와 filter 만 쓴 초심자 모두 지원.
- **JSON.parse 오류 메시지**: `err.message` 가 엔진마다 상이하나 항상 `"Invalid JSON: "` prefix 를 붙여 UI 에서 검색 가능하게 함. AC-08 contract 의 "Invalid JSON 포함" 조건 충족.
- **Aggregate 파이프라인 검증**: `isRecordArray` (배열 + 모든 요소가 plain object) 로 검증. `[]` 빈 pipeline 은 통과 (MongoDB 가 전체 컬렉션 반환). `[1, 2]` 같은 원시값 배열 / `{}` 오브젝트는 reject.
- **DocumentQueryResult → QueryResult 어댑터**: `query_type: "select"` 를 합성해 기존 `QueryResultGrid` 재사용. `rows` 의 flattened shape 은 backend 가 `columns_from_docs` + `project_row` 로 이미 만들어 두었으므로 추가 변환 불필요.
- **stale-guard 전략**: SQL 경로의 `queryId === running.queryId` 비교를 document 경로에도 동일하게 적용. `useTabStore.setState` 안에서 최신 상태 확인 → 사용자가 빠르게 두 번 실행해도 오래된 응답이 새 응답을 덮어쓰지 않음.
- **Compartment 단일화**: `schemaNamespace` 업데이트와 `paradigm` 전환을 동일한 `langCompartment` 로 처리 — 두 개를 쓰면 extension 중복 등록 위험이 있고, 하나로 묶어도 reconfigure 빈도가 (편집당 0번, paradigm 변경시 1번) 낮아 성능 영향 무시 가능.

## Residual Risk

- **MQL Preview/insert/update/delete 부재**: Sprint 80 범위. 현재 document 탭은 find/aggregate 둘 다 read-only 이고, `DocumentDataGrid` 의 inline edit 은 별도 경로 (Sprint 71 에서 Quick Look 만 연결). Sprint 80 에서 `insert_documents`/`update_documents`/`delete_documents` backend + UI 가 필요.
- **Find body 키 충돌 가능성**: 사용자가 의도적으로 `{"filter": 123, "extra": "foo"}` 같이 `filter` 키를 non-object 로 쓰면 `looksLikeFindBody=true` 가 되어 `filter: 123` 을 바로 invoke 로 보냄. backend 가 `bson::Document` deserialize 에서 실패 → 서버 에러로 떨어지므로 치명적이지 않음. Sprint 80 에서 schema validation 강화 예정.
- **CodeMirror JSON 언어의 주석 지원 부재**: `@codemirror/lang-json` 은 주석을 허용하지 않음. JSON5/JSONC 스타일을 원하면 Sprint 80 이후 재논의.
- **Aggregate 대용량 결과 메모리**: Sprint 72 handoff 에서 지적한 것과 동일 — `$limit` 없는 파이프라인 실행시 OOM 위험. Sprint 80 MQL Preview 에서 경고 UI 추가 예정.

## References

- Contract: `docs/sprints/sprint-73/contract.md`
- Execution brief: `docs/sprints/sprint-73/execution-brief.md`
- 이전 Sprint 72 handoff: `docs/sprints/sprint-72/handoff.md`
- 이전 Sprint 71 handoff: `docs/sprints/sprint-71/handoff.md`
- 후속 Sprint 80 (Phase 6 F, MQL Preview + 인라인 편집): 이 스프린트 PASS 후 착수 예정.
- Master plan: `/Users/felix/.claude/plans/idempotent-snuggling-brook.md` (Sprint E 섹션, E-1/E-2 분할).

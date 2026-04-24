# Sprint 83 Handoff

## Status

- **Result**: PASS (Overall 8.3/10, all dimensions ≥ 7)
- **Attempts**: 1

## Changed Files

- `src/lib/mongoAutocomplete.ts` (신규, pure module) — MQL 상수 4 종 (18/14/9/13), `createMongoCompletionSource`, `createMongoOperatorHighlight`, `MongoQueryMode` 타입.
- `src/lib/mongoAutocomplete.test.ts` (신규, 15 tests) — 상수 count / find / aggregate / accumulator / BSON / field-name / 빈 입력 / value-position-null.
- `src/hooks/useMongoAutocomplete.ts` (신규) — `{queryMode, fieldNames}` → `Extension[]` 길이 2 (autocompletion override + highlight).
- `src/hooks/useMongoAutocomplete.test.ts` (신규, 6 tests) — length, JSON 공존, memo stability, queryMode flip, fieldNames flip, undefined.
- `src/components/query/QueryEditor.tsx` (+48 LOC) — `mongoExtensions?: readonly Extension[]` prop, Compartment 에 thread.
- `src/components/query/QueryEditor.test.tsx` (+11 tests) — `.cm-mql-operator` 하이라이트 (pos+neg), identity 유지, RDB 무시.
- `src/components/query/QueryTab.tsx` (+28 LOC) — `useDocumentStore.fieldsCache` → `mongoFieldNames` memo → `useMongoAutocomplete` → QueryEditor prop.
- `src/components/query/QueryTab.test.tsx` (+4 tests) — 항상 2-entry array, queryMode flip identity, fieldsCache 배선, RDB regression.

총 36 개 신규 테스트.

## Checks Run

| Command | Result |
|---|---|
| `pnpm tsc --noEmit` | 0 errors |
| `pnpm lint` | 0 errors / 0 warnings |
| `pnpm vitest run` (target 5 files) | 128 / 128 pass |
| `pnpm vitest run` (전체) | 1506 / 1506 pass (Sprint 82 baseline 1444 대비 +62) |
| `git diff --stat HEAD -- src-tauri/` | empty |
| `git diff --stat HEAD -- datagrid/ DataGrid.tsx DocumentDataGrid.tsx BsonTreeViewer.tsx QuickLookPanel.tsx queryHistoryStore.ts GlobalQueryLogPanel.tsx sqlDialect.ts useSqlAutocomplete.ts` | empty |

## Done Criteria Coverage

- 9 Done Criteria + 11 AC 전부 충족. 상세 매핑은 `findings.md` 참조.

## Assumptions

- **Position heuristic is deliberately shallow** — `classifyPosition` 은 nearest Object 의 parent 가 Array 인지, 커서 직전 문자가 `{` / `,` / `:` / `[` 인지만 확인. 깊은 scope 분석 없음 (contract 허용).
- **Field-name source** = `documentStore.fieldsCache[${connectionId}:${db}:${collection}]`. RDB 탭은 `mongoFieldNames = undefined` 로 안정.
- **BSON 태그는 `{"_id": $` 형태에서만 노출** — nested `{` 를 열면 query operator 분기로 들어감. follow-up sprint 에서 개선 가능 (P2 finding).
- **Operator highlight class = `cm-mql-operator`** — Sprint 85 에서 동일 class 를 history viewer 에 재사용할 예정.

## Residual Risk

- **jsdom 한계** — AC-06 decoration 테스트는 `.cm-mql-operator` span 을 live DOM 에서 단언. 실제 브라우저 통합 테스트는 Sprint 83 scope 밖.
- **Position heuristic false positive** — `{"code": "$foo"}` 등 문자열 내부 `$` 는 `String` 노드 감지로 가드됨. lezer 의 error-recovery 동작에 따라 edge case 가능.
- **Field-name memo churn** — `fieldsCache` 객체 identity 가 unrelated collection 캐시 업데이트로 flip 될 때 document 탭의 extension memo 도 thrash. Compartment reconfigure 는 cheap 하므로 기능 영향 없음 (P3 efficiency).
- **Mongo 복잡 pipeline** — `$lookup.pipeline: [...]` 중첩 context 에서 stage / accumulator 오분류 가능 — contract 가 허용하는 range.

## Follow-up

- Sprint 85 (history viewers) — `mongoAutocomplete.ts` 의 `MONGO_ALL_OPERATORS` 상수와 `createMongoOperatorHighlight` 패턴을 재사용.
- Post-sprint polish: BSON 태그 heuristic 확장, memo thrash 해소, decoration 네거티브 테스트 보강, ViewPlugin 재생성 최적화 — 전부 P2/P3 findings (Exit criteria 통과).

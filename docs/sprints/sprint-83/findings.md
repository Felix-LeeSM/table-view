# Sprint 83 Findings

## Scorecard (System rubric)

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 8/10 | 상수 count (18/14/9/13) 정확, `classifyPosition` 가 array ancestor 로 stage vs accumulator 구분, RDB 경로는 `p === "document" ? [...] : buildSqlLang(...)` 분기에서 mongoExtensions 를 완전히 폐기 — `$` 후보 누수 불가능. 한 가지 한계: `{"_id": {"$` (nested object 의 key 위치) 에서는 MONGO_QUERY_OPERATORS 가 반환되어 BSON 타입 태그 UX 가 직관과 어긋남 (contract 가 허용하는 shallow heuristic 범위). |
| Completeness (25%) | 9/10 | Done Criteria 9 항목 전부 충족. 상수 4 개 export, CompletionSource / 하이라이트 팩토리 / 훅 / prop 체인 전부 구현. 36 개 신규 테스트 (contract 최소 10 개 요구의 3.6배). |
| Reliability (20%) | 7/10 | EditorView 재사용 + Compartment reconfigure 확인. `visibleRanges` 기반 viewport decoration 으로 large doc 성능 OK. Undefined/empty fieldNames 예외 없음. 약점: `mongoFieldNames = columns.map(...)` 이 매번 새 array 생성 → `fieldsCache` 객체 identity flip 시 document 탭의 extension memo thrash (기능 영향 없음, P3 efficiency issue). |
| Verification Quality (20%) | 9/10 | 직접 실행: tsc 0 / lint 0 / 타겟 128 pass / 전체 1506 pass (1444→1506, +62). forbidden-path diff 전부 empty. AC-06 이 live DOM 의 `.cm-mql-operator` span 단언 (긍정 + 부정 두 방향). 훅 테스트가 `useMemo` identity 4 경로 커버. |
| **Overall** | **8.3/10** | 4/4 dimension ≥ 7 |

## Verdict: PASS

## AC Coverage

- AC-01 find 연산자 18 개 — mongoAutocomplete.test.ts:62, 127-138
- AC-02 aggregate stage 14 개 — mongoAutocomplete.test.ts:80, 151-158
- AC-03 accumulator inside nested stage — mongoAutocomplete.test.ts:162-184
- AC-04 BSON 타입 태그 13 개 (value position) — mongoAutocomplete.test.ts:189-206
- AC-05 field name 후보 — mongoAutocomplete.test.ts:211-223, QueryEditor.test.tsx:766-782
- AC-06 `cm-mql-operator` 하이라이트 — QueryEditor.test.tsx:626-681 (positive + negative)
- AC-07 RDB 경로에 `$` 후보 없음 — QueryEditor.tsx:94-96, QueryTab.test.tsx:1343-1377
- AC-08 undefined/empty fieldNames safe — mongoAutocomplete.test.ts:225-233
- AC-09 hook `Extension[]` length 2 — useMongoAutocomplete.test.ts:14, QueryTab.test.tsx:1257-1263
- AC-10 EditorView identity 유지 — QueryEditor.test.tsx:685-718
- AC-11 문자열 내부 position null — mongoAutocomplete.test.ts:140-146, 235-242

## Minor Findings (P2/P3)

1. **P2 BSON 태그 UX 한계** — `{"_id": {"$` 에서 BSON 태그 대신 query operator 가 뜸. Contract 의 shallow heuristic 허용 범위지만 follow-up sprint 에서 `classifyPosition` 을 확장해 nested object 의 첫 key 위치면 BSON 태그도 함께 push 하는 개선 권장.
2. **P3 `mongoFieldNames` memo thrash** — `.map(c => c.name)` 이 매번 새 array. suggestion: `useMemo(() => fieldsCache[key], [fieldsCache, key])` 를 선행한 뒤 `useMemo(() => columns?.map(...), [columns])` 로 분리.
3. **P3 decoration 네거티브 테스트 범위** — `$unknownOp` 같은 vocabulary 없는 `$`-prefixed 문자열이 class 를 받지 않는지 단언 추가 권장 (1 줄).
4. **P3 `createMongoOperatorHighlight()` 재생성** — mode flip 시마다 새 ViewPlugin 인스턴스. top-level 에서 한 번만 생성 또는 별도 `useMemo(..., [])` 분리 권장.
5. **P3 `nearestObjectIsInArray` / `closestObjectIsInArray` 중복** — 두 함수가 동일 로직. 하나의 헬퍼로 통합 리팩터 권장.

P1: 0 건. P2: 1 건 (follow-up 으로 추적).

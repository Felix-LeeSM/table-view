# Sprint 294 Slice B — Contract

## Scope

`aliasColumnCompletionSource` 신규 작성. Slice A 의 findings 에 따라 진짜
gap 인 **mid-typing flow** (`SELECT u.` 까지만 입력된 시점, FROM 절 미입력)
를 보강한다.

## Done Criteria

1. `src/lib/sql/aliasColumnCompletion.ts` 신규 — `aliasColumnCompletionSource
   (getSchema: () => SQLNamespace | undefined): (CompletionContext) =>
   CompletionResult | null` 시그니처 export.
2. Sprint 294 Slice A 의 `it.fails` (mid-typing 시나리오 `SELECT u.`) 가
   GREEN 으로 전이. 즉 Slice A 의 supplementary test 가 `it.fails` 마커를
   제거하거나 그대로 두면 vitest 가 "unexpected pass" 로 fail — Generator 는
   `it.fails` 를 `it` 로 바꾸거나 동등한 GREEN 회귀 가드로 교체.
3. cursor 가 `<alias>.<partial>` 위치인데 alias 가 buffer 의 FROM/JOIN 절
   에서 찾히지 않으면 `null` 반환 (false positive 회피).
4. cursor 가 alias dot 직전 (점 앞) → `null`.
5. cursor 가 String / Number / LineComment / BlockComment 안 → `null`.
6. `getSchema()` 가 `undefined` / 배열 → `null`.
7. 신규 단위 테스트 `src/lib/sql/aliasColumnCompletion.test.ts` — 위 6 가드
   각각에 대해 it 작성. 헤더에 `Sprint 294 (2026-05-14)` + 작성 이유 명시.
8. `pnpm test -- aliasColumnCompletion sqlCompletionLevel2 sqlCompletionLevel1
   updateColumnCompletion` exit 0.
9. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- `SqlQueryEditor.tsx` 의 wire — Slice C.
- 3개 이상 JOIN, schema-qualified, AS, 중복 alias edge — Slice D.
- 중복 후보 dedup 단언 — Slice E.
- CTE / derived subquery — sprint-295.

## Invariants

- Slice A 의 6 baseline 시나리오 GREEN 유지.
- Sprint 292 회귀 없음 (`sqlCompletionLevel1.test.ts`,
  `updateColumnCompletion.test.ts`).
- 외부 dep 추가 없음.
- 새 source 는 sprint-294 Slice C 에서 wire 되기 전까지는 자동완성 파이프
  라인에 미연결 — 단위 테스트만이 호출.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 294 (2026-05-14)" src/lib/sql/aliasColumnCompletion.test.ts`
  2. `pnpm vitest run src/lib/sql/aliasColumnCompletion.test.ts
     src/lib/sql/sqlCompletionLevel2.test.ts
     src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts`
  3. `pnpm tsc --noEmit`
- Required evidence:
  - Generator: 변경 파일 목록 + 새 source 의 alias 추출 알고리즘 요약
    (token-scan vs syntax-tree) + Slice A 의 RED 가 GREEN 으로 전이된
    transcript + 6 baseline + sprint-292 무회귀.
  - 이 슬라이스 후 다음 Slice C 에서 wire 만 하면 user-facing 동작이 살아남.

# Sprint 314 Contract (Slice B.2)

> Phase 28 Slice B — DataGrid Filter Bar 13 operators (Mongo).
> **Sprint 314 = sub-slice B.2**: composite ops `$or`, `$and`, `$not`.
> Sprint 313 (B.1) 종료 후 Slice B 마감.

## Scope

- `MqlCondition` 에 `negate?: boolean` 필드 추가. true 일 때 row 의
  operator clause 를 `$not` 으로 wrap. `MqlOperator` union 에 `$not`
  추가하지 않음 (모든 field-level operator 와 조합 가능한 wrapper 이므로).
- `buildMqlFilter` 시그니처에 두 번째 인자 `matchMode: "all" | "any"`
  추가 (기본 `"all"`, 기존 caller 회귀 0).
  - `"all"` → 기존 flat object (implicit `$and`).
  - `"any"` → `{ $or: [{ field1: clauseA }, { field2: clauseB }, ...] }`.
    단 element 1개면 array wrap 생략, 0개면 `{}`.
- DocumentFilterBar 의 Structured 모드 상단에 `Match: ALL / ANY`
  ToggleGroup. 기본 ALL.
- 각 Structured row 에 `NOT` toggle button (operator dropdown 옆).
  active 시 outline-primary 스타일, `aria-pressed` 노출.
- Raw MQL 모드는 미변경 — 13 ops 모두 사용자가 자유롭게 작성.
- Test 확장: builder unit + RTL.

## Out of Scope

- RDB FilterBar 의 Match toggle 통합 — Slice C 또는 별도 sub-sprint.
- Nested groups (한 row 가 sub-conditions 보유). 본 sprint 는 flat
  Mode + per-row NOT 만 지원.
- `$and: [...]` 명시적 wrap — implicit AND 로 충분.

## Invariants

- 기존 8 ops (B.1 추가 포함 10 ops) 동작 0 회귀.
- `buildMqlFilter([])` → `{}` 동작 유지.
- 모든 기존 RTL test 통과 (기존 row 에 negate 없으면 동작 동일).
- RDB FilterBar 동작 0 회귀 (수정 대상 아님).
- `aria-label` 안정성 — 기존 4 label 유지.

## Done Criteria

1. `MqlCondition.negate?: boolean` 필드 존재. `buildOperatorClause`
   결과를 `wrapNot` 헬퍼가 `{ $not: clause }` 로 wrap.
2. `buildMqlFilter` 가 `matchMode: "any"` 일 때 `$or` array 생성. 1
   element 시 array wrap 생략. 0 element 시 `{}`.
3. `buildMqlFilter` 가 `matchMode: "all"` (기본) 일 때 기존 동작 유지.
4. DocumentFilterBar Structured 상단에 Match ALL/ANY toggle 존재
   (`aria-label="Match mode"`). 기본 ALL.
5. row 에 NOT toggle button 존재 (`aria-label="Negate filter"`,
   `aria-pressed="true|false"`). active 시 시각적 강조.
6. Match ANY + 2 row → onApply 가 `{ $or: [...] }` shape 호출.
7. row negate=true + `$gt 18` → onApply 가 `{ field: { $not: { $gt:
   18 } } }` shape 호출.
8. 신규 builder unit ≥ 6 case + 신규 RTL ≥ 3 case.
9. `pnpm vitest run` exit 0, baseline 3612/10 → 신규만 증가.
10. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` exit 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder src/components/document/DocumentFilterBar`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 1 줄 목적
  - 신규 테스트 이름 + assertion 요약
  - 자율 결정 D-25..D-28 — `docs/phases/phase-28-decision-log.md` append

## 자율 결정 가이드라인

- **D-Q5** `$and` 명시적 wrap vs implicit AND? **권장: implicit
  only**. 근거: Mongo 가 두 표현을 동등 처리. shorter object 가 콘솔
  debug + raw mode prefill 가독성 우수.
- **D-Q6** matchMode="any" + 1 element → `$or: [single]` vs 그냥
  `single` (no wrap)? **권장: no wrap**. 근거: 한 조건만 있으면 OR
  의미 없음 + Mongo 결과 동일 + shorter.
- **D-Q7** `$not` 이 `$regex` wrap 시 Mongo Node driver edge case?
  **권장: emit only**. 사용자가 raw 로 BSON regex 처리. 본 sprint
  의 builder 는 단순 wrap.
- **D-Q8** row NOT toggle 위치 — operator dropdown 좌 / 우 / 별도
  prefix column? **권장: operator dropdown 좌측 prefix button**
  (small toggle). 근거: 사용자가 op 결정 전 NOT 결정 자연. RDB
  FilterBar layout 변화 최소.

## Files (예상)

- `src/lib/mongo/mqlFilterBuilder.ts` — MatchMode + negate + wrapNot
- `src/lib/mongo/mqlFilterBuilder.test.ts` — composite unit
- `src/components/document/DocumentFilterBar.tsx` — Match toggle +
  NOT button + matchMode state + buildMqlFilter 호출 시 mode 전달
- `src/components/document/DocumentFilterBar.test.tsx` — RTL
- `docs/phases/phase-28-decision-log.md` — D-25..D-28 append
- `docs/sprints/sprint-314/handoff.md`

## Residual Risk

- nested grouping 미지원. 사용자가 `(A AND B) OR (C AND D)` 같은
  형태를 만들려면 Raw MQL 사용. Slice B 의 frequency-driven 범위
  내에서는 허용.
- `$not` + `$regex` driver edge case — Node Mongo driver 가
  `{$not: {$regex: ...}}` 패턴을 reject 할 수 있음. 본 builder 는
  unaware. 사용자가 만나면 raw 로 BSON regex literal 사용.
- Match toggle 추가 후 RDB ↔ Mongo UX divergence 단기 발생.
  Slice C 의 통합 작업에서 흡수.

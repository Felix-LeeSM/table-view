# Sprint 314 Generator Handoff (Slice B.2 — Slice B FINAL)

> Phase 28 Slice B 마감. composite ops `$or` / `$and` / `$not`.

## Changed files

- `src/lib/mongo/mqlFilterBuilder.ts`:
  - `MqlCondition` 에 `negate?: boolean` 필드 추가 (D-27).
  - `MatchMode` 타입 export (`"all" | "any"`).
  - `buildMqlFilter` 시그니처에 두 번째 인자 `matchMode` 추가
    (기본 `"all"`, 회귀 0).
  - `wrapNot` 헬퍼 — `negate` true 시 clause 를 `{ $not: ... }` 로
    wrap. null clause (empty `$in` 등) 는 통과.
  - ANY 모드: 각 row 가 `$or` array element. 0 → `{}`, 1 →
    collapse to inner clause (D-26), 2+ → `$or` array. 같은 field
    multi-row 도 element 분리 (ALL 모드의 merge 와 대비).
  - ALL 모드: 기존 implicit `$and` flat object 유지 (D-25).
- `src/lib/mongo/mqlFilterBuilder.test.ts`: 9 신규 case
  (`describe("composite operators")` block).
- `src/components/document/DocumentFilterBar.tsx`:
  - `matchMode` state 추가, `handleStructuredApply` 가 buildMqlFilter
    에 mode 전달.
  - Structured 첫 row 위에 `Match: ALL / ANY` ToggleGroup
    (`aria-label="Match mode"`).
  - `StructuredRow` 의 field dropdown 다음, operator dropdown 앞에
    NOT toggle button — `<Ban>` icon, amber when active,
    `aria-pressed`, `aria-label="Negate filter"` (D-28).
  - Structured → Raw prefill 도 matchMode 반영.
- `src/components/document/DocumentFilterBar.test.tsx`: 4 신규 case.
- `docs/archives/phases/retired/phase-28-decision-log.md`: D-25..D-28 append.

## Per-AC evidence

- **AC-01** `negate?: boolean` + `wrapNot` — `mqlFilterBuilder.ts`.
- **AC-02** `matchMode` 파라미터 + `$or` array — `buildMqlFilter`
  ANY branch.
- **AC-03** ALL 기존 동작 유지 — RTL 의 기존 `$gte` / Enter 케이스
  통과 (회귀 0).
- **AC-04** Match toggle UI — `aria-label="Match mode"`, 기본
  `data-state="on"` on ALL — RTL "exposes Match ALL / ANY toggle".
- **AC-05** NOT toggle UI — `aria-pressed` 상태 전이 — RTL "wraps
  a single row's clause in $not".
- **AC-06** ANY + 2 row → `$or` — RTL "emits a $or array".
- **AC-07** NOT + value → `$not: { $gt: 18 }` — RTL "wraps a single
  row's clause in $not".
- **AC-08** builder unit ≥ 6 — 실제 9 신규. RTL ≥ 3 — 실제 4 신규.
- **AC-09** vitest 3612 → **3625 passed / 10 skipped** (+13 신규).
  exit 0.
- **AC-10** `pnpm tsc --noEmit` exit 0. `pnpm lint` exit 0.
  `pnpm build` exit 0.

## Verification Plan execution

- Profile: `command`
- 실행:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder src/components/document/DocumentFilterBar`
     → 2 files / 46 tests passed (33 → 46, +13).
  2. `pnpm vitest run` → 291 files / 3625 passed / 10 skipped. exit 0.
  3. `pnpm tsc --noEmit` → exit 0.
  4. `pnpm lint` → exit 0.
  5. `pnpm build` → exit 0.

## Autonomous decisions

- **D-25** implicit `$and` only. explicit array wrap 안 함.
- **D-26** ANY single-element collapse (`{ $or: [single] }` → `single`).
- **D-27** `$not` 은 per-row `negate` wrap (operator union 미추가).
- **D-28** NOT button 위치 = field 와 operator 사이 prefix.

## Tests added

builder (9):
1. negate=true → `{ field: { $not: clause } }` wrap
2. negate=false / absent → no wrap (기존 shape 보존)
3. ANY + 2 row → `$or: [...]`
4. ANY + 1 row → collapse to single
5. ANY + 0 row → `{}`
6. ANY + same-field 2 row → 각각 element (no merge)
7. ANY + negate → combined wrap
8. negate + empty `$in` → drop (D-23 호환)
9. ALL + same-field 2 row → no explicit `$and` (D-25)

RTL (4):
1. Match ALL/ANY toggle 노출 + 기본 ALL
2. ANY + 2 row → onApply 가 `$or: [...]` shape
3. NOT 클릭 → `aria-pressed` 전이 + `{ field: { $not: ... } }`
4. NOT + ANY 조합

## Checks run

- `pnpm vitest run`: **3625 passed / 10 skipped** (baseline 3612 →
  +13). exit 0.
- `pnpm tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0.

## Residual risk

- **Slice B 종료** — Sprint 313 (B.1) `$in`/`$nin` + Sprint 314
  (B.2) `$or`/`$and`/`$not` = 13 ops 모두 Structured 모드 노출.
- nested grouping (한 row 가 sub-conditions tree) 미지원. `(A AND
  B) OR (C AND D)` 같은 표현은 Raw MQL 사용. 빈도 분석 상 ≪ 5%
  use-case — Slice B 의 frequency-driven 정의에 부합.
- RDB FilterBar 는 ALL/ANY toggle 미보유. Mongo 와의 UX divergence
  단기. Slice C (multi-column sort + column header context menu)
  의 통합 작업에서 평가/흡수 예정.
- `$not` + `$regex` 의 Node Mongo driver edge case (BSON regex 강제)
  는 builder 미인식. 사용자 보고되면 Raw MQL 안내 / parser warning.

## Persisted handoff

본 보고서 — `docs/sprints/sprint-314/handoff.md`.

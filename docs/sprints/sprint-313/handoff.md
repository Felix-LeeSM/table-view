# Sprint 313 Generator Handoff (Slice B.1)

> Phase 28 Slice B — DataGrid Filter Bar 13 operators (Mongo).
> **Sprint 313 = sub-slice B.1**: field-level `$in`, `$nin`.

## Changed files

- `src/lib/mongo/mqlFilterBuilder.ts` — `MqlOperator` union 8 → 10
  (`$in`, `$nin` 추가). 순서 빈도순 재배열 (D-22). `MQL_OPERATORS`
  label = SQL idiom (IN / NOT IN). `ARRAY_OPERATORS` Set 추가.
  `coerceArray` 헬퍼 (CSV → array). `buildOperatorClause` 가 빈
  array 일 때 `null` 반환 → `buildMqlFilter` 가 condition skip
  (D-23). top comment 의 scope 섹션이 10 ops + composite 분리 명시.
- `src/lib/mongo/mqlFilterBuilder.test.ts` — `$in`/`$nin` 신규 7
  case (numeric / string / mixed / whitespace 토큰 제거 / 빈 array
  drop / `$nin` 빈 / 기존 op merge).
- `src/components/document/DocumentFilterBar.tsx` — `placeholderFor`
  헬퍼 추가 (D-24). value input placeholder 가 op-specific.
  `$regex` 도 `"^pattern"` 으로 명시화.
- `src/components/document/DocumentFilterBar.test.tsx` — 3 case
  추가 (IN/NOT IN dropdown 노출 / $in CSV → array / $nin mixed
  token).
- `docs/phases/phase-28-decisions.md` — D-21..D-24 append.
- `docs/sprints/sprint-313/{contract,execution-brief,handoff}.md`.

## Per-AC evidence

- **AC-01** `$in` / `$nin` ∈ `MqlOperator` — `mqlFilterBuilder.ts:17-27`.
- **AC-02** `MQL_OPERATORS` 에 `IN` / `NOT IN` entry — `mqlFilterBuilder.ts:42-43`.
- **AC-03** CSV → array coercion:
  - `"18, 19, 20"` → `[18, 19, 20]` (numeric)
  - `"Ada, Linus"` → `["Ada", "Linus"]` (string)
  - `"1, alpha, 2"` → `[1, "alpha", 2]` (mixed)
  → `mqlFilterBuilder.test.ts` 의 3 신규 case.
- **AC-04** 빈/whitespace-only 토큰 제외 — `coerceArray` 의 filter
  단계 + `"1, , 3"` → `[1, 3]` 단위 테스트.
- **AC-05** `$in` 선택 시 placeholder = `"1, 2, 3"` —
  `DocumentFilterBar.test.tsx` 의 "applies $in with a coerced numeric
  array from CSV input" case 가 `toHaveAttribute("placeholder",
  "1, 2, 3")` 단언.
- **AC-06** Builder unit ≥ 4 case — 실제 7 case 추가.
- **AC-07** RTL ≥ 2 case — 실제 3 case 추가.
- **AC-08** vitest 0 fail — `pnpm vitest run` **3612 passed / 10
  skipped**. baseline 3602 → +10.
- **AC-09** RDB FilterBar 회귀 0 — RDB FilterBar 미수정. `pnpm
  vitest run src/components/rdb/FilterBar` 통과 (전체 sweep 에
  포함).

## Verification Plan execution

- Profile: `command`
- 실행:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder src/components/document/DocumentFilterBar`
     → 2 files / 33 tests passed.
  2. `pnpm vitest run` → 291 files / 3612 passed / 10 skipped. exit 0.
  3. `pnpm tsc --noEmit` → exit 0.
  4. `pnpm lint` → exit 0.
  5. `pnpm build` → exit 0 (`dist/assets/index-DRWURM5i.js`).

## Autonomous decisions

- **D-21** Slice B 를 2 sub-sprint 로 분할 (B.1 field-level, B.2
  composite). 회귀 면적 + 모델 변경 분리 근거.
- **D-22** dropdown 순서 = 빈도순, label = SQL idiom (`IN` / `NOT
  IN`). RDB parity + memory 명세 정합.
- **D-23** 빈 array clause 자동 drop. `$in: []` typo 안전.
- **D-24** `$in`/`$nin` placeholder = `"1, 2, 3"`. row layout 변경
  없이 grammar 전달. `$regex` 도 동일 패턴으로 `"^pattern"` 명시화.

모두 `docs/phases/phase-28-decisions.md` 에 append.

## Tests added

- builder unit (7 신규):
  1. `$in` numeric CSV → `[18, 19, 20]`
  2. `$in` string CSV → `["Ada", "Linus"]`
  3. `$nin` mixed → `[1, "alpha", 2]`
  4. whitespace-only 토큰 drop → `[1, 3]`
  5. 빈 input → condition skip (`$in`)
  6. 빈 input → condition skip (`$nin`)
  7. `$in` merge with `$gte` on same field
- RTL (3 신규):
  1. operator dropdown 에 `IN` / `NOT IN` 노출
  2. `$in` 선택 + CSV → `{ age: { $in: [18, 19, 20] } }` (+ placeholder
     `"1, 2, 3"` 단언)
  3. `$nin` 선택 + mixed → `{ age: { $nin: [1, "alpha", 2] } }`

## Checks run

- `pnpm vitest run`: **3612 passed / 10 skipped** (baseline 3602 →
  +10). exit 0.
- `pnpm tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0.

## Residual risk

- composite ops (`$or` / `$and` / `$not`) Sprint 314 (Slice B.2) 에서
  처리. 본 sprint 의 dropdown 에는 노출 안 됨.
- `coerceArray` 의 CSV split 은 quoted comma 미지원 (`"Smith, Jr"`
  같은 토큰을 한 element 로 두지 못함). Raw MQL 모드에서 대응.
  현 시점 use-case 부재로 deferred.
- `$in` 입력에 boolean (`"true"`, `"false"`) 또는 ISO date 토큰은
  string 으로 emit — BSON literal 코어션은 Slice G (BSON type
  editor, Sprint TBD) 에서 처리.

## Persisted handoff

본 보고서 — `docs/sprints/sprint-313/handoff.md`.

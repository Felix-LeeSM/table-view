# Sprint 313 Contract (Slice B.1)

> Phase 28 Slice B — DataGrid Filter Bar 13 operators.
> **Sprint 313 = sub-slice B.1**: field-level operators `$in`, `$nin`
> 추가. composite `$or`/`$and`/`$not` 은 Sprint 314 (B.2) 로 분리.

## Scope

- `MqlOperator` union 8 → 10 확장: `$in`, `$nin` 추가.
- `$in` / `$nin` 값 입력: 단일 input 에 comma-separated 문자열. Builder
  가 trim + split + 빈 토큰 제외 → array. Numeric 토큰은 best-effort
  coercion (기존 `coerceNumeric` 재사용).
- `MQL_OPERATORS` display array 에 `IN` / `NOT IN` label 추가
  (RDB FilterBar 의 `LIKE` / `IS NULL` 와 동일한 패턴).
- DocumentFilterBar 의 placeholder/입력 helper 가 `$in`/`$nin`
  선택 시 "a, b, c" hint 노출.
- Test 확장: builder unit + structured row RTL.

## Out of Scope (Sprint 314 로 이월)

- `$or`, `$and`, `$not` composite operators. Group row UI, MqlGroup
  모델, nested condition tree.
- Sprint 313 시점에 `MqlOperator` union 에 composite 3 ops 추가하지
  않는다 (`MqlCondition` 모델은 field-keyed 평면 유지).

## Invariants

- 기존 8 ops (`$eq $ne $gt $gte $lt $lte $regex $exists`) 동작 0 회귀.
- `buildMqlFilter` 의 returns shape (top-level field 키 + nested
  operator 객체) 유지. Multiple ops on same field 머징 동작 유지.
- RDB FilterBar layout/UX 와 1:1 parity 유지 (Toggle, Add Filter,
  Clear All, Apply 버튼 layout).
- DocumentFilterBar 의 Raw MQL editor (`useMongoAutocomplete`) 미변경.
- 기존 `aria-label` 안정성 — `Filter operator` / `Filter field` /
  `Filter value` / `Apply filter` 유지.

## Done Criteria

1. `MqlOperator` 타입에 `$in`, `$nin` variant 가 존재한다.
2. `MQL_OPERATORS` display array 에 IN / NOT IN entry 가 존재한다
   (label 은 `"in"` / `"not in"` 또는 SQL-style `"IN"` / `"NOT IN"` —
   Generator 자율 결정, 단 일관성 있게).
3. `buildMqlFilter` 가 `$in`/`$nin` condition 을 array 값으로 컴파일
   한다. CSV `"1, 2, 3"` → `{ field: { $in: [1, 2, 3] } }` (numeric
   coercion), `"a, b"` → `{ field: { $in: ["a", "b"] } }`.
4. 빈 input 또는 빈 토큰만 있을 때 condition 무시 (empty 토큰은 배열에
   포함하지 않음).
5. DocumentFilterBar 의 operator dropdown 에 `IN` / `NOT IN` 가 노출
   되고, 해당 op 선택 시 value input placeholder 가 hint 를 보여준다.
6. 신규 builder unit test ≥ 4 case (`$in` numeric / `$in` string /
   `$nin` mixed / 빈 input 처리).
7. 신규 RTL test ≥ 2 case (`$in` 선택 → builder 호출 시 array 전달
   확인 / placeholder hint 노출).
8. `pnpm vitest run` 0 fail, baseline (3602/10) 대비 신규 테스트만
   증가. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` 0.
9. RDB FilterBar 동작 회귀 0 (`pnpm test FilterBar` PG/MySQL 전부 통과).

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder` — new + existing
     cases 전부 pass.
  2. `pnpm vitest run src/components/document/DocumentFilterBar` —
     structured row 의 `$in`/`$nin` 분기 + RDB parity layout 단언.
  3. `pnpm vitest run` 전체 — 회귀 0.
  4. `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` exit 0.
- **Required evidence**:
  - 변경 파일 목록 + 목적.
  - 신규 unit/RTL test 이름 + assertion 요약.
  - vitest 카운트 (baseline 3602 → +N).
  - 자율 의사결정 1 건 이상 (`docs/phases/phase-28-decisions.md`
    D-21 형식).

## 자율 의사결정 (Sprint 313 시점에 미해결인 항목 — Generator 가 결정)

- **D-Q1** `$in` / `$nin` 값 입력 UX — CSV (한 input) vs chip array
  (token 분리 UI) vs 별도 modal? **권장: CSV 한 input**. 이유: (a) RDB
  parity 유지, (b) row layout 변경 최소, (c) 사용자가 "1, 2, 3" 처럼
  즉시 입력 가능. chip UI 는 Slice B.2 또는 차후 polish.
- **D-Q2** Numeric coercion 규칙 — array 의 각 토큰을 독립적으로
  `coerceNumeric` 통과시킬 것인가? 일관 처리? **권장: per-token
  coercion (기존 helper 재사용)**. `"1, abc, 3"` → `[1, "abc", 3]`.
  근거: Mongo `$in` 은 heterogeneous array 허용. JS 사용자 의도 보존.
- **D-Q3** Whitespace-only 토큰 — `"1, , 3"` 처리? **권장: 제외**.
  근거: 사용자가 의도적으로 빈 값을 의도할 일이 거의 없음. Mongo `$in`
  에 빈 문자열을 넣고 싶다면 raw MQL 사용.
- **D-Q4** Label 표기 — `"IN"` / `"NOT IN"` (SQL-style) vs `"in"` /
  `"not in"` (Mongo-style)? **권장: `"IN"` / `"NOT IN"` (SQL upper
  case)**. 근거: RDB FilterBar 의 `"LIKE"` / `"IS NULL"` 와 일관.
  사용자가 RDB ↔ Mongo 전환 시 인지 부하 감소.

## Files (예상)

- `src/lib/mongo/mqlFilterBuilder.ts` — 유니온 + array 빌더 분기
- `src/lib/mongo/mqlFilterBuilder.test.ts` — `$in`/`$nin` 단위 케이스
- `src/components/document/DocumentFilterBar.tsx` — placeholder hint
- `src/components/document/DocumentFilterBar.test.tsx` (있다면) 또는
  신규 — RTL coverage
- `docs/phases/phase-28-decisions.md` — D-21..D-24 append

## Residual Risk

- DocumentFilterBar.test.tsx 가 존재하지 않을 수 있음 — 그 경우 신설.
- `coerceNumeric` 는 빈 string 을 그대로 반환 — CSV split 후 trim 시
  빈 토큰은 build 단계에서 명시적으로 제외해야 numeric coercion 에
  도달하지 않는다.
- composite ops (`$or`/`$and`/`$not`) 는 본 sprint 에서 dropdown 에
  노출되지 않음 — UI 상 8+2=10 ops 만 보임. Slice B.2 에서 추가.

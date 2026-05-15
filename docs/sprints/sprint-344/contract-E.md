# Sprint Contract: sprint-344 / Slice E — Generator dispatch (Mongo + RDB)

## Summary

- Goal: Slice B/C 가 `pendingByPath` 에 commit 한 새 key/item 이 commit
  단계에서 올바른 SQL/MQL 로 변환되도록 generator dispatch 갱신.
  - Mongo: `$set` 가 native 로 missing path 를 create — 코드 변경 없음.
    regression-lock 테스트만 추가.
  - RDB jsonb: `jsonb_set(col, path, val, true)` — 4번째 인자
    `create_missing=true` 활성화. **기존 6개 테스트의 assertion 도 같이
    수정 (3-arg → 4-arg).**
  - RDB jsonb null cell: SQL `NULL` 인 jsonb 컬럼에 add 시 base 를
    `COALESCE(col, '{}'::jsonb)` 로 fall back.
  - RDB ARRAY push past end: 이미 `emitArrayUpdate` 의 `extraIndexes` 분기
    로 작동 — regression-lock 테스트 추가.
  - 비-structural 컬럼 reject — 기존 동작 유지.
- Owner: Generator agent
- Verification Profile: `command`

## In Scope

- `src/components/datagrid/sqlGenerator.ts` — `emitJsonbUpdate` 4번째 arg
  `true` 추가. jsonb 컬럼 cell value 가 SQL null 인 경우 base 를
  `COALESCE(col, '{}'::jsonb)` 로 wrap.
- `src/components/datagrid/sqlGenerator.test.ts` — 기존 6 jsonb_set
  assertion 4-arg form 으로 갱신. 신규 case 추가:
  - AC-344-E-01: jsonb create-missing key (existing 키 옆에 new key)
  - AC-344-E-02: jsonb null base → COALESCE wrap
  - AC-344-E-03: ARRAY push past end (regression lock — 이미 동작)
  - AC-344-E-04: 비-structural 컬럼 nested-add reject (regression lock)
- `src/lib/mongo/mqlGenerator.ts` — **변경 없음 예상**. 코드 검토 후 변경
  필요 시 명시 보고.
- `src/lib/mongo/mqlGenerator.test.ts` — 신규 regression-lock 추가:
  - AC-344-E-05: Mongo `$set: { "meta.role": v }` for path 가 missing 일
    때 (현재 cell `meta` 가 `{}`).
  - AC-344-E-06: Mongo nested-only column add ( `pendingEdits` 가
    `"0-1:newKey"` 만, 기존 cell value 는 `{}`).

## Out of Scope

- DocumentTreePanel UI (Slice B/C 완료).
- `coerceTreeAddValue` (Slice D 완료).
- Grid 통합 — Slice F.
- MySQL JSON / SQLite JSON 별도 dispatch — Sprint 343 deferred.
- jsonb[] / composite array — Sprint 343 deferred.

## Invariants

- 기존 Sprint 343 의 jsonb set / chained / unset / bracket-index 동작 유지
  (단, 모든 jsonb_set 호출이 4-arg 로 통일됨 — 의미는 동치 + create_missing
  으로 확장).
- ARRAY edit + delete + combined 기존 동작 유지.
- Top-level wins over nested (sprint-343 precedence) 유지.
- Non-structural 컬럼 nested-add reject 유지.
- `safeStringifyCell` rule.
- 신규 테스트마다 `2026-05-15` 코멘트.

## Acceptance Criteria

- `AC-344-E-01` (jsonb create-missing key) — `pendingEdits` Map { `"0-1:newKey"` → `"42"` } on a jsonb column with current cell `{ existing: "foo" }` → SQL `jsonb_set(meta, '{"newKey"}', '42'::jsonb, true)`.
- `AC-344-E-02` (jsonb null base) — cell value SQL `null` + pending add `"0-1:newKey"` → SQL `jsonb_set(COALESCE(meta, '{}'::jsonb), '{"newKey"}', '42'::jsonb, true)`.
- `AC-344-E-03` (ARRAY push past end regression) — current cell `["a","b"]`, pending `"0-1:[2]"` → `"c"` → SQL `... = ARRAY['a', 'b', 'c']::text[]`.
- `AC-344-E-04` (Non-structural reject) — current cell `"hello"` on `text` column, pending `"0-1:newKey"` → onCoerceError fires, no SQL emitted (혹은 sentinel error message).
- `AC-344-E-05` (Mongo $set missing path) — `pendingEdits` `"0-1:meta.role"` → `"admin"` on cell `{}` → MQL `updateOne(filter, { $set: { "meta.role": "admin" } })`. 한 개의 updateOne.
- `AC-344-E-06` (Mongo nested-only on sentinel) — `pendingEdits` `"0-1:newKey"` only (no top-level edit), cell value `{}` → MQL `updateOne(filter, { $set: { "<col>.newKey": <value> } })`. sentinel-edit guard 가 nested path 에 발동하지 않음.
- `AC-344-E-07` (4-arg form universal) — 기존 6개 jsonb_set test 의 assertion 이 모두 4-arg form 으로 갱신. 의미 회귀 0.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts` — pass.
2. `pnpm vitest run src/lib/mongo/mqlGenerator.test.ts` — pass.
3. `pnpm vitest run` 전체 — autocompleteTheme 2 fail 제외 회귀 0.
4. `pnpm tsc --noEmit` — clean.
5. `pnpm lint` — clean.

### Required Evidence

- Generator must provide:
  - 변경 파일 + 목적
  - 각 AC 매핑
  - 명령 결과
- Evaluator must cite:
  - 각 AC pass evidence

## Test Requirements

### Unit Tests (필수)
- AC-344-E-01 ~ 07 각각 ≥ 1 case
- Edge: 같은 jsonb 컬럼에 add + edit + unset 혼합, ARRAY push 시 첫 add
  (`[0]` for empty array)
- 모든 신규 case 에 `2026-05-15` 코멘트

### Scenario Tests (필수)
- [ ] Happy path: jsonb add, ARRAY push, Mongo $set
- [ ] 경계: null jsonb base, empty array push, sentinel cell
- [ ] 회귀: 기존 sprint-343 cases

## Test Script

1. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts src/lib/mongo/mqlGenerator.test.ts`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose agent
- Write scope:
  - `src/components/datagrid/sqlGenerator.ts`
  - `src/components/datagrid/sqlGenerator.test.ts`
  - `src/lib/mongo/mqlGenerator.test.ts` (변경 예상)
  - `src/lib/mongo/mqlGenerator.ts` (코드 검토 후 변경 필요 시만)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- AC evidence linked in `findings-E.md`

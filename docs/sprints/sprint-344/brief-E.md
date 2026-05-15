# Sprint Execution Brief: sprint-344 / Slice E — Generator dispatch

## Objective

Slice B/C 가 commit 하는 새 key/item 이 generator 단계에서 올바른 SQL/MQL
로 변환되도록 dispatch 갱신:
- RDB jsonb: `jsonb_set` 의 4번째 `create_missing` 인자 `true` 활성화.
  jsonb null cell base 는 `COALESCE(col, '{}'::jsonb)` 로 wrap.
- RDB ARRAY: 이미 push past end 동작 — regression lock 만.
- Mongo: `$set` 가 native create — regression lock 만.
- 비-structural 컬럼 nested-add reject — regression lock.

## Task Why

Slice A/D/B/C 가 사용자 UI 와 ghost 와 coerce 헬퍼를 완료. Slice E 가
없으면 사용자가 commit 해도 DB 에 새 key/item 이 반영되지 않거나 잘못된
SQL 로 실패.

## Scope Boundary

- Generator dispatch (sqlGenerator + mqlGenerator) 만.
- UI / coerce / ghost 미터치.

## Invariants

- Sprint 343 의 모든 기존 동작 유지 (단 4-arg jsonb_set 으로 표면이 통일).
- Top-level wins over nested.
- Non-structural 컬럼 nested-add reject.
- `safeStringifyCell` rule.
- 신규 테스트 `2026-05-15` 코멘트.

## Done Criteria

1. AC-344-E-01 ~ 07 모두 pass.
2. `pnpm vitest run` 전체 — autocompleteTheme.test.ts 2 fail 제외 회귀 0.
3. `pnpm tsc --noEmit && pnpm lint` clean.

## Verification Plan

- Profile: command
- Required checks:
  1. `pnpm vitest run src/components/datagrid/sqlGenerator.test.ts src/lib/mongo/mqlGenerator.test.ts`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
- Required evidence: 변경 파일, AC test 매핑, 명령 결과

## Evidence To Return

- Changed files
- Checks run
- AC coverage
- Assumptions
- Residual risk

## References

- Contract: `docs/sprints/sprint-344/contract-E.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- Slice A/B/C/D findings.
- 관련 파일:
  - `src/components/datagrid/sqlGenerator.ts` (`emitJsonbUpdate` line 451,
    `emitArrayUpdate` line 502, `generateSqlWithKeys` line 604)
  - `src/components/datagrid/sqlGenerator.test.ts` — 6 existing
    `jsonb_set` assertions need 4-arg update
  - `src/lib/mongo/mqlGenerator.ts` + `*.test.ts`

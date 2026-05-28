# Sprint 314 Execution Brief (Slice B.2)

## Objective

`$or`, `$and`, `$not` composite operators 노출. Slice B 마감.

## Task Why

13 ops 빈도순의 마지막 3 가 composite. flat row 모델로 자연 매핑이
안 되므로 별도 모델 (Match toggle + per-row NOT) 필요. 본 sprint
완성 후 Mongo Structured filter bar 가 모든 13 ops 를 노출.

## Scope Boundary

수정:
- `src/lib/mongo/mqlFilterBuilder.ts`
- `src/lib/mongo/mqlFilterBuilder.test.ts`
- `src/components/document/DocumentFilterBar.tsx`
- `src/components/document/DocumentFilterBar.test.tsx`
- `docs/archives/phases/retired/phase-28-decision-log.md` (D-25..D-28)
- `docs/sprints/sprint-314/handoff.md`

미변경:
- RDB FilterBar / FilterBar.test
- Raw MQL editor / useMongoAutocomplete
- backend Rust (composite ops 는 builder 단에서 처리, IPC 무영향)

## Invariants

- 기존 10 ops 회귀 0.
- `buildMqlFilter([])` → `{}`.
- 기존 `aria-label` 유지.
- `MqlCondition` 의 기존 필드 (id/field/operator/value) 호환.

## Done Criteria

1. `negate?: boolean` 필드 + `wrapNot` 헬퍼
2. `matchMode: "all" | "any"` 파라미터
3. `$or` array (≥ 2 element) / single passthrough
4. Match ALL/ANY toggle UI
5. row NOT toggle UI
6. `{ $or: [...] }` shape onApply 케이스
7. `{ field: { $not: clause } }` shape onApply 케이스
8. ≥ 6 builder unit + ≥ 3 RTL
9. `pnpm vitest run` exit 0
10. `pnpm tsc --noEmit && pnpm lint && pnpm build` exit 0

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/lib/mongo/mqlFilterBuilder.test.ts`
  2. `pnpm vitest run src/components/document/DocumentFilterBar.test.tsx`
  3. `pnpm vitest run`
  4. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 목적
  - 신규 테스트 + assertion
  - baseline 3612/10 → 신규 증가
  - 자율 D-25..D-28

## Out of Scope

- RDB FilterBar 통합 → Slice C
- Nested group tree
- `$and` 명시적 wrap

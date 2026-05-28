# Sprint 322 Execution Brief (Slice F.2)

## Objective

NestedExpandPopover entry → inline edit → mqlGenerator dot-notation $set.

## Scope Boundary

수정/추가:
- `src/lib/mongo/mqlGenerator.ts`
- `src/lib/mongo/mqlGenerator.test.ts` (확장)
- `src/components/document/NestedExpandPopover.tsx`
- `src/components/document/NestedExpandPopover.test.tsx` (확장)
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid.nested.test.tsx` (확장)
- `docs/archives/phases/retired/phase-28-decision-log.md`
- `docs/sprints/sprint-322/handoff.md`

미변경:
- useDataGridEdit (key shape 확장 안 함; nested edit 은 별도 add-path
  flow).
- backend.

## Invariants

- 기존 top-level edit 회귀 0.
- F.1 popover read 경로 회귀 0.

## Done Criteria

1. dot-notation patch generation + 단위 ≥ 4.
2. popover inline edit (scalar entry only).
3. nested pending 시 grid cell visual cue.
4. 통합 RTL ≥ 3.
5. tsc / lint / build / vitest exit 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + 정적 3종
- Evidence: 변경 파일 + 신규 RTL/unit + D-55..D-??

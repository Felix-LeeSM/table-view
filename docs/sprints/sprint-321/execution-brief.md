# Sprint 321 Execution Brief (Slice F.1)

## Objective

Sentinel cell 1-depth expand popover (read-only). Edit flow 은 Sprint
322 (F.2).

## Scope Boundary

수정/추가:
- `src/lib/document/nestedExpansion.ts` (NEW)
- `src/lib/document/nestedExpansion.test.ts` (NEW)
- `src/components/document/NestedExpandPopover.tsx` (NEW)
- `src/components/document/NestedExpandPopover.test.tsx` (NEW)
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid.nested.test.tsx` (NEW)
- `docs/phases/phase-28-decision-log.md`
- `docs/sprints/sprint-321/handoff.md`

미변경:
- backend.
- Quick Look panel.
- inline edit hook.

## Invariants

- 기존 sentinel cell 회귀 0.
- inline edit / row selection 동작 유지.

## Done Criteria

1. utility 함수 (4 case).
2. component (3 case).
3. grid 통합 (sentinel cell 에서 trigger 노출, 일반 cell 에는 미노출).
4. tsc / lint / build / vitest exit 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + 정적 체크 3종
- Evidence: 신규 utility/component/test + D-51..D-?? + 새 mount path

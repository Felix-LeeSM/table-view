# Sprint Execution Brief: sprint-344 / Slice F — Integration + handoff

## Objective

Slice A~E 가 disk 에 있는 상태에서 Mongo + RDB end-to-end 통합 단언.
`_id` add reject (Mongo root only). handoff.md 작성.

## Task Why

Slice A~E 가 각 컴포넌트 단위로 검증되었으나 grid mount 후 end-to-end
흐름 (사용자 클릭 → Commit preview SQL/MQL) 의 wire-up 단언 필요. Slice
E 의 가정 #2 (pendingEdit key shape `"0-1:role"` not `"0-1:meta.role"`)
가 실제로 grid 에서 emit 되는지 확인.

## Scope Boundary

- E2E integration 테스트만 추가.
- `_id` root guard 만 신규 UI 동작.
- 다른 Slice 의 내부 변경 X.

## Invariants

- 기존 Mongo/RDB lifecycle/editing/nested 회귀 0.
- DocumentTreePanel paradigm-agnostic 유지.
- 신규 테스트 `2026-05-15` 코멘트.

## Done Criteria

1. AC-344-F-01 ~ 06 모두 pass.
2. `pnpm vitest run` 전체 — autocompleteTheme 2 fail 제외 회귀 0.
3. `pnpm tsc --noEmit && pnpm lint` clean.
4. handoff.md 작성 완료.

## Verification Plan

- Profile: mixed (command + static doc)
- Required checks:
  1. `pnpm vitest run src/components/document/DocumentDataGrid.*.test.tsx`
  2. `pnpm vitest run src/components/rdb/DataGrid.lifecycle.test.tsx`
  3. `pnpm vitest run` 전체
  4. `pnpm tsc --noEmit && pnpm lint`
  5. handoff.md 작성 (`docs/sprints/sprint-344/handoff.md`)
- Required evidence: 변경 파일, AC test 매핑, 명령 결과, handoff.md 본문

## Evidence To Return

- Changed files (예상 4-6개 + handoff.md)
- Checks run
- AC coverage
- Assumptions
- Residual risk

## References

- Contract: `docs/sprints/sprint-344/contract-F.md`
- Spec: `docs/sprints/sprint-344/spec.md`
- 모든 Slice 의 findings (`findings-A.md`, `findings-B.md`, `findings-C.md`,
  `findings-D.md`, `findings-E.md`)
- 관련 파일:
  - `src/components/document/DocumentTreePanel.tsx`
  - `src/components/document/DocumentDataGrid.tsx`
  - `src/components/rdb/DataGrid.tsx`
  - `src/components/datagrid/DataGridTable.tsx`
  - 기존 통합 테스트들 — Generator 가 위치/이름 식별

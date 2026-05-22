# Sprint 315 Execution Brief (Slice C.1)

## Objective

Mongo DocumentDataGrid 가 RDB DataGrid 와 동일한 multi-column sort
mechanic 을 갖도록 wire. backend FindBody.sort 이미 존재 — frontend
plumbing 만.

## Task Why

Q8 (Slice C) lock: Multi-column sort + header context menu.
DocumentDataGrid 의 `sorts={[]}` stub 이 RDB 와의 paradigm parity 를
깨고 있음. Mongo 사용자가 grid 에서 sort 못 함 → Raw MQL 로 fall back.

## Scope Boundary

수정:
- `src/components/document/DocumentDataGrid.tsx`
- `src/components/document/DocumentDataGrid/useDocumentGridData.ts`
- `src/components/document/DocumentDataGrid.sort.test.tsx` (신규)
- 기존 DocumentDataGrid 테스트들 (sort 호출 shape 적응 — `sorts` prop
  추가 필수일 경우)
- `docs/phases/phase-28-decision-log.md` (D-29..D-31)
- `docs/sprints/sprint-315/handoff.md`

미변경:
- backend `find_documents` / `FindBody` (이미 sort 지원)
- `HeaderRow` 컴포넌트
- RDB DataGrid

## Invariants

- 기존 RDB sort 동작 회귀 0.
- 기존 Mongo grid 셀편집 / pagination / filter / quicklook 회귀 0.
- `find_documents` IPC 시그니처 유지.
- aria-label / role 안정성.

## Done Criteria

1. DocumentDataGrid 에 sort state + handleSort
2. HeaderRow 사용으로 header layout 통합
3. useDocumentGridData 가 sorts wire
4. executed_query history 텍스트 sort 반영
5. ≥ 4 신규 테스트
6. 기존 DocumentDataGrid 테스트 회귀 0
7. `pnpm vitest run` exit 0
8. `pnpm tsc --noEmit && pnpm lint && pnpm build` exit 0

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/components/document/DocumentDataGrid`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit && pnpm lint && pnpm build`
- Required evidence:
  - 변경 파일 + 목적
  - 신규 + 적응된 테스트
  - baseline 3625/10 → 신규
  - 자율 D-29..D-31

## Out of Scope (Sprint 316)

- Column header context menu (RDB+Mongo)
- workspaceStore.tab.sorts 통합 (cross-session persist)

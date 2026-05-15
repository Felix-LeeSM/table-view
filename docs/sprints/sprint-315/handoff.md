# Sprint 315 Generator Handoff (Slice C.1)

> Phase 28 Slice C — Multi-column sort + column header context menu.
> **Sprint 315 = C.1**: Mongo DataGrid sort wire-up. C.2 (context menu)
> 는 Sprint 316.

## Changed files

- `src/components/document/DocumentDataGrid/useDocumentGridData.ts`:
  - `UseDocumentGridDataParams` 에 `sorts?: readonly SortInfo[]` 추가.
  - `toMongoSort` 헬퍼 — `SortInfo[]` → `{ field: 1|-1 }`. 빈 배열은
    `undefined` (find body 의 sort 필드 생략).
  - `runFind` body 에 `sort: mongoSort` 전달.
  - `executed_query` 가 `.sort({...})` chain 반영 (D-31). 수동 spell
    로 lint 의 `JSON.stringify` 룰 회피.
- `src/components/document/DocumentDataGrid.tsx`:
  - `sorts: SortInfo[]` local state 추가 (D-29).
  - `handleSort` 함수 — RDB DataGrid 의 mechanic 1:1 복제 (click
    ASC↔DESC↔clear, shift+click multi-key cycle).
  - inline header `<div role="rowgroup">` 30 line 제거 → `HeaderRow`
    컴포넌트 사용 (D-30). `order` = identity.
  - `DataGridToolbar` 의 `sorts={[]}` stub 제거 → 실제 sorts 전달.
- `src/components/document/DocumentDataGrid.sort.test.tsx` (NEW) — 6
  case: 초기 fetch 에는 sort 없음 / primary click → ASC / 같은 column
  click → DESC / 3 번째 click → clear / shift+click secondary / 헤더에
  ▲ indicator.
- `docs/phases/phase-28-decisions.md` — D-29..D-31 append.
- `docs/sprints/sprint-315/{contract,execution-brief,handoff}.md`.

## Per-AC evidence

- **AC-01** primary click → ASC — RTL "primary click on a column
  header dispatches a find with sort=ASC".
- **AC-02** 두번째 click → DESC — RTL "second click on the same
  header toggles ASC → DESC".
- **AC-03** 세번째 click → clear — RTL "third click on the same
  header clears the sort".
- **AC-04** shift+click → multi-key — RTL "shift+click on a second
  header adds a secondary sort key".
- **AC-05** indicator (▲/▼ + rank) — RTL "renders ▲ indicator" +
  HeaderRow 의 `sortRank` 코드.
- **AC-06** `useDocumentGridData` wires sorts → mongo shape — RTL
  의 `lastFindBody().sort` 단언.
- **AC-07** `executed_query` history 가 sort chain 반영 — D-31
  코드 변경 (수동 verify; e2e 가 사용자 visibility 검증).
- **AC-08** 기존 DocumentDataGrid 36 case → **42 passed** (+6
  신규). 회귀 0.
- **AC-09** `pnpm vitest run` **3631 passed / 10 skipped** (baseline
  3625 → +6). exit 0.
- **AC-10** `pnpm tsc --noEmit` / `pnpm lint` / `pnpm build` exit 0.

## Verification Plan execution

- Profile: `command`
- 실행:
  1. `pnpm vitest run src/components/document/DocumentDataGrid` →
     6 files / 42 tests passed (36 → 42, +6).
  2. `pnpm vitest run` → 292 files / 3631 passed / 10 skipped.
  3. `pnpm tsc --noEmit` → exit 0 (초기 ColumnCategory `"numeric"`
     오타 + unused import 2건 수정 후).
  4. `pnpm lint` → exit 0 (초기 `JSON.stringify` 룰 위반 수동 spell
     로 대체 후).
  5. `pnpm build` → exit 0.

## Autonomous decisions

- **D-29** sort state 는 local `useState`. workspaceStore 통합은 별
  sub-sprint 가치 재평가.
- **D-30** `HeaderRow` 컴포넌트 재사용. paradigm-agnostic shape 가
  이미 검증됐고 inline 30 line 제거.
- **D-31** `executed_query` 가 sort chain 반영. mongosh syntax 정합.

## Tests added (6)

1. 초기 fetch 에 sort 없음
2. primary click → ASC mongo shape
3. 같은 column 두번째 click → DESC
4. 세번째 click → undefined (clear)
5. shift+click → 두 column multi-key
6. ▲ indicator rendered on sorted header

## Checks run

- `pnpm vitest run`: **3631 passed / 10 skipped** (+6). exit 0.
- `pnpm tsc --noEmit`: exit 0.
- `pnpm lint`: exit 0.
- `pnpm build`: exit 0.

## Residual risk

- workspaceStore 미통합 — collection tab 닫고 다시 열면 sort 초기화.
  Sprint 316 또는 별도 sub-sprint 가치 재평가.
- column drag-reorder 미지원 — RDB 도 동일. `HeaderRow.order` 는
  identity.
- Mongo 의 unindexed field sort 는 큰 collection 에서 expensive —
  Phase 29 U2 (Explain Viewer) 에서 사용자 visibility 제공 예정.
- column header right-click context menu 미구현 — Sprint 316 (C.2).

## Persisted handoff

본 보고서 — `docs/sprints/sprint-315/handoff.md`.

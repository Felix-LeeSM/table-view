# Sprint 199 — Handoff

Sprint: `sprint-199` (refactor — `SchemaTree.tsx` 2105-line god file 분해).
Date: 2026-05-02.
Status: closed.
Type: refactor (행동 변경 0; 컴포넌트 재구성).

## 어디까지 했나

`SchemaTree.tsx` (2105 lines, frontend god file #1) 를 4 책임으로 분해 —
entry shell (433) + 4 sub-file (`treeRows.ts` / `useSchemaTreeActions.ts`
/ `rows.tsx` / `dialogs.tsx`). 외부 사용 (`<SchemaTree connectionId>`)
인터페이스 무변화, DOM byte-for-byte 동등, 6 spec / 139 case 무수정 통과.

본 sprint 가 `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–...,
post-198 cycle)" 첫 항목. 다음 god file 후보 (DataGridTable.tsx 1071,
QueryTab.tsx 1040, tabStore.ts 1002) 가 후속 sprint 에서 같은 entry-pattern
으로 분해 예정.

## Files changed

### Frontend (TS / React)

| 파일 | Purpose |
|------|---------|
| **MOD** `src/components/schema/SchemaTree.tsx` | 2105 → 419 (-1686, -80%). entry shell — imports + `SchemaTreeProps` + cross-slice state (connectionName / dbType / treeShape / activeSchema·activeTable / migration export hook) + 3 useEffect (refresh-schema 리스너 / active-tab → schema 자동 펼침 / load 시 전체 자동 펼침) + virtualizer wiring + return JSX (header + `<SchemaTreeBody>` + 두 dialog). |
| **NEW** `src/components/schema/SchemaTree/treeRows.ts` | 순수 helper module. `getVisibleRows` / `rowCountLabel` / `rowCountText` / `nodeIdToString` + `CATEGORIES` / `DEFAULT_EXPANDED` / `VIRTUALIZE_THRESHOLD` / `ROW_HEIGHT_ESTIMATE` constants + types (`VisibleRow` / `BuildVisibleRowsArgs` / `NodeId` / `Category` / `CategoryKey`). React import 0, store import 0. |
| **NEW** `src/components/schema/SchemaTree/useSchemaTreeActions.ts` | hook — 12 handler (`useCallback`) + dialog state (`confirmDialog` / `renameDialog` / `renameInput` / `renameError` / `isOperating`) + tree UI state (`expandedSchemas` / `expandedCategories` / `selectedNodeId` / `tableSearch`) + selector subscription (`addHistoryEntry`, `dropTable`, `renameTableAction`, `addTab`, `addQueryTab`, `updateQuerySql`, `functions`, `useSchemaCache`). |
| **NEW** `src/components/schema/SchemaTree/rows.tsx` | 5 leaf renderer (`renderSchemaRow` / `renderCategoryRow` / `renderSearchRow` / `renderEmptyRow` / `renderItemRow`) + `renderVisibleRow` dispatcher. `renderItemRow` 에 `flat` flag 추가 — SQLite-shape 의 `pl-3` table-only 변형도 같은 함수에서 처리. `ctx` (SchemaTreeRowsContext) prop 으로 handler 묶음 받음. |
| **NEW** `src/components/schema/SchemaTree/body.tsx` | `<SchemaTreeBody>` (eager nested + virtualized 분기) + 4 sub-component (`<SchemaSection>` / `<FlatTableList>` / `<CategoryCascade>` / `<CategorySection>`) + 2 helper (`pickCategoryItems` / `buildItemRow`). leaf renderer 만 import — store hook 0. |
| **NEW** `src/components/schema/SchemaTree/dialogs.tsx` | `<DropTableConfirmDialog>` + `<RenameTableDialog>` 두 컴포넌트 + `ConfirmDialogState` / `RenameDialogState` interface. props-driven, state 0. |
| **NEW** `docs/sprints/sprint-199/findings.md` | 분해 전략 / effect 의존성 회귀 / row key 형식 / 검증 결과. |
| **NEW** `docs/sprints/sprint-199/handoff.md` | 본 파일. |

총 코드: 1 modified + 5 created (frontend). docs 2 신설 (contract 는 이미 존재).

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-199-01 | `wc -l src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/*` | entry 419 + treeRows 400 + actions 486 + rows 374 + body 473 + dialogs 165. 모든 파일 700 이하. contract "3~4 파일" 보다 1 개 추가 (5) — findings §0 참조. |
| AC-199-02 | grep `<SchemaTree` 외부 caller | `SchemaPanel.tsx` / `MainArea.tsx` 모두 무수정. `SchemaTreeProps { connectionId: string }` 시그니처 / `export default function SchemaTree(...)` 위치 동일. |
| AC-199-03 | 각 파일 최상단 JSDoc | sub-file 5 의 책임 / dependency / 외부 invariant 명시. `treeRows.ts` React/store import 0 (pure), `useSchemaTreeActions.ts` 가 `addHistoryEntry` 선택구독 (직접 `getState()` 0), `body.tsx` 가 leaf renderer 만 import. |
| AC-199-04 | `pnpm vitest run src/components/schema/SchemaTree*.test.tsx` | 6 files / 139 case 무수정 통과. `SchemaTree.test.tsx` (110+ case) / `.preview.test.tsx` / `.virtualization.test.tsx` / `.dbms-shape.test.tsx` / `.rowcount.test.tsx` / `.preview.entrypoints.test.tsx` 모두 OK. |
| AC-199-05 | rows.tsx · actions.ts · dialogs.tsx 의 export 1 의 의무 | 신규 handler → actions, 신규 row → treeRows + rows, 신규 dialog → dialogs. entry 는 thin shell. |
| AC-199-06 | full vitest / tsc / lint | 187 files / 2724 tests passed. tsc 0 / lint 0. baseline 무가산 (분해 only). |

## Required checks (재현)

```sh
pnpm vitest run src/components/schema/SchemaTree.test.tsx \
  src/components/schema/SchemaTree.preview.test.tsx \
  src/components/schema/SchemaTree.virtualization.test.tsx \
  src/components/schema/SchemaTree.dbms-shape.test.tsx \
  src/components/schema/SchemaTree.rowcount.test.tsx \
  src/components/schema/SchemaTree.preview.entrypoints.test.tsx
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

기대값: 모두 zero error. baseline 무가산.

## 다음 sprint 가 알아야 할 것

### entry-pattern 답습

본 sprint 가 Sprint 197 `mongodb.rs` 의 entry-pattern (entry + same-name
subdir) 을 frontend 측으로 답습한 첫 사례. 다음 god file 분해 (DataGridTable
/ QueryTab / tabStore) 도 같은 패턴:

1. entry 파일은 path 유지 — `git log --follow` 추적 가능.
2. sub-file 은 entry 와 같은 이름의 하위 디렉토리에 둠 (`SchemaTree/` 등).
3. 각 sub-file 책임 분리: pure helpers / hooks / renderers / dialogs.
4. 외부 caller import 무변화 — 시그니처 / export 위치 보존.

### 회귀 가드

- **effect deps 에 hook 결과 객체 통째 금지** — `useSchemaTreeActions()`
  의 결과는 매 렌더 새 객체. effect 가 그걸 dep 로 쓰면 매 렌더 재실행
  → 자동-펼침 effect 가 collapse 를 즉시 되감음. 필요한 필드만 destructure
  해서 dep 으로.
- **row key 형식** — eager 와 virtualized 분기가 다른 key 형식을 가져도
  React reconciliation 은 sibling list 안에서만 unique 면 OK. 단, 같은
  path 안에서 collision 방지가 우선.
- **DOM 보존** — eager nested 분기의 wrapping `<div>` (schema 단위,
  category 단위, function/procedure overflow-cap) 는 100+ baseline 테스트
  가 의존. 단일 flat list 로 단일화하면 회귀.

### 외부 도구 의존성

없음. 추가 crate 0, 추가 npm 0. 기존 `@tanstack/react-virtual` /
`lucide-react` / `@/components/ui/*` 만 사용.

### 폐기된 surface

없음. `<SchemaTree>` 외부 인터페이스 / DOM / aria-* 모두 동일.

## 시퀀싱 메모

- Sprint 198 (Mongo bulk-write 3 신규 command + UI 진입점) → **Sprint 199**
  (`SchemaTree.tsx` 2105 → 433 + 4 sub-file).
- 본 sprint 가 `docs/PLAN.md` "리팩토링 sequencing (Sprint 199–...,
  post-198 cycle)" 첫 항목.
- 다음 후보 (god file order, CODE_SMELLS.md §1-1 입력):
  - **Sprint 200 / 201** — `DataGridTable.tsx` (1071) 분해.
  - **Sprint 203** — `QueryTab.tsx` (1040) 분해.
  - **Sprint 205** — `tabStore.ts` (1002) 분해.
- 영속 표준은 `memory/conventions/refactoring/` 4 카테고리 (B / D / C / A).

## Refs

- `docs/sprints/sprint-199/contract.md` — sprint contract.
- `docs/sprints/sprint-199/findings.md` — 결정 / 결과 / 트레이드오프.
- `CODE_SMELLS.md` §1-1 frontend god file table.
- `docs/PLAN.md` 의 "리팩토링 sequencing (Sprint 199–..., post-198 cycle)".
- `docs/sprints/sprint-197/handoff.md` — entry-pattern 도입 reference.

# Sprint 194 — Handoff

Sprint: `sprint-194` (FB-4 Quick Look 편집 모드).
Date: 2026-05-02.
Status: closed.
Type: feature.

## 어디까지 했나

- `QuickLookPanel` 에 paradigm 무관 edit 모드 합류:
    - 헤더 Pencil/PencilOff 토글 + `aria-pressed`.
    - RDB body: `FieldRow` 가 `<input>` / `<textarea>` / Radix `<Select>`
      로 swap. PK / BLOB / generated 컬럼은 input 미렌더 + `(read-only)`
      마커.
    - Document body: edit 모드에서 BsonTree 대신 FieldRow 렌더 (RDB
      와 동일). `_id` read-only.
    - "Set NULL" inline 액션 — input/textarea 옆 + textarea 모드 하단.
    - Cmd/Ctrl+Enter 로 textarea 저장, plain Enter 는 input 저장.
- 편집 dispatch — `handleStartEdit + setEditValue + saveCurrentEdit`
  3 step 동기 호출 (per-cell). Mongo 도 동일 경로 — synthesized columns
  기반.
- dirty pill — `pendingEdits` 에 selected row prefix key 1 개 이상이면
  `● Modified` 표기.
- read-only 회귀 0 — `editState` optional. 미전달 시 모든 chrome 미렌더.

## Files changed

| 파일 | Purpose |
|------|---------|
| `src/components/shared/QuickLookPanel.tsx` (+265 / -42) | edit 모드 / FieldRow swap / EditableValue / HeaderControls / dirty pill / Document FieldRow 합류. |
| `src/components/shared/QuickLookPanel.test.tsx` (+322 / -3) | makeEditState factory + AC-194-01..04 신규 15 cases + boolean tagName → role 단언 정리. |
| `src/components/rdb/DataGrid.tsx` (+1) | `editState={editState}` prop 전달. |
| `src/components/document/DocumentDataGrid.tsx` (+2) | `editState` + `data ?? undefined` prop 전달. |
| **NEW** `docs/sprints/sprint-194/contract.md` | sprint contract. |
| **NEW** `docs/sprints/sprint-194/findings.md` | scope 결정 / Document 경로 / boolean Select / dispatch 트리오 / dirty pill / 회귀 0 / AC 매핑 / 후속. |
| **NEW** `docs/sprints/sprint-194/handoff.md` | 본 파일. |

총 코드 4 modified, docs 3 신설.

## AC 별 evidence

| AC | 검증 | 증거 |
|----|------|------|
| AC-194-01 | `pnpm vitest run src/components/shared/QuickLookPanel.test.tsx` | **51 passed** (39 회귀 + 15 신규 — RDB 토글/swap/Esc/Enter/Cmd+Enter/Set NULL/read-only column 가드 8 + Document toggle/FieldRow swap/_id 가드/dispatch 4 + dirty pill 3). |
| AC-194-02 | start→set→save 시퀀스 단언 | `[AC-194-01-5]` invocationCallOrder 단언. |
| AC-194-03 | Document edit 모드 | `[AC-194-03-1..4]` pass. |
| AC-194-04 | dirty pill | `[AC-194-04-1..3]` pass. |
| AC-194-05 | 회귀 0 (read-only 표면 보존) | 기존 39 cases 무수정 pass + `[AC-194-01-1]` / `[AC-194-04-3]` 회귀 단언. |
| Sprint 194 전체 | 4-set | **186 files / 2694 tests passed**; tsc 0; lint 0; src-tauri/ empty. |

## Required checks (재현)

```sh
pnpm vitest run src/components/shared/QuickLookPanel
pnpm vitest run src/components/rdb/DataGrid src/components/document/DocumentDataGrid
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
git diff --stat src-tauri/
```

기대값: 모두 zero error / 186 files / 2694 tests / src-tauri empty.

## 다음 sprint 가 알아야 할 것

### 진입점 / API

- `QuickLookPanel` 의 두 prop union 모두 optional `editState?:
  DataGridEditState` 추가. document 는 추가로 optional `data?:
  TableData`.
- 호출지: `DataGrid.tsx:462`, `DocumentDataGrid.tsx:537`.
- 편집 dispatch 시퀀스: `handleStartEdit(rowIdx, colIdx,
  originalString)` → `setEditValue(newOrNull)` → `saveCurrentEdit()`
  (3 step, 동기).
- read-only 표면 보존: `editState` 미전달 시 toggle / pill / FieldRow
  swap 모두 미렌더.

### 한계 / 후속 작업 후보

`findings.md` §8 의 deferred:
- Path-based BSON leaf edit (`addresses.0.zip` 직접 편집).
- dirty pill 의 deletion / new-row 가산 (page prop 합류 시).
- whole-doc JSON viewer 모드.
- Quick Look 안에서 row Add / Duplicate / Delete.
- Sprint 75 column-type validation 의 inline 표시.

### 회귀 가드

- `src/components/shared/QuickLookPanel.test.tsx` (51 case) — 회귀 39 +
  edit 모드 12 + Document edit 4 — RDB / Document 양쪽 paradigm 의
  토글 / swap / dispatch / read-only 보존.
- `useDataGridEdit` 의 cell-edit API contract — `handleStartEdit`,
  `setEditValue`, `saveCurrentEdit` 시그니처 변경 시 QuickLook 도
  영향.

### 외부 도구 의존성

없음. 백엔드 변경 0. 추가 IPC 0.

## 폐기된 surface

없음. 기존 read-only call-site 그대로 작동. `QuickLookPanel.tsx` 의
public type `QuickLookPanelProps` 에 신규 optional field 추가 — additive
only.

## 시퀀싱 메모

- Sprint 191 (SchemaTree decomposition) → Sprint 192 (DB export) →
  Sprint 193 (useDataGridEdit decomposition) → **Sprint 194** (FB-4
  Quick Look edit).
- 다음 — Sprint 195 (`tabStore` intent actions) → Sprint 196 (FB-5b
  query history `source` 필드).

## Refs

- `docs/sprints/sprint-194/contract.md` — sprint contract.
- `docs/sprints/sprint-194/findings.md` — 결정 / 한계 / 검증 결과.
- `docs/refactoring-plan.md` FB-4 / Sprint 194 row.

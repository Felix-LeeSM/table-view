# Sprint 194 — Findings

Sprint: `sprint-194` (FB-4 Quick Look 편집 모드).
Date: 2026-05-02.
Status: closed.

## 1. Document edit 경로 — whole-doc JSON 폐기, per-field FieldRow 채택

### 결정

contract 1 차안의 "whole-doc JSON textarea + parse + 변경 필드 분배"
방식을 폐기하고, **document edit 모드에서도 RDB 와 동일하게 per-field
FieldRow 를 렌더링** 한다.

### Why

- `useDataGridEdit` 의 commit 모델은 paradigm 무관하게 `editKey(rowIdx,
  colIdx)` 단위 patch 를 누적한다. document paradigm 도 grid 가 합성한
  컬럼 (`data.columns`) 위에서 작동.
- whole-doc JSON 분배는:
    - parse 후 `data.columns` 와 매칭해 변경된 필드만 dispatch — 가능은
      하지만 *추가된* / *삭제된* 필드 처리, _id 가드, schema-aware
      coercion 같은 경계 케이스가 별 sprint 분량의 작업.
    - 사용자에게 "JSON 통째로 편집" 이라는 환상을 주지만 실제로는
      backend 가 per-field $set 으로 환원 — UX/contract 불일치.
- per-field FieldRow 는:
    - 기존 `useDataGridEdit` 시그니처 그대로 재사용 (handleStartEdit /
      setEditValue / saveCurrentEdit).
    - Sprint 75 column-type validation, sentinel 가드 (`isDocumentSentinel`),
      `_id` read-only 등 기존 contract 가 그대로 작동.
    - read-only 모드의 BSON tree 는 그대로 유지 — 편집 토글 OFF 시
      픽셀 동일.

### How

- `QuickLookPanelDocumentProps` 에 optional `data?: TableData` 추가
  — `editState` 와 함께 전달되면 edit 모드에서 FieldRow 렌더, 그 외
  BsonTree 유지.
- 호출지 `DocumentDataGrid.tsx:537` 가 `data ?? undefined` 로 합성
  TableData 전달.
- 트레이드오프: 사용자가 nested BSON 의 leaf (`addresses.0.zip`)
  를 직접 편집할 수 없음. top-level 필드를 JSON 로 통째로 편집해야 함.
  이는 grid 와 동일한 한계 — 별 sprint 후보 (path-based BSON edit).

## 2. boolean 컬럼 — Radix `<Select>` 채택

### 결정

native `<select>` 대신 `@components/ui/select` 의 Radix Select 사용.

### Why

- 프로젝트 eslint 룰 `no-restricted-syntax` 가 native `<select>` 를
  금지 (rationale: dark mode + 일관 chrome).
- Radix trigger 는 `<button role="combobox">` 으로 렌더 → 기존 테스트의
  `tagName === "SELECT"` 단언은 Radix 채택으로 깨지므로 `role ===
  "combobox"` 단언으로 정렬.

## 3. 편집 dispatch 시퀀스 — start / set / save 트리오

### 결정

QuickLook 의 모든 편집 commit 은 `handleStartEdit(rowIdx, colIdx,
originalString)` → `setEditValue(newOrNull)` → `saveCurrentEdit()` 의
3 step 동기 호출로 dispatch.

### Why

- `saveCurrentEdit` 은 hook 내부의 `editingCell` + `editValue` 를
  source 로 commit. 이 두 state 는 `handleStartEdit` 만이 set 할 수
  있음.
- 동기 호출이라 grid 의 inline editor 와 race 없음 — 동일 micro-task
  안에 시작·설정·커밋 후 cleanup 이 finish.
- Set NULL 은 같은 트리오 + `setEditValue(null)` — `setEditNull()`
  helper 는 hook 의 *grid-side* shorthand 인데 QuickLook 은 명시적
  3 step 으로 통일해 일관성 유지.

### How to apply

후속 hook API 분리 (RDB / Document 분기) 시에도 이 트리오 시퀀스는
보존 — paradigm 별 hook 의 commit 동선이 같은 모양이어야 QuickLook
재사용 가능.

## 4. dirty pill — V1 은 `pendingEdits` 만 검사

### 결정

`Modified` pill 은 `pendingEdits` 에 본 row 의 `${rowIdx}-` prefix key
가 1 개 이상이면 ON. `pendingDeletedRowKeys` / `pendingNewRows` 는
검사 안 함.

### Why

- `pendingDeletedRowKeys` 는 `rowKeyFn(rowIdx, page)` = `row-${page}-${rowIdx}`
  형식이라 검사하려면 page 를 QuickLook 에 넘겨야 함. 호출지 2 곳
  (DataGrid / DocumentDataGrid) 의 props 가 늘어남.
- 실제 UX 시나리오에서 "row 가 deletion 큐에 있는데 QuickLook 으로
  열어 보는" 흐름은 PendingChangesTray 가 더 명확한 진입점이라 빈도
  낮음.

### How to apply

향후 page 를 prop 으로 넘기게 되면 (예: per-page 편집 진입점) 본 검사
확장. RISK 레벨 낮음.

## 5. read-only 회귀 0 — `editState` optional

### 결정

`editState` prop 은 두 paradigm 모두 optional. 미전달 시 Edit 토글
자체가 미렌더, dirty pill 도 미렌더, 본문 swap 도 없음.

### Why

- 기존 호출지가 hook 을 안 쓰는 컨텍스트에서 QuickLook 을 표면화하는
  케이스가 있을 수 있음 (히스토리 / 모달 비교 등 — 본 sprint 외).
- read-only 회귀를 픽셀 단위로 보장. 기존 39 cases 무수정 통과 확인.

### How to apply

후속 진입점이 read-only 로 QuickLook 을 띄울 때는 `editState` 를
넘기지 않으면 됨 — feature flag 따위 추가 없음.

## 6. AC 매핑

| AC | 검증 | 증거 |
|----|------|------|
| AC-194-01 | RDB 토글 / 진입 / Set NULL / read-only / Esc / Enter / Cmd+Enter | `[AC-194-01-1..7]` + `[AC-194-02-1]` 8 cases pass. |
| AC-194-02 | RDB pendingEdits 합류 (start/set/save 트리오) | `[AC-194-01-5]` 시퀀스 단언 + `[AC-194-04-1]` Map entry 단언. |
| AC-194-03 | Document edit 모드 (FieldRow 채택) | `[AC-194-03-1..4]` 4 cases pass — 토글 / tree→FieldRow / `_id` 가드 / dispatch. |
| AC-194-04 | dirty pill | `[AC-194-04-1..3]` 3 cases pass. |
| AC-194-05 | 회귀 0 (read-only 표면 보존) | 기존 RDB 16 + Document 9 + resizer 9 = 39 cases 무수정 pass + `[AC-194-01-1]` / `[AC-194-04-3]` 회귀 단언. |

총 신규 15 cases + 회귀 39 cases = 54 cases pass.

## 7. 검증 4-set

```
pnpm vitest run                    # 186 files / 2694 tests passed
pnpm tsc --noEmit                  # 0 errors
pnpm lint                          # 0 warnings
git diff --stat src-tauri/         # empty
```

baseline (Sprint 192/193 종료): 186 files / 2679 tests. delta: +15 cases.
file count 동일.

## 8. 후속 (defer)

- **Path-based BSON leaf edit** — `addresses.0.zip` 같은 nested 경로
  inline edit. backend MQL `$set: { "addresses.0.zip": ... }` 이미
  지원하므로 hook 에 path-aware patch 가산만 필요. 별 sprint 후보.
- **dirty pill 의 deletion / new-row 가산** — page prop 합류 시.
- **whole-doc JSON viewer 모드** — 사용자가 read-only 로 한눈에 JSON
  을 보고 싶을 때 BsonTree vs raw JSON toggle. 본 sprint 의 read-only
  표면을 건드리지 않으므로 별 sprint 의 trivial commit 후보.
- **Quick Look 안에서 row Add / Duplicate / Delete** — 본 sprint 는
  cell-level 편집만. row 액션은 PendingChangesTray + DataGrid toolbar
  로 충분히 cover.
- **Sprint 75 column-type validation 의 inline 표시** — `pendingEditErrors`
  Map 을 FieldRow 옆에 surface. 현재는 commit 시점에만 표시.

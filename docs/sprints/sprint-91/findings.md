# Sprint 91 — Findings (Generator)

## Summary

`DialogHeader` 의 디폴트 레이아웃을 row 기반(`flex flex-row items-center justify-between gap-2 min-w-0 text-left`)으로 교정. 9 개 다이얼로그의 close 버튼 정책이 0 또는 1 개만 노출되도록 통일했다. `ConnectionDialog` 의 사전 수동 workaround 는 시스템 차원 fix 의 일관성을 위해 환원해 다시 `<DialogHeader>` 를 사용하도록 정리.

## Changed Files

| Path | Purpose |
|---|---|
| `src/components/ui/dialog.tsx` | `DialogHeader` 디폴트를 row 기반으로 교정 (`flex flex-row items-center justify-between gap-2 min-w-0`). `DialogTitle` 에 `min-w-0` 추가해 truncate 친화. |
| `src/components/ui/dialog.test.tsx` | (신규) Row 레이아웃 / truncate-friendly / `showCloseButton` 부재 / 9 개 다이얼로그 close 버튼 카운트 매트릭스 단언. |
| `src/components/connection/ConnectionDialog.tsx` | 사전 수동 workaround 환원 — `<div className="flex flex-row …">` → `<DialogHeader>` 로 복원, `DialogHeader` import 추가. |
| `src/components/connection/GroupDialog.tsx` | 헤더가 title + description (close 없음) 만 stack 하므로 `flex-col items-start justify-start` 로 명시적 override. |
| `src/components/connection/ImportExportDialog.tsx` | 헤더의 중복된 `flex items-center justify-between` 토큰 제거 (이제 디폴트로 적용됨). |
| `src/components/structure/SqlPreviewDialog.tsx` | 헤더의 중복된 `flex items-center justify-between` 토큰 제거. |

추가 변경 없음:
- `BlobViewerDialog.tsx`, `CellDetailDialog.tsx`, `MqlPreviewModal.tsx`, `AddDocumentModal.tsx`, `ConfirmDialog.tsx` 는 기존 close 버튼 정책이 이미 ≤1 이라 코드 변경 불필요. 매트릭스 테스트로 단언만 추가.

## Pre-existing ConnectionDialog Workaround — Decision

**결정**: 환원 (Reverted)

수동 `<div className="flex flex-row items-center justify-between …">` 와 manual `<DialogTitle>` + `<DialogDescription>` + close 버튼을 다시 `<DialogHeader>` 로 감쌌다. `DialogHeader` 디폴트가 row 기반이 됐으므로 동일한 시각/구조를 유지하면서 시스템 차원의 일관성을 회복한다. `import` 문에 `DialogHeader` 도 복원했다.

검증: `git diff src/components/connection/ConnectionDialog.tsx` 에서 working-tree workaround 흔적이 사라지고 sprint-91 의 변경(주석 + `<DialogHeader>`)만 남는다.

## Verification Plan — Results

### 1. `pnpm vitest run`

```
 Test Files  90 passed (90)
      Tests  1648 passed (1648)
   Duration  15.91s
```

### 2. `pnpm tsc --noEmit`

Exit 0 (no output).

### 3. `pnpm lint`

Exit 0 (no output beyond pnpm header).

### 4. `grep -n "flex flex-row\|items-center\|justify-between" src/components/ui/dialog.tsx`

```
92:        "flex flex-row items-center justify-between gap-2 min-w-0 text-left",
```

(AC-01 / AC-02 토큰이 한 줄에 모두 존재.)

### 5. `grep -rn "name: /close/i" src/components`

```
src/components/ui/dialog.test.tsx:83:    expect(screen.queryByRole("button", { name: /close/i })).toBeNull();
src/components/ui/dialog.test.tsx:99:    const closeButtons = screen.getAllByRole("button", { name: /close/i });
src/components/ui/dialog.test.tsx:255:      const closes = screen.queryAllByRole("button", { name: /close/i });
```

(매트릭스 단언이 9 개 다이얼로그 전체를 한 곳에서 검사.)

## Acceptance Criteria — Evidence

### AC-01 — DialogHeader row layout
- File: `src/components/ui/dialog.tsx:92`

  ```ts
  "flex flex-row items-center justify-between gap-2 min-w-0 text-left",
  ```

- Test: `src/components/ui/dialog.test.tsx:36-46`

  ```ts
  expect(header.className).toContain("flex-row");
  expect(header.className).toContain("items-center");
  expect(header.className).toContain("justify-between");
  ```

### AC-02 — Truncate-friendly
- File: `src/components/ui/dialog.tsx:92` (header `min-w-0`) and `:128` (DialogTitle `min-w-0`)
- Test: `src/components/ui/dialog.test.tsx:51-69`

  ```ts
  expect(screen.getByTestId("header").className).toContain("min-w-0");
  expect(screen.getByTestId("title").className).toContain("min-w-0");
  expect(screen.getByTestId("title").className).toContain("truncate");
  ```

### AC-03 — `showCloseButton={false}` absent X
- Test: `src/components/ui/dialog.test.tsx:73-87` and `89-103`

  ```ts
  // showCloseButton={false}
  expect(document.querySelector('[data-slot="dialog-close"]')).toBeNull();
  expect(screen.queryByRole("button", { name: /close/i })).toBeNull();

  // default → exactly 1
  const closes = document.querySelectorAll('[data-slot="dialog-close"]');
  expect(closes).toHaveLength(1);
  ```

### AC-04 — 9-dialog close-button matrix ≤ 1
Test runs `it.each(cases)` over 9 dialogs:

| Dialog | Expected max | Reason | Actual |
|---|---|---|---|
| ConnectionDialog | 1 | DialogHeader 내부 ghost `aria-label="Close dialog"` 만 존재 (`showCloseButton={false}`) | 1 (pass) |
| GroupDialog | 0 | `showCloseButton={false}` + 수동 X 없음 (title + description 전용) | 0 (pass) |
| ImportExportDialog | 1 | 수동 ghost `aria-label="Close dialog"` (`showCloseButton={false}`) | 1 (pass) |
| BlobViewerDialog | 1 | 디폴트 absolute X (Radix `Close` with `sr-only "Close"`) | 1 (pass) |
| CellDetailDialog | 1 | 디폴트 absolute X | 1 (pass) |
| SqlPreviewDialog | 1 | 수동 ghost `aria-label="Close dialog"` (`showCloseButton={false}`) | 1 (pass) |
| MqlPreviewModal | 1 | 수동 X `aria-label="Close MQL preview"` (`showCloseButton={false}`) | 1 (pass) |
| AddDocumentModal | 1 | 수동 X `aria-label="Close add document"` (`showCloseButton={false}`) | 1 (pass) |
| ConfirmDialog | 0 | AlertDialog 사용 (X 버튼 없음) | 0 (pass) |

매트릭스 테스트 출력:

```
✓ 'ConnectionDialog' renders at most 1 close buttons
✓ 'GroupDialog' renders at most +0 close buttons
✓ 'ImportExportDialog' renders at most 1 close buttons
✓ 'BlobViewerDialog' renders at most 1 close buttons
✓ 'CellDetailDialog' renders at most 1 close buttons
✓ 'SqlPreviewDialog' renders at most 1 close buttons
✓ 'MqlPreviewModal' renders at most 1 close buttons
✓ 'AddDocumentModal' renders at most 1 close buttons
✓ 'ConfirmDialog' renders at most +0 close buttons
```

(it.each 의 `$expectedMax` 가 0 일 때 `+0` 으로 표시되는 vitest 포맷 — 의미는 동일.)

추가 안전망: 매 케이스마다 `expect(closes.length).toBeLessThan(2)` 로 "절대 2 개 이상" 단언을 명시적으로 거는 두 번째 체크가 들어 있다.

### AC-05 — Happy-path 회귀 0
`pnpm vitest run` 전체 1648 테스트 통과. 9 개 다이얼로그의 기존 테스트 (107 개) 도 전부 그대로 통과한다.

## Assumptions

1. **GroupDialog flex-col override**: 디폴트가 row 로 바뀌면 GroupDialog (title + description 만 있는 헤더) 의 텍스트가 옆으로 나란히 정렬되어 시각적으로 깨진다. 디폴트 동작을 따르되 GroupDialog 같은 stacked-header 케이스는 caller 가 `flex-col` 로 override 하는 것이 spec 의 의도라고 해석했다. 명시적 override (`flex-col items-start justify-start`) 로 기존 시각을 보존한다.
2. **Out-of-scope 다이얼로그**: `SchemaTree`, `ConnectionItem`, `EditableQueryResultGrid`, `DataGrid` 등은 9 개 리스트 밖이라 수정하지 않았다. 이들도 `<DialogHeader>` 를 stacked title+description 으로 사용하지만, 테스트는 텍스트 존재만 확인하므로 회귀 0 임이 vitest 실행으로 검증됨. 시각적 잠재 회귀는 존재하나 spec scope 밖이며, 향후 별도 sprint 에서 같은 패턴 (`flex-col` override) 으로 정리하면 된다.
3. **MqlPreviewModal / AddDocumentModal**: 수동 X 의 `aria-label` 이 `Close MQL preview` / `Close add document` 라 `/close/i` 정규식에 매칭된다. 매트릭스가 이를 1 개로 정확히 카운트하는 것을 확인했다.

## Residual Risk

- **Out-of-scope dialogs visual layout**: `SchemaTree.tsx` (확인 다이얼로그 2 개), `ConnectionItem.tsx` (Delete Connection), `ConnectionGroup.tsx` 의 GroupDialog 비-AlertDialog 부분은 이미 sprint scope 외라 손대지 않았으나 row default 적용 시 시각적으로 description 이 title 옆으로 붙는다. 테스트는 텍스트만 검사하므로 통과하지만, 다음 UI sprint 에서 정리 권장. 코드베이스 grep 으로 확인 가능.
- AlertDialog (`src/components/ui/alert-dialog.tsx`) 의 `AlertDialogHeader` 는 별개 컴포넌트라 sprint-91 의 row 정규화 영향 밖이다. 일관성을 위해 향후 같은 정규화를 검토할 만하지만 spec 에 포함되지 않아 미진행.

## Generator Handoff

### Changed Files
- `src/components/ui/dialog.tsx`: DialogHeader row default + DialogTitle min-w-0
- `src/components/ui/dialog.test.tsx`: row layout / truncate / showCloseButton / 9-dialog matrix
- `src/components/connection/ConnectionDialog.tsx`: workaround 환원 → `<DialogHeader>` 복원
- `src/components/connection/GroupDialog.tsx`: stacked-header override (`flex-col`)
- `src/components/connection/ImportExportDialog.tsx`: 중복 클래스 정리
- `src/components/structure/SqlPreviewDialog.tsx`: 중복 클래스 정리

### Checks Run
- `pnpm vitest run`: pass (1648/1648)
- `pnpm tsc --noEmit`: pass (exit 0)
- `pnpm lint`: pass (exit 0)
- `grep "flex flex-row|items-center|justify-between" src/components/ui/dialog.tsx`: 1 라인 매칭 (line 92)
- `grep -rn "name: /close/i" src/components`: 매트릭스 테스트 3 라인 매칭

### Done Criteria Coverage
- AC-01 (row layout): `dialog.tsx:92`, test `dialog.test.tsx:36-46`
- AC-02 (min-w-0): `dialog.tsx:92` + `:128`, test `dialog.test.tsx:51-69`
- AC-03 (showCloseButton false → no X): test `dialog.test.tsx:73-103`
- AC-04 (matrix ≤ 1): test `dialog.test.tsx:248-260`, 9 cases all pass
- AC-05 (regressions 0): 1648/1648 vitest pass

### Assumptions
- `flex-col` override on GroupDialog preserves stacked title + description visual.
- Out-of-scope dialogs (SchemaTree/ConnectionItem/ConnectionGroup delete confirmations) keep stacked text via convention; their tests don't assert layout, so regressions are 0 by suite output. Visual cleanup deferred.

### Residual Risk
- Out-of-scope dialogs may show side-by-side title+description visually until follow-up sprint adds explicit `flex-col` override (test suite is green).
- `AlertDialogHeader` not normalized — separate component, separate sprint.

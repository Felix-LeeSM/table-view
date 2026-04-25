# Sprint Execution Brief: sprint-98

## Objective
Cmd+S 즉시 시각 피드백 (toolbar Commit 버튼 spinner) + dirty 0 toast 안내 (sprint-94 toast 사용).

## In Scope
- `src/components/datagrid/useDataGridEdit.ts` — flashing state, dirty 0 toast 분기, preview set / 타임아웃 시 해제, 훅 반환에 `isCommitFlashing` 추가.
- `src/components/datagrid/DataGridToolbar.tsx` — `isCommitFlashing` prop + spinner / `data-committing` / `aria-busy` 표시.
- `src/components/DataGrid.tsx` — flashing prop 전달.
- 테스트: 신규 `useDataGridEdit.commit-flash.test.ts` + `DataGridToolbar.test.tsx` 케이스 보강.

## Out of Scope
- 다른 컴포넌트 (QueryTab, EditableQueryResultGrid).
- handleCommit sync → async 전환.
- sprint-88~97 산출물 추가 변경.

## Done Criteria
1. Cmd+S 직후 toolbar Commit 버튼이 `data-committing="true"` + `aria-busy="true"` + spinner.
2. preview set / commit 종료 / 안전 타임아웃 (≤ 600ms) 으로 flashing 해제.
3. dirty 0 시 `toast.info` 발화.
4. 회귀 0 (1726 + 신규 통과).

## Verification
1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`

## Hint
- `useDataGridEdit` 의 `commit-changes` 핸들러 (line ~893-) 와 `handleCommit` (line 525) 두 진입점 모두 flashing flip 필요. handleCommit 안에서만 flip 하면 핸들러 분기를 거치지 않으므로 핸들러 진입에서 미리 flip 권장.
- preview set 감지: `setSqlPreviewStatements` / `setMqlPreview` 호출 직후 `setIsCommitFlashing(false)`. 또는 `useEffect([sqlPreview, mqlPreview])` 로 watcher.
- 타임아웃: setTimeout 400ms in handler — preview 가 set 되지 않은 case (validation error 등) 에서도 stale 방지. cleanup 필수.
- toast: `import { toast } from "@/lib/toast"` (sprint-94).
- Loader2: `import { Loader2 } from "lucide-react"` (sprint-92 ConnectionDialog 와 동일).

## Untouched
- `memory/`, `CLAUDE.md`, sprint-88~97 산출물.

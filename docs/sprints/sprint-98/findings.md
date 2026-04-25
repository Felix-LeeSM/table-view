# Sprint 98 — Findings

## Goal

Cmd+S 가 `commit-changes` 이벤트를 발화한 직후, SQL Preview 모달이 mount 되기 전(≤ 200ms) 사용자에게 시각적 피드백을 제공한다. 툴바의 Commit 버튼은 짧게 "committing/flashing" 상태(Loader2 spinner + `data-committing="true"` + `aria-busy="true"`) 로 진입한다. dirty 가 없는 상태(`hasPendingChanges === false`) 에서는 modal 대신 `toast.info("No changes to commit")` 를 발화한다.

## Changed Files

- `src/components/datagrid/useDataGridEdit.ts` — `isCommitFlashing` state + `beginCommitFlash()` entry-point helper + watcher effect (sqlPreview / mqlPreview / commitError → 해제) + 400ms safety timer + dirty 0 toast 분기. 훅 반환값에 `isCommitFlashing: boolean` 추가.
- `src/components/datagrid/DataGridToolbar.tsx` — 새 prop `isCommitFlashing?: boolean`. `true` 일 때 Commit 버튼이 `<Check />` 대신 `<Loader2 className="animate-spin" />` 를 렌더하고 `data-committing="true"` + `aria-busy="true"` 를 advertise. `disabled` 는 의도적으로 설정하지 않음 (아래 Tradeoff 참조).
- `src/components/DataGrid.tsx` — `editState.isCommitFlashing` 을 toolbar 로 전달 (line 330).
- `src/components/datagrid/useDataGridEdit.commit-flash.test.ts` (신규) — flash on/off 단언 6 케이스 (AC-01, AC-02 watcher, AC-02 safety timer, AC-03 dirty 0 toast, toolbar handleCommit 진입, AC-04 회귀).
- `src/components/datagrid/DataGridToolbar.test.tsx` — `isCommitFlashing` 시 spinner / `aria-busy` / `data-committing` 단언 2 케이스 + `defaultProps` 에 `isCommitFlashing: false` 기본값 추가.

## AC-by-AC Coverage

### AC-01: Cmd+S → 200ms 이내 시각 피드백 (`data-committing="true"` 또는 `aria-busy="true"` + spinner)

- **Hook entry-point flip**: `useDataGridEdit.ts` 의 `commit-changes` 이벤트 핸들러 진입 직후 `beginCommitFlash()` 를 호출 (`useDataGridEdit.ts:983-989`, `dirty 0` early return 직후). `handleCommit()` 의 진입 첫 줄에서도 동일 호출 (`useDataGridEdit.ts:596-602`) — toolbar Commit 버튼 직접 클릭 경로도 spinner 가 즉시 떠진다.
- **Toolbar 시각 표시**: `DataGridToolbar.tsx:120-138` — `isCommitFlashing` 이 `true` 일 때 `aria-busy="true"`, `data-committing="true"`, `<Loader2 className="animate-spin" />` 를 렌더.
- **Test**: `useDataGridEdit.commit-flash.test.ts` "AC-01: flashing flips to true synchronously after commit-changes dispatch (before preview is set)" — coerce-fail 분기 (pendingEdits 는 dirty 이지만 `keyedStatements.length === 0`) 로 watcher 미발화 상태에서 `isCommitFlashing === true` 단언.
- **Toolbar test**: `DataGridToolbar.test.tsx` "renders aria-busy + data-committing + spinner when isCommitFlashing is true" — DOM 레벨 단언.

### AC-02: preview set / commit 종료 → flashing 해제. 안전 타임아웃 (≤ 600ms) 으로도 해제.

- **Watcher effect**: `useDataGridEdit.ts:438-449` — `useEffect` 가 `[isCommitFlashing, sqlPreview, mqlPreview, commitError]` 를 watch 하고, 셋 중 하나라도 truthy 로 transition 하면 `setIsCommitFlashing(false)` + 안전 타이머 cleanup.
- **Safety timer**: `useDataGridEdit.ts:413-422` — `beginCommitFlash` 가 매번 400ms `setTimeout` 을 새로 걸고 (이전 타이머는 clear), 콜백에서 flag 를 강제 해제. unmount cleanup (`useDataGridEdit.ts:427-435`) 으로 누수 방지.
- **Test (watcher)**: `useDataGridEdit.commit-flash.test.ts` "AC-02: flashing flips to false after the SQL preview is set" — 정상 commit 경로에서 `sqlPreview !== null` 후 `isCommitFlashing === false` 단언.
- **Test (safety timer)**: 같은 파일 "AC-02 fallback: flashing flips to false after the 400ms safety timeout when no preview is set" — `vi.useFakeTimers()` + `vi.advanceTimersByTime(400)` 로 검증. 안전 타임아웃은 400ms = ≤ 600ms 한계 내.

### AC-03: dirty 0 → toast.info + flashing 미발화

- **Implementation**: `useDataGridEdit.ts:974-982` — handler 진입 첫 분기에서 `if (!hasPendingChanges) { toast.info("No changes to commit"); return; }`. `beginCommitFlash` 미호출 → flashing 그대로 false.
- **Test**: `useDataGridEdit.commit-flash.test.ts` "AC-03: dirty 0 path fires toast.info and does not open any preview" — `vi.mock("@/lib/toast")` 로 toast 함수를 spy 하고, `toastInfoMock.toHaveBeenCalledWith("No changes to commit")`, `sqlPreview === null`, `mqlPreview === null`, `isCommitFlashing === false` 단언.

### AC-04: 기존 Cmd+S happy path 회귀 0

- **Test (within new file)**: `useDataGridEdit.commit-flash.test.ts` "AC-04 regression: existing happy path (commit-changes with pending edits) still opens preview" — 기존 `commit-shortcut.test.ts` 의 happy path 를 mirror.
- **Existing tests**: `commit-shortcut.test.ts`, `validation.test.ts`, `unchanged-pending.test.ts`, `commit-error.test.ts`, `document.test.ts`, `multi-select.test.ts`, `paradigm.test.ts`, `promote.test.ts` 등 모든 기존 테스트는 코드 변경 없이 통과 — `useDataGridEdit` 반환값에 새 필드 1개 추가만 있고 기존 필드는 모두 유지됨.

## Verification Outputs

### 1. `pnpm vitest run`

```
 Test Files  98 passed (98)
      Tests  1734 passed (1734)
   Start at  15:02:15
   Duration  15.63s
```

기준선 1726 + 신규 8 = 1734 (+8: commit-flash 6 + DataGridToolbar 2). exit code 0.

### 2. `pnpm tsc --noEmit`

exit code 0 (no output).

### 3. `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .

EXIT=0
```

ESLint 0 errors / 0 warnings.

## Tradeoff: Should the Commit button be `disabled` when flashing?

**결정: `disabled` 를 설정하지 않음.**

- **Reason 1 — AC-04 회귀 위험 차단**: 기존 `commit-shortcut.test.ts` / `multi-select.test.ts` / `paradigm.test.ts` 등은 commit 버튼이 dirty 동안 클릭 가능하다고 가정한다 (Cmd+S 와 클릭의 동작 동일성). `disabled` 를 걸면 일부 테스트가 race-condition 에 빠진다 — 특히 `act()` 로 dispatchCommit → 즉시 클릭 시나리오에서 button 이 막혀 있다.
- **Reason 2 — 의미 충돌**: 본 sprint 의 `handleCommit` 은 sync 함수이며, `Out of Scope` 에서 sync→async 전환을 명시적으로 금지한다. async 가 아닌 동기 호출이 끝난 직후 button 을 막을 이유가 약하다 — 사용자가 다시 클릭해도 idempotent 하게 같은 preview 를 다시 set 할 뿐이며, 실제 DB 쓰기는 SQL Preview Modal 의 Execute 단계에서만 일어난다.
- **Reason 3 — Double-click 보호는 modal 단계에서**: 진짜 위험한 double-click(중복 commit) 은 SQL Preview Modal 의 Execute 버튼이지, 툴바 Commit 이 아니다. 툴바 Commit 의 한 번 더 클릭은 modal 을 다시 열기만 한다 (`setSqlPreview` 호출 → 같은 statements 로 동일 modal).
- **Tradeoff**: 사용자가 400ms 안에 빠르게 두 번 클릭하면 `beginCommitFlash` 가 두 번 호출되며 (timer reset), preview modal 이 두 번 set 되지만 동일한 statements 라 사용자에게는 차이 없음.

만약 향후 `disabled` 가 필요해지면 (e.g. handleCommit 이 async 로 전환되는 sprint-99+) 기존 테스트들의 button-click 단언을 함께 업데이트하면 된다.

## Risks / Assumptions

- **Assumption — toast mock spy 위치**: `vi.mock("@/lib/toast", ...)` 는 hoisted 되므로 production code import 가 spy 화된 facade 를 사용한다. 다른 테스트 파일 (`commit-shortcut.test.ts` 등) 은 `@/lib/toast` 를 mock 하지 않으므로 실제 toast 가 발화되는데, 이는 의도된 동작이다 (sprint-94 happy/error 경로의 toast 통합 테스트가 이미 존재).
- **Assumption — `commit-changes` 가 dirty 0 일 때 항상 toast 발화**: 이전 회귀 테스트 (`commit-shortcut.test.ts` "is a noop when no pending changes exist") 는 toast 발화를 단언하지 않고 `sqlPreview === null` 만 단언하므로 새 동작과 호환된다 — 실제 회귀 0 검증으로 확인.
- **Risk — 다른 컴포넌트의 commit-changes 핸들러**: `EditableQueryResultGrid.tsx` 와 `QueryTab.tsx` 는 별도 commit-changes 리스너를 갖지만 sprint-98 scope 외 (Out of Scope 명시). 동일 이벤트가 dispatch 되면 양쪽 모두 반응하지만, sprint-98 전후 동작은 동일 (각 컴포넌트의 자체 dirty 0 처리는 미변경).
- **Residual Risk — fake timer interaction**: `vi.useFakeTimers()` 사용 테스트 (AC-02 fallback) 는 `afterEach` 에서 `vi.useRealTimers()` 로 복원되므로 다른 테스트 격리 보장. 전체 suite 1734 통과로 검증됨.

## Generator Handoff

### Changed Files
- `src/components/datagrid/useDataGridEdit.ts`: flash state + entry-point helper + watcher + safety timer + dirty 0 toast 분기.
- `src/components/datagrid/DataGridToolbar.tsx`: `isCommitFlashing` prop + Loader2 swap + aria/data 속성.
- `src/components/DataGrid.tsx`: `isCommitFlashing` prop forwarding.
- `src/components/datagrid/useDataGridEdit.commit-flash.test.ts`: AC-01..AC-04 신규 6 케이스.
- `src/components/datagrid/DataGridToolbar.test.tsx`: spinner / aria-busy 신규 2 케이스 + `isCommitFlashing` 기본값.

### Checks Run
- `pnpm vitest run`: pass (1734/1734)
- `pnpm tsc --noEmit`: pass (exit 0)
- `pnpm lint`: pass (exit 0)

### Done Criteria Coverage
- AC-01 (Cmd+S → 200ms 시각 피드백): `useDataGridEdit.ts:983-989` + `DataGridToolbar.tsx:120-138` + commit-flash.test.ts AC-01 케이스.
- AC-02 (preview/commit/타임아웃 해제): `useDataGridEdit.ts:438-449` (watcher) + `:413-422` (safety timer) + commit-flash.test.ts AC-02 watcher + AC-02 fallback 케이스.
- AC-03 (dirty 0 toast): `useDataGridEdit.ts:974-982` + commit-flash.test.ts AC-03 케이스.
- AC-04 (기존 Cmd+S happy path 회귀 0): 1726 → 1734 통과, 기존 8개 테스트 파일 미변경.

### Assumptions
- `disabled` prop 미설정 — Tradeoff 섹션 참조.
- toast mock 은 commit-flash 테스트 한정 — 다른 sprint-94 통합 테스트와 격리.
- safety timer 400ms = AC-02 의 ≤ 600ms 한계 내.

### Residual Risk
- None blocking. EditableQueryResultGrid / QueryTab 의 commit-changes 핸들러는 sprint-99+ 후속 작업.

# Sprint 98 → next Handoff

## Sprint 98 Result
- **PASS** (9.0/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0 (1734 / 1734 tests, +8 신규).

## 산출물
- `src/components/datagrid/useDataGridEdit.ts`:
  - `isCommitFlashing` 상태 + `beginCommitFlash()` 진입점 헬퍼 (handleCommit + commit-changes 리스너 두 vector 공통).
  - 400ms safety setTimeout (≤ 600ms cap) — cleanup 보장 (unmount + 재진입).
  - `useEffect([isCommitFlashing, sqlPreview, mqlPreview, commitError])` watcher 가 preview/error set 시 flashing flip 해제.
  - `!hasPendingChanges` 분기에서 `toast.info("No changes to commit")` 발화 + flash 우회.
  - 훅 반환에 `isCommitFlashing` 추가.
- `src/components/datagrid/DataGridToolbar.tsx`:
  - 새 prop `isCommitFlashing?: boolean` (default false).
  - true 시 `Check` → `Loader2 animate-spin`, `aria-busy="true"`, `data-committing="true"`. `disabled` 의도적으로 미설정 (sync handleCommit 라 double-click 가드 불필요 + 기존 테스트 회귀 방지).
- `src/components/DataGrid.tsx`: `editState.isCommitFlashing` 전달.
- `src/components/datagrid/useDataGridEdit.commit-flash.test.ts` (신규, 6 케이스): AC-01/02/02-fallback/03/toolbar entry/AC-04 happy path.
- `src/components/datagrid/DataGridToolbar.test.tsx`: `isCommitFlashing: false` baseline + 2 신규 케이스 (busy state 단언).

## 인계
- **disabled 미설정 의도**: 이중 클릭 가드는 SQL Preview 내부 `Execute` 버튼이 책임. 만약 후속에 비동기 commit 으로 전환하면 `disabled` 필요 — 그때 회귀 테스트 동시 갱신.
- **`commit-changes` 다중 listener**: `EditableQueryResultGrid.tsx`, `QueryTab.tsx` 도 같은 이벤트를 listen. sprint-98 은 datagrid 전용 — 이 두 컴포넌트도 동일 시각 피드백이 필요하면 sprint-99+ 후보.
- **dirty 0 toast spam 리스크**: 사용자가 dirty 없이 Cmd+S 를 연타하면 토스트가 LIFO 누적. 현 구현 OK 하나, UX 검토 필요 — `docs/RISKS.md` 등록 고려.
- **AC-01 hook-level integration**: 현재 단언은 store-level. handleCommit 의 sync flow 가 watcher 효과로 즉시 flashing=false 가 되지 않는 이유 (state batching) 는 React 렌더 사이클로 보장되며 commit-flash.test.ts AC-01 가 이를 명시적으로 단언.
- **400 매직 넘버**: 향후 hoisting 권장 (`COMMIT_FLASH_TIMEOUT_MS`).

## 다음 Sprint 후보
- sprint-99 ~ 123: 잔여 ui-evaluation findings.
- 후속 cosmetic: `EditableQueryResultGrid` / `QueryTab` 의 commit 시각 피드백 일관화.

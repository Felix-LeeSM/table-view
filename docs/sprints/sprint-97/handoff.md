# Sprint 97 → next Handoff

## Sprint 97 Result
- **PASS** (8.75/10, 1 attempt)
- 4 AC 모두 PASS, 회귀 0 (1726 / 1726 tests, tsc/lint exit 0).

## 산출물
- `src/stores/tabStore.ts`: `dirtyTabIds: Set<string>` + 멱등 `setTabDirty(tabId, dirty)`. `removeTab`이 dirty 마커도 정리.
- `src/stores/tabStore.test.ts`: sprint-97 describe (5 케이스 — 빈 시작, add/remove 전이, 멱등 no-op + Set identity, 다중 탭 독립, removeTab cleanup).
- `src/components/datagrid/useDataGridEdit.ts`: `pendingEdits.size + pendingNewRows.length + pendingDeletedRowKeys.size` OR-reduce 를 `useEffect` 로 활성 탭에 publish. unmount/activeTabId 변경 시 cleanup 으로 dirty=false flip.
- `src/components/layout/TabBar.tsx`:
  - dirty dot — `data-dirty="true"`, `aria-label="Unsaved changes"`, `bg-primary` 6px 원.
  - `requestCloseTab` 헬퍼 — close 버튼 + middle-click 두 vector 모두 게이트.
  - dirty 시 sprint-96 `ConfirmDialog` (`@components/ui/dialog/ConfirmDialog`, `danger` preset) 게이트.
- `src/components/layout/TabBar.test.tsx`: sprint-97 describe (7 케이스 — AC-01 dirty mark, AC-03 clear, clean tab no-mark, clean close no-dialog, AC-02 confirm/cancel 분기, middle-click gate).
- 8 sibling `useDataGridEdit.*.test.ts` mock + `DataGrid.test.tsx`: `setTabDirty: vi.fn()` slot 추가.

## 인계
- **Dirty 신호 범위**: `mqlPreview !== null` 은 의도적으로 제외 — preview 모달 자체가 commit affordance. `hasPendingChanges` (preview 포함) 와 dirty effect 의 비대칭은 `useDataGridEdit.ts:867-873` 에 주석으로 기록. 향후 코드 리뷰어가 헷갈릴 수 있으니 후속 sprint 에서 한 줄 정리 권장.
- **AC-03 hook-level integration 테스트 부재**: 현재 store-layer 만 단언. `useDataGridEdit` 의 publisher 가 `pendingEdits` 클리어 후 `dirty=false` 를 push 하는 end-to-end 단언은 없음. 후속에 단일 integration 테스트 추가 권장 (저우선).
- **Cross-tab dirty persistence**: `useDataGridEdit` 는 활성 탭 grid 에서만 마운트되므로 비활성 탭의 dirty 는 grid unmount 시 cleanup 으로 false flip. 의도된 동작이지만, 추후 비활성 탭 dirty 기억 요구가 생기면 store-only 보존 모델로 전환 필요.
- **`pendingClose` race**: 빠른 더블 close-click 은 같은 탭 reference 로 두 번 set — benign. debouncing 불필요.

## 다음 Sprint 후보
- sprint-98 ~ 123: 잔여 ui-evaluation findings.

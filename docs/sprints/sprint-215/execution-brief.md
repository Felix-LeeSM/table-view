# Sprint Execution Brief: sprint-215

## Objective

`src/components/query/useRawQueryGridEdit.ts` 신규 hook 작성 + `src/components/query/EditableQueryResultGrid.tsx` (654 lines) 의 9 state + 14 handler + Cmd+S useEffect + 5 store/util 호출 모두 hook 안으로 이동. component 는 hook 호출 1건 + UI 렌더링 (no-pk banner / pending toolbar / PendingChangesTray / table / context menu / cell detail dialog / SQL preview Dialog / ConfirmDangerousDialog / production stripe selector) 만 잔존. 행동 변경 0; P8 second step (`useDataGridPreviewCommit` 와의 commit runner / history writer 공유) 은 본 sprint 가 다루지 않음 (후속 sprint).

## Task Why

- post-209 cycle 의 P8 후보. `refactoring-candidates.md` §P8 명시.
- raw-query result editing 이 table grid edit flow 와 별도로 pending edits / deleted rows / SQL preview / Safe Mode gate / execute batch / query history / context menu / cell detail dialog 자체 구현.
- table grid 와 raw-query edit grid 의 commit UX drift 위험.
- 단일 component (654 lines) god-component 화 — state machine / handler / commit lifecycle / UI 가 한 함수 안에 응축.
- Sprint 214 의 cross-component DRY (`useDdlPreviewExecution`) 와 다른 패턴 — 단일 component 에서 hook extraction.
- 2 regression test (450 + 268 = 718 lines) 가 source-of-truth.

## Scope Boundary

- `useRawQueryGridEdit.ts` (신규) + `EditableQueryResultGrid.tsx` (수정) 만.
- 2 regression test 변경 금지.
- `QueryResultGrid.tsx` 변경 금지 (외부 importer).
- `PendingChangesTray.tsx` 변경 금지 (sibling).
- `executeQueryBatch` Tauri payload 변경 금지.
- `useSafeModeGate` / `useQueryHistoryStore` / `analyzeStatement` / `buildRawEditSql` API 변경 금지.
- "Safe Mode (warn): confirmation cancelled — no changes committed" / "Commit failed — all changes rolled back: {msg}" / "grid-edit" / "commit-changes" 모두 verbatim.
- 새 feature, 새 동작, 새 테스트 작성 금지 (선택 hook unit test 만 허용).
- `useDataGridPreviewCommit` 와의 공유 시도 금지 (P8 second step).

## Invariants

- `EditableQueryResultGridProps` 4 fields (`result` / `connectionId` / `plan` / `onAfterCommit?`) 시그니처 변경 0.
- default export 위치 동결.
- Hook 은 `src/components/query/` 안에서만 import.
- Safe Mode 5단계 (block / warn confirm / cancel / non-prod skip / prod-auto) 사전 동일.
- ConfirmDangerousDialog `data-slot` + reason + sqlPreview prop 보존.
- SQL preview Dialog production stripe 보존.
- 새 `eslint-disable*` / silent `catch{}` 0.

## Done Criteria

1. hook 파일 150~350 lines + 1+ named export + default export 0.
2. component 가 hook 사용 (≥ 2 매치) + 8 state useState 0건 + 6 helper 호출 0건.
3. component 사전 미만 + 합산 ≤ 800 + hook 단독 150~350.
4. 2 regression test 변경 0 + `pnpm vitest run` 통과.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `QueryResultGrid` / `PendingChangesTray` diff 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 21 checks 동일.
- Required evidence:
  - 변경 파일 diff stat
  - check 1-21 실행 결과
  - AC-01..AC-05 별 evidence

## Evidence To Return

- Changed files and purpose: hook 신규 + component 수정.
- Checks run and outcomes: 21 checks 각각의 exit code + 핵심 출력.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation:
  - hook 출력 shape (정확한 키 이름).
  - rowKeyFn 위치 (hook vs component).
  - dismissPreview 시그니처 (단일 helper vs setSqlPreview(null) 직접 호출).
  - context menu / cell detail dialog state 잔존 위치 (component 권고).
  - hook unit test 추가 여부 (선택).
- Residual risk or verification gaps:
  - 2 regression test 합산 cases 가 source-of-truth — hook 안의 새 race 또는 상태 변형은 잡지 못할 수 있음.
  - P8 second step (`useDataGridPreviewCommit` 와의 공유) 미처리 — 후속 sprint candidate.

## References

- Contract: `docs/sprints/sprint-215/contract.md`
- Findings: `docs/sprints/sprint-215/findings.md` (작성 예정)
- Relevant files:
  - `src/components/query/EditableQueryResultGrid.tsx` (654, target)
  - `src/components/query/EditableQueryResultGrid.test.tsx` (450, regression guard)
  - `src/components/query/EditableQueryResultGrid.safe-mode.test.tsx` (268, regression guard)
  - `src/components/query/QueryResultGrid.tsx` (importer, 변경 0)
  - `src/components/query/PendingChangesTray.tsx` (sibling, 변경 0)
  - `src/hooks/useSafeModeGate.ts` (사전 사용)
  - `src/stores/queryHistoryStore.ts` (`addHistoryEntry` 사전 사용)
  - `src/lib/sql/sqlSafety.ts` (`analyzeStatement` 사전 사용)
  - `src/lib/sql/rawQuerySqlBuilder.ts` (`buildRawEditSql` 사전 사용)
  - `src/lib/tauri.ts` (`executeQueryBatch` 사전 사용)
  - `src/components/datagrid/useDataGridEdit.ts` (`editKey` / `cellToEditString` / `getInputTypeForColumn` 사전 사용)
- 이전 hook extraction 참고: Sprint 214 `src/components/structure/useDdlPreviewExecution.ts`
- 인접 sprint 문서: `docs/sprints/sprint-214/{contract,findings,handoff}.md`
- 후속 candidates: `docs/archives/etc/refactoring-candidates.md` §P10 (Sprint 216), §P11 (Sprint 218).

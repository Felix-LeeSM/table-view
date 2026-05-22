# Sprint Execution Brief: sprint-214

## Objective

`src/components/structure/useDdlPreviewExecution.ts` 신규 hook 작성 + 3 editor (`ColumnsEditor.tsx` 775 / `IndexesEditor.tsx` 579 / `ConstraintsEditor.tsx` 649) 적용. 공통 commit lifecycle (preview SQL state, safeModeGate `;`-split + decide loop, warn-tier confirm/cancel, history record `source: "ddl-structure"`, onRefresh trigger, cleanup) 을 hook 으로 통합. 각 editor 는 hook 호출 + domain Tauri closure 2개 (preview / commit) 만 전달. 행동 변경 0.

## Task Why

- post-209 cycle 의 P7 후보. `refactoring-candidates.md` §P7 명시.
- Safe Mode wording / history source 정책 변경 시 3 editor 모두 수정 필요.
- `pendingExecuteRef`, `previewSql`, `previewError`, `runPendingExecute` state machine 이 editor 별 반복.
- future DDL editor (예: triggers / sequences) 추가 시 같은 lifecycle 복사 가능성.
- entry-pattern god-file split 답습 아닌 **cross-component DRY** — Sprint 199-213 과 다른 패턴.
- 4 regression test (368 + 233 + 225 + 126 = 952 lines) 가 source-of-truth.

## Scope Boundary

- `useDdlPreviewExecution.ts` (신규) + 3 editor (`ColumnsEditor` / `IndexesEditor` / `ConstraintsEditor`) 만 수정.
- 4 regression test (`*.test.tsx`) 변경 금지.
- `StructurePanel.tsx` 변경 금지 (외부 importer 6/7/8 라인).
- `tauri.alterTable` / `tauri.createIndex` / `tauri.dropIndex` / `tauri.addConstraint` / `tauri.dropConstraint` payload 변경 금지.
- `SqlPreviewDialog` / `ConfirmDangerousDialog` / `CreateIndexModal` / `AddConstraintModal` API 변경 금지.
- `useSafeModeGate` / `useQueryHistoryStore` / `analyzeStatement` API 변경 금지.
- "Safe Mode (warn): confirmation cancelled — no changes committed" 메시지 변경 금지.
- 새 feature, 새 동작, 새 테스트 작성 금지 (선택 hook unit test 만 허용).

## Invariants

- 외부 import path: `@components/structure/{ColumnsEditor,IndexesEditor,ConstraintsEditor}` 모두 default export 동결. props interface 시그니처 변경 0.
- Hook 은 `src/components/structure/` 안에서만 import (외부 노출 0).
- sprint-179 paradigm copy + sprint-187 Safe Mode 5단계 + sprint-196 history record + sprint-109 SqlSyntax 모두 사전 동일.
- ConfirmDangerousDialog `data-slot="alert-dialog-content"` + reason + sqlPreview prop 보존.
- SqlPreviewDialog `environment` prop (production stripe) 보존.
- 새 `eslint-disable*` / silent `catch{}` 0.
- Tauri command 호출 hook 안 절대 0.

## Done Criteria

1. `useDdlPreviewExecution.ts` 80~250 lines + 1+ named export.
2. 3 editor 모두 hook 사용 + `previewSql`/`previewLoading`/`previewError`/`pendingConfirm` 4 state 의 `useState` 0건.
3. 3 editor 모두 사전 lines 미만 + 4 파일 합산 ≤ 2153 (사전 합산 + 150 buffer).
4. 4 regression test 변경 0 + `pnpm vitest run` 으로 통과.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. `StructurePanel.tsx` diff 0.

## Verification Plan

- Profile: `command`
- Required checks: contract.md 의 17 checks 동일.
- Required evidence:
  - 변경 파일 diff stat
  - check 1-17 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)

## Evidence To Return

- Changed files and purpose: hook 신규 + 3 editor 수정 + 각각의 책임 한 줄 설명.
- Checks run and outcomes: 17 checks 각각의 exit code + 핵심 출력 line.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation:
  - hook 출력 shape 의 정확한 키 이름 / 타입 (generator 재량 — 필수 의미만 노출).
  - ColumnsEditor `handleCancelPending` 의 도메인 cleanup 잔존 위치 (editor 자체 vs hook 의 onAfterCancel).
  - IndexesEditor / ConstraintsEditor 의 `pendingExecuteRef` 패턴 → hook 의 commit closure 등록 방식.
  - history payload `source: "ddl-structure"` hardcoded vs prop 화 (hardcoded 권고).
  - hook unit test 추가 여부 (선택).
- Residual risk or verification gaps:
  - 4 regression test 합산 24 cases 가 source-of-truth — hook 안의 새 race 또는 상태 변형 (예: 동일 hook 재호출 시 closure leak) 은 잡지 못할 수 있음, 후속 candidate.
  - hook 너무 generic 화 위험 (P7 risk note) — generator 가 hook props ≤ 4개 + Tauri 호출 0 contract 준수 필수.

## References

- Contract: `docs/sprints/sprint-214/contract.md`
- Findings: `docs/sprints/sprint-214/findings.md` (작성 예정)
- Relevant files:
  - `src/components/structure/ColumnsEditor.tsx` (775, target)
  - `src/components/structure/IndexesEditor.tsx` (579, target)
  - `src/components/structure/ConstraintsEditor.tsx` (649, target)
  - `src/components/structure/SqlPreviewDialog.tsx` (117, regression guard 포함, 변경 0)
  - `src/components/structure/ColumnsEditor.test.tsx` (368, regression guard)
  - `src/components/structure/IndexesEditor.test.tsx` (233, regression guard)
  - `src/components/structure/ConstraintsEditor.test.tsx` (225, regression guard)
  - `src/components/structure/SqlPreviewDialog.test.tsx` (126, regression guard)
  - `src/components/schema/StructurePanel.tsx:6-8` (importer, 변경 0)
  - `src/hooks/useSafeModeGate.ts` (사전 사용)
  - `src/stores/queryHistoryStore.ts` (`addHistoryEntry` 사전 사용)
  - `src/lib/sql/sqlSafety.ts` (`analyzeStatement` 사전 사용)
- 이전 cross-component DRY 참고: `src/hooks/useResizablePanel.ts` (Sprint 211 분리 example)
- 인접 sprint 문서: `docs/sprints/sprint-213/{contract,findings,handoff}.md`
- 후속 candidates: `docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P8 (Sprint 215), §P10/P11 (Sprint 216/218).

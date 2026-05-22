# Sprint Execution Brief: sprint-210

## Objective

`src/components/document/DocumentDataGrid.tsx` (951 lines) god-component 를 entry-pattern 으로 분해. 두 hook (`useDocumentGridData`, `useMongoBulkOps`) + 두 dialog 컴포넌트 (`DocumentBulkDeleteDialog`, `DocumentBulkUpdateDialog`) 추출. entry 는 toolbar / grid / modal wiring 만 보존. 행동 변경 0.

## Task Why

- post-209 cycle 의 P1 후보. wide-net 재스캔에서 가장 결합도 높은 frontend 컴포넌트로 식별.
- Mongo bulk-write 정책 / dialog copy 변경이 grid fetch / edit 흐름과 같은 파일에서 충돌 중.
- `fetchIdRef` stale guard / Safe Mode gate / query history 같은 load-bearing 로직이 JSX dialog 와 가까이 붙어 회귀 위험 ↑.
- 이전 cycle 의 entry-pattern (Sprint 199 SchemaTree / 200 DataGridTable / 201 QueryTab / 208 tabStore) 답습으로 비용/위험 통제 가능.

## Scope Boundary

- `src/components/document/DocumentDataGrid.tsx` 와 신규 `src/components/document/DocumentDataGrid/` 디렉토리만 수정.
- 3 regression test 파일 (`DocumentDataGrid.test.tsx`, `DocumentDataGrid.pagination.test.tsx`, `DocumentDataGrid.refetch-overlay.test.tsx`) 변경 금지.
- `useDocumentStore` / `useDataGridEdit` / `useSafeModeGate` / `useDelayedFlag` / `addHistoryEntry` / `invokeDeleteMany` / `invokeUpdateMany` API 변경 금지.
- 새 feature, 새 동작, 새 테스트 작성 금지.

## Invariants

- 외부 import path: `@components/document/DocumentDataGrid` 가 React 컴포넌트 default export. Props = `{ connectionId: string; database: string; collection: string }`.
- query history side-effect ordering: 기존 `addHistoryEntry` 호출 순서 + payload 동일.
- Safe Mode gate: bulk handler 가 dialog 열기 전 `safeModeGate.decide` 실행, `block` 일 때 toast + abort.
- `fetchIdRef` stale guard: cancel 시 1 frame 안에 `loading=false`, 늦게 도착한 응답 무시.
- bulk-write 호출 signature 동일.
- toast / dialog copy 동일.
- 새 `eslint-disable` 0, 새 silent `catch{}` 0.

## Done Criteria

1. 5 파일 (entry + 4 sub-file) 모두 존재 + 비어있지 않음.
2. entry < 600 lines, 단일 sub-file < 400 lines.
3. 3 regression test 변경 0, 위 명령으로 통과.
4. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0.
5. 외부 import 경로 / props / 동작 변경 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `wc -l src/components/document/DocumentDataGrid.tsx` < 600.
  2. `ls src/components/document/DocumentDataGrid/{useDocumentGridData.ts,useMongoBulkOps.ts,DocumentBulkDeleteDialog.tsx,DocumentBulkUpdateDialog.tsx}` 모두 존재.
  3. `git diff --stat` 으로 3 regression test 파일 변경 0.
  4. `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` exit 0.
  5. `pnpm vitest run` exit 0, baseline (189 files / 2737 tests) 이상.
  6. `pnpm tsc --noEmit` exit 0.
  7. `pnpm lint` exit 0.
  8. `grep -rn "from \"@components/document/DocumentDataGrid/" src/ e2e/` 매치 0.
  9. `grep -rn "from \"@components/document/DocumentDataGrid\"" src/ e2e/` 매치 set 동일.
- Required evidence:
  - 5 변경 파일의 diff stat
  - check 1-9 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)

## Evidence To Return

- Changed files and purpose: 5 파일 (entry rewrite + 4 sub-file 생성) + 각각의 책임 한 줄 설명.
- Checks run and outcomes: 9 checks 각각의 exit code + 핵심 출력 line.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation: 기존 hook signature / store API / Tauri command wrapper signature 그대로 사용, 새 API 도입 0 가정.
- Residual risk or verification gaps: 행동 보존 검증의 단일 source of truth = 3 regression test. test 자체가 누락된 케이스가 있다면 본 sprint 가 잡지 못함 — 후속 sprint candidate.

## References

- Contract: `docs/sprints/sprint-210/contract.md`
- Findings: `docs/sprints/sprint-210/findings.md` (작성 예정)
- Relevant files:
  - `src/components/document/DocumentDataGrid.tsx` (target)
  - `src/components/document/DocumentDataGrid.test.tsx` / `.pagination.test.tsx` / `.refetch-overlay.test.tsx` (regression guards)
  - `src/stores/documentStore.ts` (`runFind`)
  - `src/hooks/useSafeModeGate.ts`, `src/hooks/useDelayedFlag.ts`, `src/components/datagrid/useDataGridEdit.ts`
  - `src/lib/tauri.ts` (`invokeDeleteMany` / `invokeUpdateMany` / `cancelQuery` / `findDocuments` / `insertDocument`)
  - `src/stores/queryHistoryStore.ts` (`addHistoryEntry`)
  - 이전 entry-pattern 참고: `src/stores/tabStore.ts` (Sprint 208), `src/components/schema/SchemaTree.tsx` (Sprint 199)
- 인접 sprint 문서: `docs/sprints/sprint-208/{contract,findings,handoff}.md`
- 후속 candidates: `docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P1

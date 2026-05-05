# Sprint Contract: sprint-210

## Summary

- Goal: `src/components/document/DocumentDataGrid.tsx` (951 lines) god-component 를 entry-pattern 으로 분해. 행동 변경 0; 외부 import path 보존.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `useDocumentGridData` hook 추출 (`runFind` / pagination / `fetchIdRef` stale guard / cancel handler).
- `useMongoBulkOps` hook 추출 (Safe Mode gate + JSON patch validation + `invokeDeleteMany` / `invokeUpdateMany` + toast + history record + refetch).
- `DocumentBulkDeleteDialog` presentational component 분리.
- `DocumentBulkUpdateDialog` presentational component 분리.
- entry `DocumentDataGrid.tsx` 를 toolbar / grid / modal wiring 만으로 축소.
- 4 sub-file 위치: `src/components/document/DocumentDataGrid/{useDocumentGridData.ts, useMongoBulkOps.ts, DocumentBulkDeleteDialog.tsx, DocumentBulkUpdateDialog.tsx}`.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `DocumentDataGrid.test.tsx` / `DocumentDataGrid.pagination.test.tsx` / `DocumentDataGrid.refetch-overlay.test.tsx` test 파일 수정 (3 파일 모두 변경 0).
- `useDataGridEdit` / `useSafeModeGate` / `useDelayedFlag` 같은 기존 hook 의 인터페이스 변경.
- `useDocumentStore` / `addHistoryEntry` / `invokeDeleteMany` / `invokeUpdateMany` API surface 변경.
- RDB `DataGrid` 와의 공통화 (P2 / 후속 sprint candidate).
- bulk-write 정책 변경 (Safe Mode 전이, `_id` 정책 등).

## Invariants

- 외부 import path: `@components/document/DocumentDataGrid` 가 React 컴포넌트 default export 로 유지. Props = `{ connectionId, database, collection }` 동일.
- 4 sub-file 은 entry 로부터만 import, 외부 노출 0.
- Query history side-effect ordering: Add Document / deleteMany / updateMany 의 `addHistoryEntry` 호출 시점 + payload 동일 (`source: "mongo-op"`, `paradigm: "document"`, `queryMode: "find"`).
- Safe Mode gate: bulk handler 가 dialog 열기 전 `safeModeGate.decide(analyzeMongoOperation(...))` 실행, `block` 일 때 `toast.error(decision.reason)` + dialog 안 열림.
- `fetchIdRef` stale-response invariant: cancel 시 1 frame 안에 `loading=false`, 늦게 도착한 응답은 무시. AC-180-05-DocumentDataGrid 테스트 통과.
- bulk-write commands wiring: `invokeDeleteMany(connectionId, database, collection, activeFilter)`, `invokeUpdateMany(connectionId, database, collection, activeFilter, patch)`. 성공/실패 toast copy 동일 (`Deleted {N} document(s)` / `Updated {N} document(s)`).
- 새 `eslint-disable` directive 추가 0. 새 silent `catch{}` 추가 0 (catch-policy 준수).

## Acceptance Criteria

- `AC-01`: entry path + public props 보존 (`@components/document/DocumentDataGrid` import 매치 동일, default export 컴포넌트, props = `{connectionId, database, collection}`).
- `AC-02`: 5 파일 모두 존재 + 비어있지 않음 (entry + `useDocumentGridData.ts` + `useMongoBulkOps.ts` + `DocumentBulkDeleteDialog.tsx` + `DocumentBulkUpdateDialog.tsx`).
- `AC-03`: entry < 600 lines (god file 951 → 35%+ 감소). 단일 sub-file < 400 lines.
- `AC-04`: 3 regression test 파일 (`.test.tsx` / `.pagination.test.tsx` / `.refetch-overlay.test.tsx`) 변경 0 + `pnpm vitest run` 으로 모두 통과.
- `AC-05`: 프로젝트 회귀 0 — `pnpm vitest run` (post-209 baseline 동일) / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 새 `eslint-disable` 0.

## Design Bar / Quality Bar

- 분해 = 추출 + 조립. 새 비즈니스 로직 추가 금지.
- hook 의 인터페이스는 entry 가 필요한 최소 surface 만 노출. 내부 ref/state 누출 금지.
- presentational dialog 는 stateless. `open` / `onOpenChange` / data props 만 받음.
- 모든 sprint commit 의 git diff 가 "이동 + 인덱스 정리" 로 읽혀야 함 (분해 의도 명시).

## Verification Plan

### Required Checks

1. `wc -l src/components/document/DocumentDataGrid.tsx` < 600.
2. `ls src/components/document/DocumentDataGrid/{useDocumentGridData.ts,useMongoBulkOps.ts,DocumentBulkDeleteDialog.tsx,DocumentBulkUpdateDialog.tsx}` 4 파일 모두 존재.
3. `git diff --stat src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` 변경 0.
4. `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` exit 0.
5. `pnpm vitest run` exit 0, post-209 baseline (189 files / 2737 tests) 이상 유지.
6. `pnpm tsc --noEmit` exit 0.
7. `pnpm lint` exit 0.
8. `grep -rn "from \"@components/document/DocumentDataGrid/" src/ e2e/` 매치 0 (sub-files internal).
9. `grep -rn "from \"@components/document/DocumentDataGrid\"" src/ e2e/` 매치는 sprint 진입 시점과 동일 set.

### Required Evidence

- Generator must provide:
  - 5 changed files (entry rewrite + 4 sub-file 생성) 의 diff stat
  - check 1-9 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary)
  - 새로 추가한 `eslint-disable` / silent `catch` 0 임을 git diff 로 보여주기
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output)
  - missing 또는 weak evidence 는 finding 으로

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 행동 변경 0 의 refactor 라 신규 unit test 작성 0.
- 기존 3 regression test 파일이 행동 보존 검증의 source of truth.

### Coverage Target

- 신규 코드 (4 sub-file) 의 직접 unit test 0 (regression test 가 통합 커버).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — 3 regression test 가 페치 / 페이지 / 편집 / dialog flow 커버.
- [x] 에러 / 예외 — `_id` 거부, JSON 파싱 실패, fetch error 모두 기존 test 에 포함.
- [x] 경계 조건 — cancel race, empty filter, page change while pending 모두 기존 test 커버.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. `git stash --include-untracked` (선택, sprint working state 보호).
2. `pnpm vitest run src/components/document/DocumentDataGrid.test.tsx src/components/document/DocumentDataGrid.pagination.test.tsx src/components/document/DocumentDataGrid.refetch-overlay.test.tsx` — sprint 진입 baseline 확인.
3. Generator 작업 후 동일 명령 다시 실행 → exit 0.
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
5. `wc -l src/components/document/DocumentDataGrid.tsx src/components/document/DocumentDataGrid/*.{ts,tsx}` 라인 카운트 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: `src/components/document/DocumentDataGrid.tsx` + `src/components/document/DocumentDataGrid/` 신규 디렉토리 + 4 sub-file 만. 그 외 파일 수정 금지.
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-9 모두)
- Acceptance criteria evidence linked in `handoff.md`

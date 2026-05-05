# Sprint Contract: sprint-213

## Summary

- Goal: `src/components/connection/ConnectionDialog.tsx` (829 lines) god-component 를 entry-pattern 으로 분해. `useConnectionDraftForm` + `useConnectionUrlImport` 두 hook 추출 (필수) + 선택적 `ConnectionDialogBody` / `Footer` / `sanitize.ts` 분리. 행동 변경 0; 외부 import path + `sanitizeMessage` named export 보존.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `useConnectionDraftForm` hook 추출 (draft mutation + DB type change confirmation + password resolution + trim policy + applyParsedConnection 머지).
- `useConnectionUrlImport` hook 추출 (URL parse + form-mode host-paste detection + host:port blur split + recognised scheme + sqlite fallback).
- entry `ConnectionDialog.tsx` 를 thin orchestration 만 보존 (testResult / saving / error state + 2 hook 호출 + JSX wiring).
- (선택) `ConnectionDialogBody.tsx` presentational (form/URL toggle + URL input + DBMS-aware fields + Advanced Settings + detected affordance).
- (선택) `ConnectionDialogFooter.tsx` presentational (DialogFeedback + save error + Test/Cancel/Save).
- (선택) `sanitize.ts` — `sanitizeMessage` 본문 재배치 (entry 가 re-export).
- Sub-file 위치: `src/components/connection/ConnectionDialog/{useConnectionDraftForm.ts, useConnectionUrlImport.ts, ConnectionDialogBody.tsx?, ConnectionDialogFooter.tsx?, sanitize.ts?}`.

## Out of Scope

- 행동 변경, 새 feature 추가.
- `ConnectionDialog.test.tsx` (1362 lines) / `ConnectionDialog.urlInput.test.tsx` (697 lines) 변경 (양쪽 모두 변경 0).
- `useConnectionStore.addConnection` / `updateConnection` / `testConnection` API 변경.
- `forms/{Pg,Mysql,Sqlite,Mongo,Redis}FormFields` 시그니처 / 본문 변경.
- `parseConnectionUrl` / `parseSqliteFilePath` / `DialogFeedback` API 변경.
- 3 importer (`Sidebar.tsx:16` / `HomePage.tsx:26` / `dialog.test.tsx:10`) 변경.
- `sanitizeMessage` 본문 변경 (replaceAll + URL-encoded 마스킹 동결).
- 새 unit test 작성.
- ENV_NONE_SENTINEL = "__none__" 매핑 / 6-환경 enum 변경.

## Invariants

- 외부 import path: `@components/connection/ConnectionDialog` 가 default React 컴포넌트 + `sanitizeMessage` named export. props = `{ connection?: ConnectionConfig; onClose: () => void }` 동결.
- Sub-file 은 entry 또는 다른 sub-file 로부터만 import (외부 노출 0).
- sprint-92 `expectNodeStable` 4건 + sprint-95 DialogFeedback 매핑 + sprint-108 DBMS port confirm + sprint-138 5-DBMS form shape + sprint-178 5 그룹 (trim / paste / blur / silent malformed / password leak) 모두 사전 동일.
- `data-slot="test-feedback"` DOM identity 보존 (re-mount 금지).
- ARIA: dialog role / labelledby / close aria-label / "Database Type" / "Environment" select aria-label / save error role="alert" / DBMS confirm role="alertdialog" / detected affordance role 0.
- 새 `eslint-disable*` 0. 새 silent `catch{}` 0 (`sanitizeMessage` 사용하는 catch 는 silent 아님).
- `testConnection(draft, connection?.id ?? null)` 두 번째 arg 시그니처 보존.

## Acceptance Criteria

- `AC-01`: entry path + public surface 보존 — default export + `sanitizeMessage` named export + `ConnectionDialogProps` 동결. 3 importer 변경 0.
- `AC-02`: 5 파일 (entry + 2 hook 필수 + 0~3 선택) 모두 존재 + 비어있지 않음. 각 sub-file 이 entry 또는 다른 sub-file 에서 import 됨.
- `AC-03`: entry < 400 lines (829 → 50%+ 감소). 단일 sub-file < 400 lines.
- `AC-04`: 2 regression test 파일 변경 0 + `pnpm vitest run` 으로 모두 통과.
- `AC-05`: 프로젝트 회귀 0 — `pnpm vitest run` (post-Sprint-212 baseline) / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0. 새 `eslint-disable*` 0. 새 silent `catch{}` 0.

## Design Bar / Quality Bar

- 분해 = 추출 + 조립. 새 비즈니스 로직 추가 금지.
- hook return surface 는 entry 가 필요한 최소만 노출. 내부 ref/state 누출 금지.
- presentational sub-component 도입 시 stateless. `open` / `setX` / data props 만 받음.
- `sanitizeMessage` 본문은 byte-for-byte 동결 — replaceAll + URL-encoded 변형 마스킹 그대로.
- 모든 sprint commit 의 git diff 가 "이동 + 인덱스 정리" 로 읽혀야 함.

## Verification Plan

### Required Checks

1. `wc -l src/components/connection/ConnectionDialog.tsx` < 400.
2. `ls src/components/connection/ConnectionDialog/{useConnectionDraftForm.ts,useConnectionUrlImport.ts}` 2 파일 (필수) 존재.
3. `wc -l src/components/connection/ConnectionDialog/*.{ts,tsx}` 단일 sub-file max < 400.
4. `git diff --stat src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` 변경 0.
5. `pnpm vitest run src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx` exit 0.
6. `pnpm vitest run` exit 0, post-Sprint-212 baseline (189 files / 2725 tests) 이상 (또는 신규 hook 파일 추가에 따라 file 수 ±1-2 허용, fail 0).
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `grep -rn "from \"@components/connection/ConnectionDialog/\"" src/ e2e/` 매치 0 (sub-file internal).
10. `grep -rn "from \"@components/connection/ConnectionDialog\"" src/ e2e/` 매치 3 (`Sidebar.tsx:16` + `HomePage.tsx:26` + `dialog.test.tsx:10`).
11. `grep -n "export.*sanitizeMessage" src/components/connection/ConnectionDialog.tsx` 매치 ≥ 1.
12. `git diff src/components/connection/ConnectionDialog.tsx src/components/connection/ConnectionDialog/` grep `^+.*eslint-disable` 매치 0.
13. `git diff --stat src/components/layout/Sidebar.tsx src/pages/HomePage.tsx src/components/ui/dialog.test.tsx` 모두 0 changes.

### Required Evidence

- Generator must provide:
  - 변경 파일 (entry rewrite + 2~5 sub-file) 의 diff stat.
  - check 1-13 의 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence (파일 경로 + grep 결과 + line count + test summary).
  - 새 `eslint-disable*` / silent `catch` 0 임을 git diff 로 보여주기.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output).
  - missing 또는 weak evidence 는 finding 으로.

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 행동 변경 0 의 refactor — 신규 unit test 작성 0.
- 기존 2 regression test 파일 (1362 + 697 = 2059 lines) 가 행동 보존 검증의 source of truth.

### Coverage Target

- 신규 코드 (2~5 sub-file) 의 직접 unit test 0 (regression test 가 통합 커버).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — new connection (form + URL mode) / edit connection / Test Connection / Save / DBMS type 변경 모두 기존 test 커버.
- [x] 에러 / 예외 — URL parse failure / Test error / Save error / validation error 모두 기존 test 포함.
- [x] 경계 조건 — host:port blur split (3 케이스) / SQLite mode / password keep semantics / IPv6 / 빠른 Test 클릭 모두 기존 test 커버.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. `git stash --include-untracked` (선택, sprint working state 보호).
2. baseline 확인:
   ```sh
   pnpm vitest run src/components/connection/ConnectionDialog.test.tsx src/components/connection/ConnectionDialog.urlInput.test.tsx
   ```
3. Generator 작업 후 동일 명령 다시 실행 → exit 0.
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
5. `wc -l src/components/connection/ConnectionDialog.tsx src/components/connection/ConnectionDialog/*.{ts,tsx}` 라인 카운트 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: `src/components/connection/ConnectionDialog.tsx` + `src/components/connection/ConnectionDialog/` 신규 디렉토리만. 그 외 파일 (`forms/*` / store / 3 importer / 2 test 파일) 변경 금지.
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-13 모두)
- Acceptance criteria evidence linked in `handoff.md`

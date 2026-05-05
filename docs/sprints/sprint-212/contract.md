# Sprint Contract: sprint-212

## Summary

- Goal: `src/stores/tabStore.ts` (entry, 668 lines, Sprint 208 split 완료) 의 두 cross-store 직접 import (`useMruStore` / `useQueryHistoryStore`) 와 두 `eslint-disable no-restricted-imports` 블록 제거. MRU marking + query history recording 을 caller layer 로 이동. 행동 변경 0; 외부 import path 보존.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- `src/stores/tabStore.ts` entry — 두 `eslint-disable no-restricted-imports` 블록 + 2 cross-store import + 3 cross-store call (`addTab` L93 / `addQueryTab` L298 의 `markConnectionUsed`, `recordHistory` L467 의 `addHistoryEntry`) + entry 상단 TODO 주석 제거.
- `src/stores/tabStore/types.ts` — `recordHistory` 시그니처 제거 (권장 path).
- `src/components/query/QueryTab/useQueryExecution.ts` — `recordHistory` selector → `addHistoryEntry` selector 마이그레이션 + payload 자동 추출 caller-side 로 이동.
- 16 caller 의 MRU marking 명시 호출 추가:
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (6 handler).
  - `src/components/schema/DocumentDatabaseTree.tsx` (2 handler).
  - `src/components/rdb/DataGrid.tsx` (1 handler).
  - `src/components/layout/MainArea.tsx` (1 CTA).
  - `src/components/layout/Sidebar.tsx` (1 button).
  - `src/App.tsx` (3 handler: Cmd+T / navigate-table / quickopen-function).
- 선택: `src/hooks/useOpenTableTab.ts` / `src/hooks/useOpenQueryTab.ts` use-case hook 도입 (caller migration boilerplate 흡수).
- `src/stores/tabStore.test.ts` — AC-195-03 / AC-196-02 의 5건 테스트 (recordHistory + source) 마이그레이션 또는 삭제 (신규 unit test 작성 0 원칙 준수).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `src/stores/tabStore/persistence.ts` 의 `useConnectionStore` cross-store import (`resolveActiveDb`) — 별도 candidate. 그대로 유지.
- `useMruStore` / `useQueryHistoryStore` API 변경.
- `addTab` / `addQueryTab` / 기타 `TabState` 시그니처 변경 (`recordHistory` 제거 외).
- 51 caller 의 `addTab` / `addQueryTab` 호출 부 변경 (MRU marking 추가 호출만 추가).
- 새 unit test 추가 (기존 케이스 import / setUp 수정만 허용).
- `mruStore.ts` / `queryHistoryStore.ts` 내부 변경.
- IPC sync / SYNCED_KEYS / tracker / persistence 동작 변경.

## Invariants

- 외부 import path: `@stores/tabStore` 보존. `useTabStore` / `Tab` / `TableTab` / `QueryTab` / `TabSubView` / `QueryMode` / `useActiveTab` / `getLastActiveTabIdForConnection` / `__resetLastActiveTabsForTests` / `SYNCED_KEYS` named exports 동일.
- 4 sub-file 은 entry 로부터만 import, 외부 노출 0.
- `useMruStore.markConnectionUsed(connectionId)` 호출은 16 caller 에서 모두 발화 (사전과 동일 시점, 동일 connectionId).
- `useQueryHistoryStore.addHistoryEntry(payload)` 호출은 8 call site (`useQueryExecution.ts` 안) 에서 동일 payload shape (`sql` / `executedAt` / `duration` / `status` / optional `source` + 자동 추출되는 `connectionId` / `paradigm` / `queryMode` / `database` / `collection`) 으로 발화.
- Cross-window IPC sync (`tab-sync` / `mru-sync`) 변경 0.
- 새 `eslint-disable*` 0. entry 의 두 기존 `eslint-disable no-restricted-imports` 블록 제거.
- `no-restricted-syntax` rule (`.tsx` 의 `.getState()` 직접 호출 금지) 위반 0 — caller migration 시 selector subscription 사용.

## Acceptance Criteria

- `AC-01`: cross-store import 0 + eslint-disable 블록 0.
  - `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` 매치 0.
  - `grep -nE "eslint-(disable|enable) no-restricted-imports" src/stores/tabStore.ts` 매치 0.
- `AC-02`: 두 cross-store action call 이 caller layer 로 이동.
  - `grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"` 매치 0.
  - `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` 매치 0.
  - `grep -rn "markConnectionUsed" src/ --include="*.ts" --include="*.tsx" | grep -v "src/stores/mruStore"` 매치 ≥ 1.
- `AC-03`: 외부 import path / props / signature 보존.
  - `grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l` ≥ 50 (Sprint 208 baseline 유지 — 신규 hook 도입 시 +1/+2 허용).
  - `recordHistory` 시그니처 제거 시 caller 0건이 stale reference (`useQueryExecution.ts` migration 완료).
- `AC-04`: 회귀 테스트 통과 — `pnpm vitest run` exit 0, post-Sprint-211 baseline (189 files / 2725 tests) 이상.
  - `tabStore.test.ts` / `mruStore.test.ts` / `queryHistoryStore.test.ts` 통과.
  - `cross-window-store-sync.test.tsx` / `MainArea.test.tsx` / `SchemaTree.preview.test.tsx` / `SchemaTree.test.tsx` / `QueryTab.test.tsx` / `DocumentDataGrid.test.tsx` / `DocumentDatabaseTree.test.tsx` 통과.
- `AC-05`: 프로젝트 회귀 0.
  - `pnpm tsc --noEmit` exit 0.
  - `pnpm lint` exit 0.
  - 새 `eslint-disable*` 0 (`git diff` 의 `^+.*eslint-disable` 매치 0).
  - 새 silent `catch{}` 0.

## Design Bar / Quality Bar

- 변경 = 책임 이동. 새 비즈니스 로직 추가 금지.
- caller 측에서는 selector subscription 사용 — `.tsx` / hook 에서 `.getState()` 직접 호출 금지 (eslint `no-restricted-syntax` 준수).
- 신규 use-case hook (`useOpenTableTab` / `useOpenQueryTab`) 도입 시 — pure composition (`addTab + markConnectionUsed`), state 보유 0, side effect 0 외 추가 0.
- `useQueryExecution` 의 payload 자동 추출은 inline 또는 pure helper 로. helper 도입 시 한 파일에 함수 1-2개로 한정.
- `tabStore.test.ts` 의 테스트 수정 = 기존 case 의 import / setUp 만 — 신규 case 0.

## Verification Plan

### Required Checks

1. `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` 매치 0.
2. `grep -nE "eslint-(disable|enable) no-restricted-imports" src/stores/tabStore.ts` 매치 0.
3. `grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"` 매치 0.
4. `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` 매치 0.
5. `grep -n "recordHistory" src/stores/tabStore.ts src/stores/tabStore/types.ts` 매치 0 (또는 doc-only).
6. `grep -rn "from \"@stores/tabStore\"" src/ e2e/ | grep -v "src/stores/tabStore" | wc -l` ≥ 50.
7. `pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/queryHistoryStore.test.ts` exit 0.
8. `pnpm vitest run src/__tests__/cross-window-store-sync.test.tsx src/__tests__/cross-window-connection-sync.test.tsx` exit 0.
9. `pnpm vitest run src/components/layout/MainArea.test.tsx src/components/layout/Sidebar.test.tsx` exit 0.
10. `pnpm vitest run` exit 0, ≥ post-Sprint-211 baseline (189 files / 2725 tests).
11. `pnpm tsc --noEmit` exit 0.
12. `pnpm lint` exit 0.
13. `git diff` 산출 파일 grep `^+.*eslint-disable` 매치 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 (entry rewrite + types.ts + useQueryExecution.ts + 16 caller migration + optional 2 hook + tabStore.test.ts) 의 diff stat.
  - check 1-13 의 실행 결과 (exit code + 핵심 출력).
  - AC-01..AC-05 별 evidence (grep 결과 + test summary + lint 출력).
  - 새로 추가한 `eslint-disable*` / silent `catch` 0 임을 git diff 로 보여주기.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거 (concrete output).
  - missing 또는 weak evidence 는 finding 으로.

## Test Requirements

### Unit Tests (필수)

- 본 sprint 는 store-side cross-store coupling 제거 — 신규 unit test 작성 0.
- 기존 통합 테스트 (`MainArea.test.tsx::AC-01/AC-04`, `SchemaTree.preview.test.tsx`, `QueryTab.test.tsx` 등) 가 행동 보존 검증의 source of truth.
- `tabStore.test.ts` 의 AC-195-03 / AC-196-02 (recordHistory + source) — 시그니처 제거시 (a) 삭제 (권장) 또는 (b) `useQueryExecution` 통합 테스트로 이동. 신규 case 0.

### Coverage Target

- 신규 코드 (caller migration line) 의 직접 unit test 0 (통합 테스트가 커버).
- 프로젝트 전체 baseline (라인 40% / 함수 40% / 브랜치 35%) 유지.

### Scenario Tests (필수)

- [x] Happy path — table single/double click + collection open + FK navigate + Cmd+T + Sidebar+Query + EmptyState CTA + navigate-table event + quickopen-function event 모두 caller migration 후 MRU marking 발화.
- [x] 에러 / 예외 — query execution success / error / cancelled 모두 history entry 동일 shape.
- [x] 경계 조건 — multi-statement DDL, query cancel race, tab-close-mid-flight (caller hook unmount), 빠른 연속 tab open.
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` 전체.

## Test Script / Repro Script

1. `git stash --include-untracked` (선택, sprint working state 보호).
2. baseline 확인:
   ```sh
   pnpm vitest run src/stores/tabStore.test.ts src/stores/mruStore.test.ts src/stores/queryHistoryStore.test.ts
   ```
3. Generator 작업 후 동일 명령 다시 실행 → exit 0.
4. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint` 전체 회귀.
5. `grep -n "useMruStore\|useQueryHistoryStore\|eslint-disable no-restricted-imports" src/stores/tabStore.ts` 매치 0 보고.
6. `grep -rn "markConnectionUsed" src/ --include="*.ts" --include="*.tsx" | grep -v "src/stores/mruStore"` caller 분포 보고.

## Ownership

- Generator: general-purpose agent (multi-agent harness Phase 3).
- Write scope: 위 In Scope 의 ~10 파일 + optional 2 hook 만. 그 외 파일 (`mruStore.ts` / `queryHistoryStore.ts` / persistence.ts / tracker.ts / 51 caller 의 `addTab` / `addQueryTab` 호출 부) 변경 금지.
- Merge order: 본 sprint commit → handoff.md → PLAN.md hash → 다음 sprint.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-13 모두)
- Acceptance criteria evidence linked in `handoff.md`

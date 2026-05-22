# Sprint Execution Brief: sprint-212

## Objective

`src/stores/tabStore.ts` (entry, 668 lines) 의 두 cross-store 직접 import (`useMruStore`, `useQueryHistoryStore`) 와 두 `eslint-disable no-restricted-imports` 블록 제거. MRU marking 책임을 16 caller (Cmd+T / Sidebar / MainArea / SchemaTree (6 handler) / DocumentDatabaseTree / DataGrid / App.tsx 3 event handler) 로 이동. query history recording 책임을 `useQueryExecution.ts` 8 call site 로 이동. 행동 변경 0.

## Task Why

- post-209 cycle 의 P3 후보. tabStore 가 entry-pattern 분해 (Sprint 208) 후에도 `useMruStore` / `useQueryHistoryStore` 직접 import 유지 — store ownership 흐림.
- entry 상단 TODO 주석 (L19-22) 이 본 sprint 의 정확한 scope 명시.
- store action 안에서 cross-store side effect 호출 → 테스트가 다른 store 의 mock 에 의존 → 회귀 위험 ↑.
- eslint `no-restricted-imports` rule (`src/stores/**/*.ts` cross-store 금지) 의 entry 예외 장기화 → 새 store coupling 추가 가능성.
- Sprint 195 의 paradigm/queryMode 자동 추출 의미는 caller layer 에서도 동일하게 보존 가능 (`useQueryExecution.ts` 가 이미 `tab` arg 로 모든 정보 보유).

## Scope Boundary

- 위 Contract 의 In Scope 파일만 수정.
- `mruStore.ts` / `queryHistoryStore.ts` / `tabStore/persistence.ts` / `tabStore/tracker.ts` / 51 caller 의 `addTab` / `addQueryTab` 호출 부 변경 금지.
- 신규 unit test 작성 금지 (기존 case 의 import / setUp 수정만 허용).
- 새 feature, 새 동작, 새 store 추가 금지.

## Invariants

- 외부 import path: `@stores/tabStore` 보존.
- `useMruStore.markConnectionUsed(connectionId)` 호출 시점 + connectionId 동일 (16 caller).
- `useQueryHistoryStore.addHistoryEntry(payload)` 호출 시점 + payload shape 동일 (8 call site).
- Cross-window IPC sync (`tab-sync` / `mru-sync`) 변경 0.
- 새 `eslint-disable*` 0, 기존 entry 의 두 `eslint-disable no-restricted-imports` 블록 제거.
- `.tsx` / hook 에서 `.getState()` 직접 호출 0 (`no-restricted-syntax` 준수) — selector subscription 사용.

## Done Criteria

1. `grep -n "useMruStore\|useQueryHistoryStore" src/stores/tabStore.ts` 매치 0.
2. `grep -nE "eslint-(disable|enable) no-restricted-imports" src/stores/tabStore.ts` 매치 0.
3. `grep -rn "markConnectionUsed" src/stores/ | grep -v "src/stores/mruStore"` 매치 0.
4. `grep -rn "addHistoryEntry" src/stores/tabStore.ts src/stores/tabStore/` 매치 0.
5. `pnpm vitest run` / `pnpm tsc --noEmit` / `pnpm lint` 모두 exit 0.
6. baseline (189 files / 2725 tests) 이상 유지.

## Verification Plan

- Profile: `command`
- Required checks: 위 contract.md 의 13 checks (1-13) 동일.
- Required evidence:
  - 변경 파일 diff stat
  - check 1-13 의 실행 결과 (exit code + 핵심 출력)
  - AC-01..AC-05 별 evidence (grep 결과 + test summary + lint 출력)

## Evidence To Return

- Changed files and purpose: ~10 파일 + optional 2 hook + 각각의 책임 한 줄 설명.
- Checks run and outcomes: 13 checks 각각의 exit code + 핵심 출력 line.
- Done criteria coverage with evidence: AC-01~05 별 concrete evidence.
- Assumptions made during implementation:
  - `recordHistory` 시그니처 제거 path 채택 (또는 not — generator 결정).
  - `useOpenTableTab` / `useOpenQueryTab` hook 도입 여부 (또는 inline caller migration).
  - `tabStore.test.ts` 의 AC-195-03 / AC-196-02 5건 마이그레이션 path (삭제 vs 이동).
- Residual risk or verification gaps: 16 caller 의 일부가 통합 테스트에 노출되지 않으면 marking 누락 회귀가 보장 안 됨. 핵심 caller (MainArea CTA / SchemaTree click / Cmd+T) 는 테스트 보유, 일부 (App.tsx event handler) 는 e2e 검증 의존.

## References

- Contract: `docs/sprints/sprint-212/contract.md`
- Findings: `docs/sprints/sprint-212/findings.md` (작성 예정)
- Relevant files:
  - `src/stores/tabStore.ts` (target, 668 lines)
  - `src/stores/tabStore/{types,persistence,tracker}.ts`
  - `src/stores/tabStore.test.ts`
  - `src/stores/mruStore.ts` (markConnectionUsed API source)
  - `src/stores/queryHistoryStore.ts` (addHistoryEntry API source)
  - `src/components/query/QueryTab/useQueryExecution.ts` (recordHistory 유일 caller)
  - `src/components/schema/SchemaTree/useSchemaTreeActions.ts` (6 caller)
  - `src/components/schema/DocumentDatabaseTree.tsx` (2 caller)
  - `src/components/rdb/DataGrid.tsx` (1 caller)
  - `src/components/layout/{MainArea,Sidebar}.tsx`
  - `src/App.tsx` (3 event handler)
  - `src/__tests__/cross-window-store-sync.test.tsx`
- 인접 sprint 문서:
  - `docs/sprints/sprint-208/{contract,findings,handoff}.md` (tabStore entry split)
  - `docs/sprints/sprint-211/{contract,findings,handoff}.md` (직전 entry-pattern split)
- 후속 candidates: `docs/archives/backlogs/refactoring-candidates-2026-05-06.md` §P3 (본 sprint), §P10 (stores side-effects, post-212 잔여).

# Sprint Contract: sprint-221

## Summary

- Goal: `src/stores/tabStore.test.ts` (2,234 lines / 1 root + 11 L1 nested + 2 L2 nested describe / 102 cases) 를 5-7 behavior-axis test 파일 + 1 shared helper 파일로 분해. 행동 변경 0; `tabStore.ts` + `tabStore/{types,persistence,tracker}.ts` + 9 sibling store test 모두 변경 0. 사전 102 case 모두 사후 통과.
- Audience: Generator + Evaluator (multi-agent harness, post-209 cycle, P11 step 4).
- Owner: harness skill orchestrator.
- Verification Profile: `command`

## In Scope

- 신규 axis test 파일 5-7개: `src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts` (이름은 generator 재량).
- 신규 shared helper 파일 (옵션 B 권고): `src/stores/__tests__/tabStoreTestHelpers.ts`.
- 사전 entry `src/stores/tabStore.test.ts` 처리: 옵션 1 (제거, 권고) 또는 옵션 2 (smoke ≤ 5 case 잔존, 허용).
- 모든 신규 axis 파일이 사전 102 case 의 axis-별 분배.
- Sprint 195 doubly-nested describe 처리: 옵션 A (평탄화) 또는 옵션 B (보존, 권고).

## Out of Scope

- 행동 변경, 새 feature 추가.
- `src/stores/tabStore.ts` (596 lines, post-Sprint 208 entry) 변경.
- `src/stores/tabStore/{types,persistence,tracker}.ts` (Sprint 208 sub-files) 변경.
- 9 sibling store test/source 변경 (`connectionStore` / `documentStore` / `favoritesStore` / `mruStore` / `queryHistoryStore` / `safeModeStore` / `schemaStore` / `themeStore`).
- Sprint 216/218/220 산출물 변경 (SchemaTree axis 6 + QueryTab axis 6 + StructurePanel axis 4 + 3 helper 파일).
- 외부 importer (51건, components/hooks/lib) 변경.
- case 텍스트 / matcher / fixture data shape 변경.
- 새 unit test 작성 (case 추가/제거 0).
- AC label / sprint section header 변경.

## Invariants

- 사전 102 case 모두 사후 통과 + case 추가/제거 0.
- 20 verbatim AC string 모두 사후 axis 파일 안에 1건 이상 존재.
- vi.mock factory 0 건 사전 동일 (사전 0 — 추가 금지).
- vi.spyOn 0 건 사전 동일 (사전 0 — 추가 금지).
- 사전 import / mock pattern 보존 — `useTabStore` + types + `SYNCED_KEYS` from `./tabStore`, `QueryState` from `@/types/query`, `SortInfo` from `@/types/schema`, dynamic `await import("./connectionStore")` (Sprint 130 axis only).
- 사전 fixture data shape 보존 (`makeTableTab` defaults / `getTableTab` / `getQueryTab` / persisted JSON shape byte-equivalent).
- 사전 store seed pattern 보존 — `useTabStore.setState({...})` reset verbatim.
- public surface (`useTabStore` / `useActiveTab` / 7 type re-export / `SYNCED_KEYS` / 2 tracker helper) 동결.
- 새 `eslint-disable*` / silent `catch{}` 0.
- `it.only` / `it.skip` 0.
- Helper 파일 안 cross-store import 0 (lint rule 회피).

## Acceptance Criteria

- `AC-01`: 사후 tabStore*.test.ts glob 합계 case = 사전 102 (옵션 1 채택 시 정확히 102, 옵션 2 채택 시 axis + entry smoke 합계 = 102). `pnpm vitest run src/stores/tabStore*.test.ts` exit 0.
- `AC-02`: 신규 axis 파일 5-7개 + 각 ≥ 5 case + ≤ 30 case + sibling 9 충돌 0.
- `AC-03`: shared helper 파일 (옵션 B) 채택 시 named export ≥ 5 (3 helper + 1 reset + 1+ fake-storage helper) 보유. 외부 import 0 (axis 파일만).
- `AC-04`: 사전 entry 처리 옵션 1 (파일 제거, 권고) 또는 옵션 2 (≤ 5 smoke case 잔존).
- `AC-05`: 20 verbatim AC string 모두 사후 axis 파일 안 1건 이상 매치. Global AC 1-10 모두 충족.

## Design Bar / Quality Bar

- test-only refactor — `tabStore.ts` + sub-file 3 + 9 sibling store + Sprint 216/218/220 산출물 모두 변경 0.
- case 1건도 추가/제거/변경 금지. axis-별 재배치만.
- helper 파일은 named export 만 (default export 0). 외부 import 0 (axis 파일 only).
- helper 안 cross-store import 0 (`eslint.config.js` `no-restricted-imports` rule).
- vi.mock factory / vi.spyOn 추가 금지 (사전 0 → 사후 0).
- AC label / sprint section header / 모든 comment 사전 동일하거나 axis context 추가 (의미 추가, 의미 변경 금지).
- 모든 sprint commit 의 git diff 가 "case 이동 + helper 추출" 으로 읽혀야 함.
- Sprint 195 doubly-nested describe 보존 (옵션 B 권고).
- Sprint 212 trailing comment block (L2226-2232) 사후 lifecycle-actions axis 끝에 verbatim 보존.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/tabStore*.test.ts` exit 0. Tests passed = 사전 102.
2. `pnpm vitest run` exit 0. file count [206, 209]. tests = 2720.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `find src/stores -maxdepth 1 -name "tabStore.*.test.ts" -not -name "tabStore.test.ts" | wc -l` ∈ [5, 7].
6. `for f in <new axis files>; do grep -cE "^\s*it\(" $f; done` 합계 ∈ [97, 102] (옵션 2 채택 시 ≥ 97).
7. `git diff --stat src/stores/tabStore.ts` 0.
8. `git diff --stat src/stores/tabStore/` 0 (3 sub-file 모두).
9. `git diff --stat src/stores/connectionStore.test.ts src/stores/connectionStore.ts src/stores/documentStore.test.ts src/stores/documentStore.ts src/stores/favoritesStore.test.ts src/stores/favoritesStore.ts src/stores/mruStore.test.ts src/stores/mruStore.ts src/stores/queryHistoryStore.test.ts src/stores/queryHistoryStore.ts src/stores/safeModeStore.test.ts src/stores/safeModeStore.ts src/stores/schemaStore.test.ts src/stores/schemaStore.ts src/stores/themeStore.test.ts src/stores/themeStore.ts` 0 (모두).
10. `git diff --stat src/components/schema/SchemaTree*.test.tsx src/components/schema/__tests__/schemaTreeTestHelpers.ts src/components/query/QueryTab*.test.tsx src/components/query/__tests__/queryTabTestHelpers.ts src/components/schema/StructurePanel*.test.tsx src/components/schema/__tests__/structurePanelTestHelpers.tsx` 0 (모두).
11. `git diff src/stores/ | grep "^+.*eslint-disable"` 매치 0.
12. 20 verbatim AC string 별 `grep -rnF "<verbatim>" src/stores/tabStore*.test.ts | wc -l` ≥ 1.
13. 옵션 1 채택 시 `test ! -f src/stores/tabStore.test.ts`. 옵션 2 채택 시 `wc -l < 200 + grep -cE "^\s*it\(" ≤ 5`.
14. helper 파일 (옵션 B) 존재 시 named export ≥ 5 매치 (`makeTableTab|getTableTab|getQueryTab|resetTabStore|installFakeLocalStorage|restoreLocalStorage|seedRunningQueryTab`).
15. helper 파일 외부 import 0 — `grep -rn "tabStoreTestHelpers" src/ e2e/` 매치 ≤ 6 (= 신규 axis 파일 수).
16. axis 파일 안 `it.only` / `it.skip` 매치 0.
17. 각 axis 파일 root describe 1개 (Sprint 195 옵션 B 채택 시 `lifecycle-actions` axis 의 root + 2 nested = 총 describe 3개 허용).
18. axis 파일 + helper 안 `vi.mock\(` 매치 = 0 (사전 0 — 추가 금지).
19. axis 파일 + helper 안 `vi.spyOn\(` 매치 = 0 (사전 0 — 추가 금지).
20. helper 파일 안 cross-store import 0 — `grep -nE "^import.*(connectionStore|queryHistoryStore|mruStore|schemaStore|documentStore|favoritesStore|safeModeStore|themeStore)" src/stores/__tests__/tabStoreTestHelpers.ts | wc -l` = 0.

### Required Evidence

- Generator must provide:
  - 변경 파일 목록 (신규 axis + helper + entry 처리).
  - check 1-20 실행 결과.
  - AC-01..AC-05 별 evidence.
  - 20 verbatim AC string 매치 결과.
  - Sprint 195 doubly-nested describe 처리 옵션 (A 또는 B) 명시.
- Evaluator must cite:
  - 각 AC 별 pass/fail 근거.
  - missing 또는 weak evidence finding.

## Test Requirements

- 본 sprint 는 test-only refactor — 신규 case 작성 0.
- 사전 102 case 가 source-of-truth.

## Test Script / Repro Script

1. baseline:
   ```sh
   pnpm vitest run src/stores/tabStore*.test.ts
   ```
2. Generator 작업 후 동일 명령 → exit 0 + 102 cases.
3. `pnpm vitest run && pnpm tsc --noEmit && pnpm lint`.
4. axis 파일 목록 + case 합계 검증.

## Ownership

- Generator: general-purpose agent (Phase 3).
- Write scope: `src/stores/tabStore.<axis>.test.ts` 신규 + `src/stores/__tests__/tabStoreTestHelpers.ts` (옵션 B) + 사전 entry 처리.
- 변경 금지: `tabStore.ts` / sub-file 3 / 9 sibling store / Sprint 216/218/220 산출물 / 외부 importer 51건 / store / hook.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1-20 모두)
- Acceptance criteria evidence linked in `handoff.md`

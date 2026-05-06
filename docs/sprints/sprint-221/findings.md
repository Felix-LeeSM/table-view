# Sprint 221 — Generator Findings

`tabStore.test.ts` (2,234 lines / 102 cases) 를 6 axis test 파일 + 1 shared helper 파일로 분해한 P11 step 4 결과.

## Changed Files

### 신규 (7)

- `src/stores/tabStore.lifecycle.test.ts` (7 cases) — root describe 의 7 case (addTab / activates existing / removeTab / sets active to previous / setActiveTab / setSubView / subView persists across tabs).
- `src/stores/tabStore.query.test.ts` (20 cases) — `query tab actions` (13) + `loadQueryIntoTab` (7) nested describes.
- `src/stores/tabStore.preview.test.ts` (19 cases) — `preview tab system` (14) + `addTab permanent option` (5) nested describes.
- `src/stores/tabStore.persistence.test.ts` (13 cases) — `tab state persistence` (9) + `per-tab sort persistence` (4) nested describes. `installFakeLocalStorage()` / `restoreLocalStorage()` 헬퍼 통합.
- `src/stores/tabStore.sort.test.ts` (19 cases) — `moveTab` (6) + `reopen last closed tab` (4) + `per-tab sort state` (9) nested describes.
- `src/stores/tabStore.lifecycle-actions.test.ts` (24 cases) — `setTabDirty / dirtyTabIds` (6) + `RDB database autofill (Sprint 130)` (6) + `SYNCED_KEYS allowlist (AC-153-06)` (3) + `query lifecycle actions (sprint-195 §3.1 extraction)` (9, **L2 nested 2개 보존 = 옵션 B**).
- `src/stores/__tests__/tabStoreTestHelpers.ts` (7 named export) — `makeTableTab` / `getTableTab` / `getQueryTab` / `emptyTabStoreState` / `installFakeLocalStorage` / `restoreLocalStorage` / `buildRunningQueryTabState`.

### 삭제 (1)

- `src/stores/tabStore.test.ts` (사전 2,234 lines / 102 cases, **옵션 1 채택**).

case 합계 = lifecycle 7 + query 20 + preview 19 + persistence 13 + sort 19 + lifecycle-actions 24 = **102** (사전 동일).

## Verification Results (20 checks)

| # | Check | Result |
|---|-------|--------|
| 1 | `pnpm vitest run src/stores/tabStore*.test.ts` | exit 0 / 6 files / 102 passed ✓ |
| 2 | `pnpm vitest run` | exit 0 / 207 files / 2720 tests passed (∈ [206, 209] ✓) |
| 3 | `pnpm tsc --noEmit` | exit 0 ✓ |
| 4 | `pnpm lint` | exit 0 ✓ |
| 5 | `find src/stores -maxdepth 1 -name "tabStore.*.test.ts"` | 6 files (∈ [5, 7] ✓) |
| 6 | axis case 합계 | 102 (사전 동일 ✓) |
| 7 | `git diff --stat src/stores/tabStore.ts` | 0 ✓ |
| 8 | `git diff --stat src/stores/tabStore/` | 0 ✓ |
| 9 | 9 sibling store diff | 모두 0 ✓ |
| 10 | Sprint 216/218/220 산출물 diff | 모두 0 ✓ |
| 11 | 새 `eslint-disable*` 매치 | 0 ✓ |
| 12 | 20 verbatim AC string | 각 정확히 1 매치 ✓ |
| 13 | 옵션 1 채택 — `tabStore.test.ts` 제거 | REMOVED ✓ |
| 14 | helper named export ≥ 5 | 7 (`makeTableTab`/`getTableTab`/`getQueryTab`/`emptyTabStoreState`/`installFakeLocalStorage`/`restoreLocalStorage`/`buildRunningQueryTabState`) ✓ |
| 15 | helper 외부 import | 6 (= axis 파일 수) ✓ |
| 16 | `it.only` / `it.skip` | 0 ✓ |
| 17 | 각 axis root describe 1개 | 각 파일 1 root describe ✓ |
| 18 | axis + helper 안 `vi.mock\(` | 모두 0 (사전 0 동일) ✓ |
| 19 | axis + helper 안 `vi.spyOn\(` | 모두 0 (사전 0 동일) ✓ |
| 20 | helper 안 cross-store import | 0 ✓ |

## Acceptance Criteria

### AC-01 — 102 case pass

- 사후 `pnpm vitest run src/stores/tabStore*.test.ts` exit 0 + Tests passed (102).
- 옵션 1 채택 (entry 제거) → axis 합계 = 정확히 102.

### AC-02 — 신규 axis 5-7개

- 6 axis 파일 신규 (∈ [5-7]).
- 각 5-30 case envelope: 7, 13, 19, 19, 20, 24 cases.
- sibling 충돌 0 (9 sibling + Sprint 216/218/220 산출물 모두 변경 0).

### AC-03 — Helper 옵션 B

- `src/stores/__tests__/tabStoreTestHelpers.ts` 신규.
- named export 7 (≥ 5 권고): 3 fixture (`makeTableTab` / `getTableTab` / `getQueryTab`) + 1 reset payload (`emptyTabStoreState`) + 2 fake-storage helper (`installFakeLocalStorage` / `restoreLocalStorage`) + 1 query seed payload (`buildRunningQueryTabState`).
- 외부 import 6 (= 신규 axis 파일 수, ≤ 6 ✓).
- helper 안 cross-store import 0 (lint 회피).

### AC-04 — 옵션 1 (entry 제거)

- `src/stores/tabStore.test.ts` 제거. 합계 102 = 신규 axis 합계.

### AC-05 — 20 verbatim AC string

- 17 일반 + 3 bracket-prefix (`[AC-195-01-1]` / `[AC-195-01-2]` / `[AC-195-02-1]`) = 20 verbatim string 모두 정확히 1 매치 (`grep -rnF`).

## Sprint 195 Doubly-Nested Describe — 옵션 B (보존)

`describe("query lifecycle actions (sprint-195 §3.1 extraction)", () => { ... })` 가 lifecycle-actions axis 의 outer L1 describe 로 보존. 그 안에 2 L2 nested describe (`[AC-195-01] completeQuery / failQuery guards`, `[AC-195-02] completeMultiStatementQuery allFailed branching`) 가 verbatim 보존. 사전 doubly-nested 의 의미 격리 (queryId guard vs multi-statement branching) 가 옵션 B 의 가치.

`grep -c "describe(\"\\[AC-195-0" src/stores/tabStore.lifecycle-actions.test.ts` = 2 ✓ (옵션 B 권고).

## Helper 위치 명시

- `installFakeLocalStorage` / `restoreLocalStorage` — helper 파일 안 통합 (옵션 B 권고). persistence axis 의 2 nested describe (Sprint 38 `tab state persistence` + Sprint 76 `per-tab sort persistence`) 가 동일 패턴 공유 → 단일 helper 호출로 일원화.
- `buildRunningQueryTabState` — helper 파일 안 승격 (사전 inline `seedRunningQueryTab` from L2075-2091). `setState` payload-builder 패턴으로 변경 (lint 회피 — 헬퍼 안 `useTabStore` 런타임 참조 금지).
- `emptyTabStoreState` — helper 파일 안 승격. `setState` payload-builder 패턴.

## Lint 회피 — Helper 안 `useTabStore` 런타임 참조 금지

`eslint.config.js` `no-restricted-imports` 규칙이 `src/stores/**/*.ts` (excluding `*.test.ts`) 에 적용. 패턴 `["@stores/*", "./*Store", "../**/*Store"]` 가 helper 의 `import { useTabStore } from "../tabStore"` 까지 차단 (rule comment: "store 파일끼리 import 금지").

해결: helper 는 type-only import (`type TableTab, QueryTab, Tab from "../tabStore"`) + payload-builder pattern (`emptyTabStoreState()` / `buildRunningQueryTabState()`) 사용. 각 axis 파일이 `useTabStore` 를 직접 import 하고 `useTabStore.setState(emptyTabStoreState())` / `useTabStore.setState(buildRunningQueryTabState(...))` 형태로 호출.

`allowTypeImports: true` 가 type import 를 허용해 `TableTab` / `QueryTab` / `Tab` 의 type re-export 는 가능. 새 `eslint-disable*` 추가 0.

## Sprint 130 Dynamic Import 보존

lifecycle-actions axis 의 Sprint 130 6 case 가 사전과 동일하게 inline `await import("./connectionStore")` 패턴 사용. module-top static import 시 `no-restricted-imports` 위반.

`grep -c 'await import("./connectionStore")' src/stores/tabStore.lifecycle-actions.test.ts` = 6 (사전 동일).

## Sprint 212 Trailing Comment

L2226-2232 (사전) 의 7-line trailing block (`recordHistory` 제거 + AC-195-03/AC-196-02 의 source-of-truth 이동 설명) 이 lifecycle-actions axis 의 outer Sprint 195 describe 끝에 verbatim 보존 (사후 L377-383).

## Assumptions

- axis 파일 이름: spec 권고와 일치 (lifecycle / query / preview / persistence / sort / lifecycle-actions).
- helper 파일 위치: 옵션 B (`src/stores/__tests__/tabStoreTestHelpers.ts`).
- 사전 entry 처리: 옵션 1 (제거).
- case 분배: spec 권고와 일치 (7 + 20 + 19 + 13 + 19 + 24 = 102).
- Sprint 195 doubly-nested describe: 옵션 B (보존).
- `seedRunningQueryTab` (사전 inline) → `buildRunningQueryTabState` (helper 승격, payload-builder 패턴).
- `installFakeLocalStorage` (사전 2회 verbatim 중복) → helper 안 단일화.

## Residual Risk

- vitest worker-per-file 격리에 의존 (tabCounter / queryCounter module-scope reset). 사전 동일 패턴 유지.
- helper 안 `useTabStore` 런타임 import 가 lint 위반이라 payload-builder 패턴으로 전환. 의미 보존 (axis 파일이 명시적으로 setState 호출 → 행동 동일) 하지만 사전 inline `seedRunningQueryTab` 함수 자체와 미묘하게 다름. 행동 결과는 byte-equivalent (실험: 사후 102 case 모두 통과).
- Sprint 195 outer describe 의 `sampleResult` / `stmt` factory 는 그대로 outer scope 에 inline 잔존 (helper 승격 안 함).
- 사용자 작업 영역 (`src/components/query/QueryTab.tsx` working tree change) 는 본 sprint 격리 외부.

## 검증 명령 (재현)

```sh
pnpm vitest run src/stores/tabStore*.test.ts   # 6 files / 102 passed
pnpm vitest run                                # 207 files / 2720 passed
pnpm tsc --noEmit                              # exit 0
pnpm lint                                      # exit 0
ls src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts
test -f src/stores/tabStore.test.ts && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/stores/__tests__/tabStoreTestHelpers.ts | wc -l   # 7
git diff --stat src/stores/tabStore.ts src/stores/tabStore/   # 0
```

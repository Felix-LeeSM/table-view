# Sprint 221 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- 신규 6 axis test 파일 (사전 1 mega file 의 axis-별 분배):
  - `src/stores/tabStore.lifecycle.test.ts` (7 cases) — root describe (addTab / activates existing / removeTab / sets active to previous / setActiveTab / setSubView / subView persists across tabs).
  - `src/stores/tabStore.query.test.ts` (20 cases) — `query tab actions` (13) + `loadQueryIntoTab` (7).
  - `src/stores/tabStore.preview.test.ts` (19 cases) — `preview tab system` (14) + `addTab permanent option` (5).
  - `src/stores/tabStore.persistence.test.ts` (13 cases) — `tab state persistence` (9) + `per-tab sort persistence` (4) — `installFakeLocalStorage()` helper 통합.
  - `src/stores/tabStore.sort.test.ts` (19 cases) — `moveTab` (6) + `reopen last closed tab` (4) + `per-tab sort state` (9).
  - `src/stores/tabStore.lifecycle-actions.test.ts` (24 cases) — `setTabDirty / dirtyTabIds` (6) + `RDB database autofill (Sprint 130)` (6) + `SYNCED_KEYS allowlist (AC-153-06)` (3) + `query lifecycle actions (sprint-195)` (9, **L2 nested 2개 보존**).
- 신규 shared helper: `src/stores/__tests__/tabStoreTestHelpers.ts` (7 named export = `makeTableTab` / `getTableTab` / `getQueryTab` / `emptyTabStoreState` / `installFakeLocalStorage` / `restoreLocalStorage` / `buildRunningQueryTabState`). type-only `useTabStore` import (lint 회피) + payload-builder pattern.
- 삭제: `src/stores/tabStore.test.ts` (사전 2,234 lines / 102 cases, 옵션 1 채택).
- `docs/sprints/sprint-221/{spec,contract,execution-brief,findings,evaluator-scorecard,handoff}.md`.

case 합계 = lifecycle 7 + query 20 + preview 19 + persistence 13 + sort 19 + lifecycle-actions 24 = **102** (사전 동일).

## 다음 sprint 후보

PLAN.md 의 잔여 시퀀스 (post-209 cycle):

- **P11 step 5** — `DataGrid.test.tsx` (1,906 lines / 75 cases) axis split.
- **P10** (Sprint 219) — `connectionStore` / `schemaStore` 의 toast / session / IPC orchestration → use-case hook 점진 이동. risk 높음 — 사용자 hooks/lib 작업 안정 후 진입.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `pnpm vitest run src/stores/tabStore*.test.ts` | 6 files / 102 passed, exit 0 |
| `pnpm vitest run` (full suite) | 207 files / 2720 tests passed, exit 0 (사전 202 + 6 axis - 1 entry = 207 ∈ [206, 209] ✓) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |
| 신규 axis 파일 수 | 6 (∈ [5, 7] ✓) |
| 신규 axis case 합계 | 102 (사전 동일 ✓) |
| `git diff --stat src/stores/tabStore.ts` | 0 |
| `git diff --stat src/stores/tabStore/` | 0 (3 sub-file 모두) |
| 9 sibling store test/source diff | 모두 0 |
| Sprint 216/218/220 산출물 diff | 모두 0 (axis 16 + helper 3) |
| 새 `eslint-disable*` 매치 | 0 |
| 20 verbatim AC string 보존 | 각 정확히 1 매치 |
| Helper named export | 7 (≥ 5) |
| Helper 외부 import | 6 (= axis 파일 수) |
| `it.only` / `it.skip` | 0 |
| 각 axis 파일 root describe | 1개씩 (lifecycle-actions axis 만 옵션 B doubly-nested 2개 보존 = 총 describe 3개) |
| 각 axis 파일 vi.mock factory / vi.spyOn | 0 / 0 (사전 0 동일) |
| Helper 안 cross-store import | 0 (lint rule 회피) |

## Acceptance Criteria 결과

- AC-01 사후 tabStore*.test.ts 합계 102 통과 ✓
- AC-02 신규 axis 6개 (∈ [5-7]) + 각 7-24 case + sibling 충돌 0 ✓
- AC-03 helper named export 7 + 외부 import 6 (= axis 수) ✓
- AC-04 사전 entry 옵션 1 (제거) 채택 ✓
- AC-05 20 verbatim AC string 모두 정확히 1 매치 + Global AC 1-10 충족 ✓

Evaluator: **PASS** (Correctness 9 / Completeness 9 / Reliability 10 / Verification Quality 9). P1/P2 finding 0건. F-001 (helper rename `resetTabStore` → `emptyTabStoreState` + `seedRunningQueryTab` → `buildRunningQueryTabState` for payload-builder pattern) P3.

## 주의 사항

### Mock 격리 — vitest worker-per-file 의존

vitest 의 worker-per-file 격리에 의존해 `tabCounter` / `queryCounter` module-scope counter 가 axis 파일마다 reset. `useTabStore.setState(emptyTabStoreState())` 패턴이 각 axis 파일 `beforeEach` 마다 verbatim — 사전 inline pattern 과 의미 동일.

### vi.mock factory 0건 / vi.spyOn 0건 — Sprint 220 와 동일

본 mega test 는 사전 0 factory + 0 spy (Sprint 218 의 7 factory 와 다름). axis 파일 + helper 모두 추가 금지. Sprint 130 axis 의 `await import("./connectionStore")` dynamic import 만 6건 inline 보존.

### Sprint 195 doubly-nested describe — 옵션 B 보존

`describe("query lifecycle actions (sprint-195 §3.1 extraction)", ...)` outer = `lifecycle-actions` axis-file root + 2 inner nested (`[AC-195-01]` / `[AC-195-02]`) 보존. Sprint 212 trailing comment block (L2226-2232) outer scope 끝에 verbatim 보존.

### Helper payload-builder pattern (Sprint 220 와 다름)

eslint.config.js `no-restricted-imports` rule (`["@stores/*", "./*Store", "../**/*Store"]`) 이 helper file (`.ts`, not `.test.ts`) 의 runtime `useTabStore` import 차단. 해결: helper 가 type-only import (`import type { TableTab, QueryTab, Tab } from "../tabStore"`) + payload-builder pattern (`emptyTabStoreState()` returns setState payload). axis 파일은 `useTabStore.setState(emptyTabStoreState())` 호출. 새 `eslint-disable*` 0.

### Sprint 130 dynamic import 보존

Sprint 130 axis 안 6 case 모두 `await import("./connectionStore")` inline 보존 (module-top 이동 시 lint 위반).

### 사용자 병행 작업 분리

본 sprint 작업은 `src/stores/tabStore.{axis}.test.ts` + `__tests__/tabStoreTestHelpers.ts` + `docs/sprints/sprint-221/` 안에 격리.

## 검증 명령 (재현)

```sh
pnpm vitest run src/stores/tabStore*.test.ts
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
ls src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts
for f in src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts; do
  echo "$f: $(grep -cE '^\s*it\(' $f) cases / $(grep -cE 'vi\.mock\(' $f) factories"
done
test -f src/stores/tabStore.test.ts && echo "EXISTS" || echo "REMOVED"
grep -nE "^export (function|const)" src/stores/__tests__/tabStoreTestHelpers.ts | wc -l
git diff --stat src/stores/tabStore.ts src/stores/tabStore/  # 0
```

## 미완 / 후속

- **P11 step 5**: 잔여 1 mega test (`DataGrid.test.tsx` 1,906 / 75 cases). 본 sprint 의 axis split + helper extraction pattern reference template 으로 사용 권고.
- **P10** (Sprint 219): stores side-effects refactor — 사용자 hooks/lib 작업 안정 후 진입.
- 본 sprint 후속 candidate (informational, F-001 P3):
  - F-001: helper rename `resetTabStore` → `emptyTabStoreState` + `seedRunningQueryTab` → `buildRunningQueryTabState` (lint rule 회피 payload-builder pattern). spec 권고 vs lint rule 의 내재적 충돌의 lint-prevailing 해결.
- cycle 종료 후 `refactoring-candidates.md` retire 예정.

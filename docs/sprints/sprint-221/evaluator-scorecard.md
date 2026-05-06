# Sprint 221 Evaluator Scorecard

`tabStore.test.ts` (2,234 lines / 102 cases) → 6 axis + 1 helper split. P11 step 4. Independent verification of Generator output against contract.md.

## Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness** | 9/10 | All 6 axis files match the spec breakdown (lifecycle 7 / query 20 / preview 19 / persistence 13 / sort 19 / lifecycle-actions 24 = 102). Sprint 195 옵션 B (doubly-nested describe 보존) confirmed at L252+L318 of `tabStore.lifecycle-actions.test.ts` (`grep -c 'describe("\[AC-195-0' = 2`). Sprint 130 dynamic `await import("./connectionStore")` pattern preserved (6 occurrences). Sprint 212 trailing comment block preserved at L377-383. Phase 13 AC-13-06 comment preserved at preview L251. 20 verbatim AC strings each match exactly once. -1 for naming deviation (`emptyTabStoreState` / `buildRunningQueryTabState` instead of spec's `resetTabStore` / `seedRunningQueryTab`) — see Findings P3-1. |
| **Completeness** | 9/10 | AC-01 through AC-05 all satisfied (102 case pass / 6 axis ∈ [5,7] / helper named exports = 7 ≥ 5 / 옵션 1 entry removed / 20 verbatim string match). Global AC 1-10 all satisfied (사전 102 case pass + sibling drift 0 + Sprint 216/218/220 산출물 drift 0 + new eslint-disable 0 + it.only/it.skip 0 + cross-store import in helper 0). Helper named export count (7) exceeds spec recommendation. -1 for deviation from named export spec (resetTabStore → emptyTabStoreState rename, payload-builder pattern). |
| **Reliability** | 10/10 | `pnpm vitest run src/stores/tabStore*.test.ts`: exit 0 / 6 files / 102 passed. `pnpm vitest run`: exit 0 / 207 files / 2720 tests (∈ [206, 209] envelope). `pnpm tsc --noEmit`: exit 0. `pnpm lint`: exit 0 (helper's payload-builder pattern correctly avoids `no-restricted-imports` violation). All 20 contract.md checks pass. |
| **Verification Quality** | 9/10 | findings.md is comprehensive with per-check evidence + AC mapping + verbatim string matches. Helper rename rationale (lint rule conflict) explicitly documented + payload-builder pattern justified. Sprint 195 옵션 B / Sprint 130 dynamic import / Sprint 212 trailing comment all named with line refs. -1 for not explicitly noting that the spec recommendation `resetTabStore` (wraps setState) is internally contradictory with the spec's own lint rule constraint — Generator should have flagged this conflict more prominently. |
| **Overall** | **9.25/10** | All required dimensions ≥ 9. PASS threshold (≥ 7) cleared with margin. |

## Verdict: PASS

## Sprint Contract Status (20 Checks)

| # | Check | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | `pnpm vitest run src/stores/tabStore*.test.ts` exit 0 + 102 cases | PASS | 6 files / 102 passed / 1.22s |
| 2 | `pnpm vitest run` exit 0 / file count [206, 209] / tests = 2720 | PASS | 207 files / 2720 tests / 52.39s |
| 3 | `pnpm tsc --noEmit` exit 0 | PASS | clean exit |
| 4 | `pnpm lint` exit 0 | PASS | clean exit |
| 5 | `find src/stores -maxdepth 1 -name "tabStore.*.test.ts" -not -name "tabStore.test.ts"` ∈ [5,7] | PASS | 6 axis files |
| 6 | axis case 합계 ∈ [97, 102] | PASS | 7 + 20 + 19 + 13 + 19 + 24 = 102 |
| 7 | `git diff --stat src/stores/tabStore.ts` 0 | PASS | 0 |
| 8 | `git diff --stat src/stores/tabStore/` 0 (3 sub-files) | PASS | 0 |
| 9 | 9 sibling store diff 0 | PASS | 모두 0 |
| 10 | Sprint 216/218/220 산출물 diff 0 | PASS | 모두 0 (SchemaTree axis 6 + helper / QueryTab axis 6 + helper / StructurePanel axis 4 + helper) |
| 11 | new `eslint-disable*` count 0 | PASS | `git diff src/stores/ | grep "^+.*eslint-disable" | wc -l` = 0 |
| 12 | 20 verbatim AC string each ≥ 1 match | PASS | 17 일반 + 3 bracket-prefix `[AC-195-01-1] / [AC-195-01-2] / [AC-195-02-1]` = 20 모두 정확히 1 매치 |
| 13 | 옵션 1 채택 (entry 제거) OR 옵션 2 (smoke ≤ 5 + < 200 lines) | PASS | 옵션 1 — `tabStore.test.ts` REMOVED |
| 14 | helper named export ≥ 5 | PASS | 7 named export (`makeTableTab` / `getTableTab` / `getQueryTab` / `emptyTabStoreState` / `installFakeLocalStorage` / `restoreLocalStorage` / `buildRunningQueryTabState`). 기 spec recommended `resetTabStore` / `seedRunningQueryTab` 의 payload-builder rename — 의미 동일, 명칭 변경. |
| 15 | helper external imports ≤ 6 (= 신규 axis 파일 수) | PASS | 6 (= 6 axis 파일 from `lifecycle` / `query` / `preview` / `persistence` / `sort` / `lifecycle-actions`) |
| 16 | `it.only` / `it.skip` 0 | PASS | grep exit 1 (no match) |
| 17 | 각 axis root describe 1개 (Sprint 195 옵션 B 시 lifecycle-actions 의 outer + 2 nested = 3 OK) | PASS | 6 axis 파일 모두 root describe = 1 (column-1). Sprint 195 nested 2 describe 는 lifecycle-actions 안 inner block (column-4 indent). |
| 18 | axis + helper 안 `vi.mock\(` 0 (사전 0 — 추가 금지) | PASS | 모두 0 |
| 19 | axis + helper 안 `vi.spyOn\(` 0 (사전 0 — 추가 금지) | PASS | 모두 0 |
| 20 | helper 안 cross-store import 0 | PASS | helper 의 import line 2개 = `vi from "vitest"` + `import type { TableTab, QueryTab, Tab } from "../tabStore"` (type-only — `allowTypeImports: true` 가 허용). cross-store import 0. |

## Acceptance Criteria

### AC-01 — 102 case pass
- PASS. `pnpm vitest run src/stores/tabStore*.test.ts` → exit 0 / 6 files / 102 passed. axis 합계 = 정확히 102 (옵션 1 채택).

### AC-02 — 신규 axis 5-7개
- PASS. 6 axis 파일 ∈ [5, 7]. case envelope: 7 / 13 / 19 / 19 / 20 / 24 — 각 ≥ 5 + ≤ 30. sibling 9 / Sprint 216/218/220 산출물 모두 변경 0 → 충돌 0.

### AC-03 — Helper 옵션 B
- PASS. `src/stores/__tests__/tabStoreTestHelpers.ts` 신규. named export 7 ≥ 5. 외부 import 6 (= axis 파일 수). helper 안 cross-store import 0. naming deviation (`emptyTabStoreState` instead of `resetTabStore`, `buildRunningQueryTabState` instead of `seedRunningQueryTab`) 은 P3-1 finding (spec 권고 vs lint rule 충돌의 lint-prevailing 결정).

### AC-04 — 옵션 1 (entry 제거)
- PASS. `src/stores/tabStore.test.ts` REMOVED. axis 합계 = 정확히 102 = 사전 102.

### AC-05 — 20 verbatim AC string
- PASS. 17 일반 + 3 bracket-prefix = 20 verbatim string 모두 정확히 1 매치. (`grep -rnF` 검증.) Sprint 130 (Capital S) / sprint 129 (lowercase) / em-dash `—` / arrow `→` / `(AC-06)` / `(AC-07, AC-10)` / `(AC-08)` / `[AC-195-01-1..6]` / `[AC-195-02-1..3]` 모두 byte-equivalent.

## Findings

### P1 (블로커) — 0 건
- N/A.

### P2 (메이저) — 0 건
- N/A.

### P3 (마이너) — 1 건

#### P3-1: Helper named export rename — `resetTabStore` → `emptyTabStoreState` / `seedRunningQueryTab` → `buildRunningQueryTabState`

- **Current**: helper 가 payload-builder 패턴 (`emptyTabStoreState()` returns setState payload object) 사용. axis 파일이 `useTabStore.setState(emptyTabStoreState())` 형태로 호출.
- **Spec recommendation** (`docs/sprints/sprint-221/spec.md` L46): `resetTabStore()` "wraps `useTabStore.setState({...})`" → 즉 helper 안 `useTabStore` runtime import + 호출.
- **Conflict**: 같은 spec L41-42 가 "헬퍼 안 cross-store import 금지" + `eslint.config.js` `no-restricted-imports` 가 `src/stores/**/*.ts` (excluding `*.test.ts`) 에 적용 + pattern `../**/*Store` 가 `from "../tabStore"` 를 차단. `allowTypeImports: true` 만 type import 를 허용 → runtime `useTabStore` import 는 lint 위반.
- **Impact**: 의미 동일 (axis 가 명시적으로 setState 호출 → 결과 동일). 102 case 모두 통과. 단 spec 권고 명칭 변경 = 다른 sibling sprint (216/218/220) 대비 helper 패턴 inconsistency 가능성.
- **Severity**: P3 (마이너) — 행동 변경 0, AC 위반 0, lint 회피 강제 결과. P1/P2 아님.
- **Suggestion**: spec 의 lint rule 인용은 정확하되 권고된 helper API (`resetTabStore`/`seedRunningQueryTab`) 이 lint 회피와 동시에 충족 불가능 — 향후 spec 작성 시 helper API 권고는 lint rule 와 동시 검증 (즉 권고 직후 lint rule 와의 호환성 명시). 현 sprint 는 그대로 PASS — 별도 follow-up 불필요.

### P4 (최소) — 0 건
- N/A.

## Verification Run Log

```sh
# Check 1: axis vitest
$ pnpm vitest run src/stores/tabStore*.test.ts
Test Files  6 passed (6)
Tests       102 passed (102)
Duration    1.22s

# Check 2: full vitest
$ pnpm vitest run
Test Files  207 passed (207)
Tests       2720 passed (2720)
Duration    52.39s

# Check 3-4: tsc + lint
$ pnpm tsc --noEmit  # exit 0
$ pnpm lint           # exit 0

# Check 5: axis file count
$ find src/stores -maxdepth 1 -name "tabStore.*.test.ts" -not -name "tabStore.test.ts" | wc -l
6

# Check 6: per-file case counts
src/stores/tabStore.lifecycle.test.ts:           7 cases
src/stores/tabStore.query.test.ts:               20 cases
src/stores/tabStore.preview.test.ts:             19 cases
src/stores/tabStore.persistence.test.ts:         13 cases
src/stores/tabStore.sort.test.ts:                19 cases
src/stores/tabStore.lifecycle-actions.test.ts:   24 cases
Total: 102

# Check 7-8: tabStore + sub-files diff
$ git diff --stat src/stores/tabStore.ts                     # (empty)
$ git diff --stat src/stores/tabStore/                       # (empty)

# Check 9-10: sibling drift
$ git diff --stat <9 sibling> <Sprint 216/218/220 산출물>     # (empty)

# Check 11: eslint-disable
$ git diff src/stores/ | grep "^+.*eslint-disable" | wc -l   # 0

# Check 12: 20 verbatim string match (각 = 1)
# 17 일반 + 3 bracket-prefix 모두 정확히 1 매치

# Check 13: entry 처리
$ test -f src/stores/tabStore.test.ts && echo EXISTS || echo REMOVED
REMOVED

# Check 14: helper named export ≥ 5
7 named export — makeTableTab / getTableTab / getQueryTab / emptyTabStoreState
                / installFakeLocalStorage / restoreLocalStorage / buildRunningQueryTabState

# Check 15: helper external imports
$ grep -rn "tabStoreTestHelpers" src/ e2e/ | wc -l  # 6 (= 6 axis 파일)

# Check 16: it.only / it.skip 0
$ grep -nE "(it|describe)\.only\(|(it|describe)\.skip\(" src/stores/tabStore*.test.ts # exit 1 (no match)

# Check 17: root describe 1
$ for f in src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts; do
    echo "$f: $(grep -cE '^describe\(' "$f")"
  done
모두 1

# Check 18-19: vi.mock / vi.spyOn 0
$ for f in src/stores/tabStore.{lifecycle,query,preview,persistence,sort,lifecycle-actions}.test.ts \
           src/stores/__tests__/tabStoreTestHelpers.ts; do
    echo "$f: $(grep -cE 'vi\.mock\(' "$f") factory / $(grep -cE 'vi\.spyOn\(' "$f") spy"
  done
모두 0/0

# Check 20: helper cross-store import
$ grep -nE "^import.*(connectionStore|queryHistoryStore|mruStore|schemaStore|documentStore|favoritesStore|safeModeStore|themeStore)" \
    src/stores/__tests__/tabStoreTestHelpers.ts | wc -l
0

# 추가: Sprint 195 옵션 B
$ grep -c 'describe("\[AC-195-0' src/stores/tabStore.lifecycle-actions.test.ts
2

# 추가: Sprint 130 dynamic import preservation
$ grep -c 'await import("./connectionStore")' src/stores/tabStore.lifecycle-actions.test.ts
6
```

## Exit Criteria

- Open `P1`/`P2` findings: **0** ✓
- Required checks passing: **20/20** ✓
- Acceptance criteria evidence linked: **AC-01..05 모두 PASS** ✓
- AC-01 ✓ / AC-02 ✓ / AC-03 ✓ / AC-04 ✓ / AC-05 ✓
- 6 axis test 파일 + 1 helper 파일 신규 / 1 entry 파일 제거 / `tabStore.ts` + sub-file 3 + 9 sibling + Sprint 216/218/220 산출물 모두 변경 0
- 사전 102 case 모두 사후 통과 (axis 분배: 7 + 20 + 19 + 13 + 19 + 24 = 102)
- vi.mock factory / vi.spyOn 사전 0건 → 사후 0건 (보존)
- 20 verbatim AC string 모두 사후 axis 파일 안 정확히 1매치
- Sprint 195 doubly-nested describe 옵션 B 보존 확인 (`describe("[AC-195-0` × 2)
- helper 안 cross-store import 0 (lint rule 회피 — payload-builder 패턴)

## Verdict Summary

**PASS** — Sprint 221 (P11 step 4) 의 모든 contract 요건 충족. 0 P1/P2 finding. 1 P3 finding (helper rename) 은 spec 권고와 lint rule 의 내재적 충돌의 lint-prevailing 해결 — 별도 follow-up 불필요. orchestrator 가 commit 진행 가능.

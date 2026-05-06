# Sprint 220 — Evaluator Scorecard

## Verdict: PASS

Independent verification confirms Generator's claims. All 20 contract checks pass, all
five Acceptance Criteria (AC-01..AC-05) and Global AC 1-10 satisfied with concrete
evidence, and no behavioural drift observed against `StructurePanel.tsx` /
`StructurePanel.first-render-gate.test.tsx` / 11+ sibling tests / Sprint 216 outputs.

## Dimensions

- **Correctness: 9/10** — Code does exactly what the spec says.
  - 4 axis files (`StructurePanel.{overview,columns,indexes,constraints}.test.tsx`) +
    1 helper (`__tests__/structurePanelTestHelpers.tsx`) + entry-file removal (옵션 1).
  - Sprint 179 nested describe preserved (옵션 B) inside `overview.test.tsx`
    L454: `describe("paradigm-aware vocabulary (Sprint 179)", () => {…})`.
  - 22 verbatim AC strings each match exactly 1 `it(...)` site.
  - Pre-state mega-test: 2,156 lines / 84 cases (verified via
    `git show HEAD:…StructurePanel.test.tsx | grep -cE '^\s*it\('`).
  - Post-state axis-sum: 28 + 26 + 16 + 14 = 84 cases, identical to pre-state.
  - 0 vi.mock factories pre/post (사전 동일 invariant satisfied).
  - 5 `vi.spyOn(tauri, ...)` calls live in helper's `resetStructurePanelMocks()`
    (lines 154/157/160/163/166 — alterTable / createIndex / dropIndex /
    addConstraint / dropConstraint), called from each axis's `beforeEach`.
  - Helper exports exactly 9 named symbols (3 fixture + 3 mock fn + 2 helper +
    1 reset), no default export.
  - Minor deduction: `constraints` axis has 14 cases vs spec recommendation of ~17
    (-3 vs ±2 discretion); however, the binding invariant is "84 case sum" — the
    spec recommendations sum to 87, which is internally inconsistent. The
    Generator's distribution preserves the 84-case invariant, which dominates.
    Still, this is a small documentation coherence gap relative to spec authoring.

- **Completeness: 9/10** — All AC covered with concrete evidence.
  - AC-01..AC-05 each backed by independent re-runs (see "AC Pass/Fail" + "20
    Check Results" sections below).
  - Global AC 1-10 of spec.md all confirmed: 행동 변경 0, 84 cases preserved,
    pattern preservation, ARIA labels intact, fixture data shape preserved
    (MOCK_COLUMNS/INDEXES/CONSTRAINTS byte-equivalent), beforeEach pattern
    consolidated into helper, public surface frozen, 0 new eslint-disable, file
    count 199→202 ∈ [201, 204], sibling drift 0.
  - Minor: 함수형 export 카운트 9 정확히 충족, but spec.md recommended `.ts`
    extension whereas helper is `.tsx` (JSX necessity — see Findings F-002).

- **Reliability: 10/10** — All required gates green.
  - `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` →
    **5 files / 89 tests passed** (exit 0; 84 axis + 5 first-render-gate).
  - `pnpm vitest run` → **202 files / 2720 tests passed** (exit 0).
  - `pnpm tsc --noEmit` exit 0.
  - `pnpm lint` exit 0.
  - 0 `it.only` / `it.skip`, 0 silent `catch{}`, 0 new `eslint-disable`,
    0 new `any`.
  - No flaky markers (no `retry`, no `setTimeout` without fake-timer guard;
    `vi.useFakeTimers()` is correctly paired with `vi.useRealTimers()` in
    overview's spinner test).

- **Verification Quality: 9/10** — Findings packet (`docs/sprints/sprint-220/findings.md`)
  is detailed and matches independent re-verification.
  - Each of 20 checks reproduced with concrete output (exit codes, file
    counts, grep-match counts).
  - 22 verbatim AC strings table maps each to its exact axis location.
  - Two assumptions explicitly disclosed: (a) `.tsx` extension vs spec's `.ts`
    headline, and (b) constraints axis -3 vs spec recommendation.
  - Minor deduction: helper file `.tsx` extension trade-off is well-explained,
    but the spec.md text headline says `.ts` and was not revised; that's a
    spec-authoring inconsistency rather than implementation flaw, but the
    finding could be elevated to a P3 doc-coherence note for a follow-up
    sprint to amend spec.md.

## Findings

- **F-001 (P3, informational)**: `constraints` axis case count = 14, vs spec.md
  권고 ~17, vs generator discretion ±2 → -3 deviation. The contract's binding
  invariant is "84 case sum" (AC-01); spec recommendations 28+26+16+17=87 are
  internally inconsistent. Generator chose to preserve the 84-case invariant,
  which is correct. AC-02 ("each axis ≥ 5 case + ≤ 30 case") satisfied (14 ∈
  [5, 30]). No P1/P2 risk; recommendation is to amend spec.md in a follow-up
  doc-only sprint to align headline numbers with reality (e.g., constraints ~14).

- **F-002 (P3, informational)**: Helper file extension `.tsx` (not `.ts` per
  spec.md headline at line 38). Cause: `renderPanel(props)` returns
  `<StructurePanel ... />` JSX (lines 135-141 of helper) — TypeScript requires
  `.tsx` for JSX. Contract Check 16 (`grep -rn "structurePanelTestHelpers"`) is
  extension-agnostic; AC-03 ("named export 9 + 외부 import 0") satisfied. Per
  Sprint 218 model, `queryTabTestHelpers.ts` had no JSX so `.ts` was viable;
  this sprint differs because `renderPanel` is part of the helper. Generator's
  trade-off note in findings.md is correct. No P1/P2 risk.

- **F-003 (P3, informational)**: Findings.md table erroneously labels
  `MOCK_COLUMNS / MOCK_INDEXES / MOCK_CONSTRAINTS` as "fixture constant"
  before the 3 mock fn — that ordering matches helper file (lines 28/61/85
  precede 113/114/115). The helper export ordering is fixture → mock fn,
  which matches Sprint 218 model. Confirmed via independent grep. Cosmetic
  note only.

## AC Pass/Fail

- **AC-01** ✅ PASS — `pnpm vitest run src/components/schema/StructurePanel*.test.tsx`
  exit 0; 5 files / 89 tests passed (84 axis + 5 first-render-gate). Pre-state
  case count matches: 사전 84 verified via `git show HEAD:…StructurePanel.test.tsx |
  grep -cE '^\s*it\('` = 84.

- **AC-02** ✅ PASS — Axis files = 4 ∈ [3, 5]. Per-axis case counts:
  overview = 28, columns = 26, indexes = 16, constraints = 14 — each in [5, 30].
  `git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx` = 0.

- **AC-03** ✅ PASS — Helper file
  `src/components/schema/__tests__/structurePanelTestHelpers.tsx` has named
  export 9 (3 fixture: MOCK_COLUMNS/INDEXES/CONSTRAINTS at L28/L61/L85;
  3 mock fn: mockGetTableColumns/Indexes/Constraints at L113/L114/L115;
  2 helper: setStoreState/renderPanel at L119/L128; 1 reset:
  resetStructurePanelMocks at L148). External imports = 4 (= axis file count,
  no other consumer in src/ or e2e/).

- **AC-04** ✅ PASS — 옵션 1 채택. `test ! -f
  src/components/schema/StructurePanel.test.tsx` = true (file removed in git).

- **AC-05** ✅ PASS — 22 verbatim AC string each match ≥ 1.
  19 plain strings + 3 bracket-prefix strings (AC-179-02a/03a/04a with
  literal `paradigm="document"` / `\"rdb\"` / `paradigm undefined falls back`
  byte-equivalent). Global AC 1-10 of spec.md all verified.

## 20 Check Results

| # | Check | Result | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm vitest run src/components/schema/StructurePanel*.test.tsx` exit 0 | ✅ | 5 files / 89 tests passed (84 axis + 5 first-render-gate). Duration 2.76s |
| 2 | `pnpm vitest run` exit 0 + file count [201, 204] + tests = 2720 | ✅ | 202 files / 2720 tests passed. Duration 60.70s |
| 3 | `pnpm tsc --noEmit` exit 0 | ✅ | exit 0 |
| 4 | `pnpm lint` exit 0 | ✅ | exit 0 |
| 5 | axis 파일 수 ∈ [3, 5] | ✅ | `find ... | wc -l` = 4 |
| 6 | 합계 case ∈ [79, 84] | ✅ | 28+26+16+14 = 84 |
| 7 | `git diff --stat src/components/schema/StructurePanel.tsx` | ✅ | empty (exit 0) |
| 8 | `git diff --stat …first-render-gate.test.tsx` | ✅ | empty (exit 0) |
| 9 | SchemaTree.tsx + SchemaTree/ frozen | ✅ | empty (exit 0) |
| 10 | 11 SchemaTree axis test files frozen | ✅ | empty (exit 0) — verified all 11 (lifecycle/expand/refresh/search/actions/highlight/dbms-shape/preview/preview.entrypoints/rowcount/virtualization) |
| 11 | __tests__/schemaTreeTestHelpers.ts + 7 sibling frozen | ✅ | empty (exit 0) — schemaTreeTestHelpers.ts/SchemaPanel.{tsx,test.tsx}/DocumentDatabaseTree.{tsx,test.tsx}/ViewStructurePanel.{tsx,test.tsx}/treeShape.ts |
| 12 | `git diff src/components/schema/ \| grep "^+.*eslint-disable"` | ✅ | 0 |
| 13 | 22 verbatim AC string each ≥ 1 | ✅ | 19 plain @ 1 each + 3 bracket-prefix @ 1 each |
| 14 | 옵션 1 채택 → entry file 제거 | ✅ | `git status` shows ` D src/components/schema/StructurePanel.test.tsx` |
| 15 | helper named export ≥ 9 | ✅ | grep yields 9 (MOCK_COLUMNS/INDEXES/CONSTRAINTS + mockGetTableColumns/Indexes/Constraints + setStoreState/renderPanel/resetStructurePanelMocks) |
| 16 | helper external import ≤ 4 | ✅ | exactly 4 (= axis count) |
| 17 | axis 파일 안 it.only/it.skip 매치 | ✅ | 0 across all 4 axis files |
| 18 | root describe 1개 (overview 의 nested 옵션 B 포함 시 2개 허용) | ✅ | overview = 2 (root + Sprint 179 nested at L454), columns/indexes/constraints = 1 each. nested only in overview (verified) |
| 19 | axis 파일 안 vi.mock 매치 | ✅ | 0 across all 4 axis files (사전 0 — invariant 보존) |
| 20 | helper 또는 axis 안 vi.spyOn(tauri, ...) 5건 보존 | ✅ | helper has 5 actual spy calls (L154/L157/L160/L163/L166) — alterTable/createIndex/dropIndex/addConstraint/dropConstraint. (raw `grep -c` returned 6 because comment text at L13 also mentions "5 vi.spyOn(tauri, ...)" — the comment is documentation, not a call site.) |

## Recommendations (PASS — follow-up)

- **R-001** (P3): Amend `docs/sprints/sprint-220/spec.md` in a future
  doc-only sprint so axis recommendations sum to 84 (e.g., constraints ~14
  instead of ~17). Current numbers add to 87, which mismatches the binding
  84-case invariant.

- **R-002** (P3): Sprint 218 / 220 helpers diverge on extension (`.ts` vs
  `.tsx`); future P11 step 4-5 (tabStore.test.ts 2,234 / DataGrid.test.tsx
  1,906) should pre-decide based on whether helper exposes JSX `renderXxx`.
  Recommend baking this into `memory/conventions/refactoring/memory.md`'s
  axis-split playbook.

- **R-003** (P3): Constraints axis has only 14 cases — among the smallest
  axis files in the codebase. If post-209 cycle introduces more constraint
  CRUD coverage (e.g., DEFERRED constraints, NOT VALID constraints), it
  could reuse the helper file directly without a re-split.

- **R-004**: Residual risk from Generator's notes — `vitest worker-per-file`
  isolation makes module-top-level `vi.fn()` instances per-file. The
  `clearAllMocks() + mockResolvedValue([...MOCK_*])` reset pattern in
  `resetStructurePanelMocks()` correctly prevents leakage; no action needed.
  Tracked as residual only.

## Evidence Bundle (commands rerun by Evaluator)

```sh
# Independent re-verification
pnpm vitest run src/components/schema/StructurePanel*.test.tsx
# Files  5 passed (5) / Tests  89 passed (89) — exit 0

pnpm vitest run
# Files  202 passed (202) / Tests  2720 passed (2720) — exit 0

pnpm tsc --noEmit  # exit 0
pnpm lint          # exit 0

# Pre-state baseline
git show HEAD:src/components/schema/StructurePanel.test.tsx | grep -cE '^\s*it\('
# 84
git show HEAD:src/components/schema/StructurePanel.test.tsx | wc -l
# 2156

# Axis case distribution
for f in src/components/schema/StructurePanel.{overview,columns,indexes,constraints}.test.tsx; do
  echo "$(basename $f): $(grep -cE '^\s*it\(' $f) cases"
done
# overview 28, columns 26, indexes 16, constraints 14 — total 84

# 22 verbatim AC strings — each matched exactly 1 it()
# (19 plain + 3 bracket-prefix [AC-179-02a/03a/04a])

# Sibling freeze (all empty / exit 0)
git diff --stat src/components/schema/StructurePanel.tsx
git diff --stat src/components/schema/StructurePanel.first-render-gate.test.tsx
git diff --stat src/components/schema/SchemaTree.tsx src/components/schema/SchemaTree/
git diff --stat src/components/schema/SchemaTree.{lifecycle,expand,refresh,search,actions,highlight,dbms-shape,preview,preview.entrypoints,rowcount,virtualization}.test.tsx
git diff --stat src/components/schema/__tests__/schemaTreeTestHelpers.ts
git diff --stat src/components/schema/SchemaPanel.test.tsx src/components/schema/SchemaPanel.tsx
git diff --stat src/components/schema/DocumentDatabaseTree.test.tsx src/components/schema/DocumentDatabaseTree.tsx
git diff --stat src/components/schema/ViewStructurePanel.test.tsx src/components/schema/ViewStructurePanel.tsx
git diff --stat src/components/schema/treeShape.ts
# All empty → all sibling files frozen

# Helper shape
grep -nE "^export (function|const)" src/components/schema/__tests__/structurePanelTestHelpers.tsx | wc -l
# 9

grep -rn "structurePanelTestHelpers" src/ e2e/ | wc -l
# 4 (= axis count)

grep -nE 'vi\.spyOn\(tauri,' src/components/schema/__tests__/structurePanelTestHelpers.tsx
# L154/L157/L160/L163/L166 → 5 actual calls (line 13 comment is docstring, not a call)
```

## Decision Justification

All four scorecard dimensions ≥ 7 (9/9/10/9 = 37/40 = 92.5%). 0 P1/P2 findings.
3 P3 informational findings (constraints case count vs spec recommendation,
helper `.tsx` vs spec `.ts`, findings.md table ordering — all cosmetic /
doc-coherence). All 5 AC pass with concrete evidence. All 20 contract checks
pass with reproducible commands. Generator's self-report verified end-to-end.

→ **Verdict: PASS.** Orchestrator may commit.

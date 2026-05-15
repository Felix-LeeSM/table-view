# Sprint 344 / Slice A — Findings (Ghost-node tree traversal)

## Sprint 344 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | All 6 ACs covered with concrete assertions. Helper is pure, no mutation. Insertion-order, parent-end-of-block placement, JSON-parse expand, parse-fail fallback, BSON wrapper classification all behave correctly. Multi-segment dotted path with no intermediate parent (e.g. `pending["a.b.c"]` on empty value) produces a leaf at depth=3 with no synthesized `a` / `a.b` ghost ancestors — not in scope of any Slice-A AC, but worth surfacing to Slice B/D so they only emit single-segment pending keys per affordance. |
| Completeness (25%) | 9/10 | All AC-344-A-01…06 covered by named tests; edge cases requested in the contract (empty `pendingByPath`, all-ghosts on `{}` base, nested under existing parent, `__op__:unset` non-promotion) each carry a dedicated test. Test comment convention (reason + `2026-05-15`) is followed on every new case. |
| Reliability (20%) | 8/10 | Pure helper, no side effects, regression-zero asserted via deep equality. Empty pending Map short-circuits early. Parse-fail caught by try/catch and falls back to string leaf — no crash. Minor: the deferred-bucket splice loop at the tail of the function (`childrenByParent.size > 0`) walks `result` from the end and could land an unexpected position when a ghost parent's path collides with a real path that shares the prefix; with the current depth-sorted enumeration the case is unreachable in practice, but worth a comment for the maintainer. |
| Verification Quality (20%) | 9/10 | All 5 required commands run + reported with concrete counts (41/41 targeted, 3864/10-skipped full, tsc clean, lint clean). Each AC has a named, line-numbered test mapping. The scope-violation flag the orchestrator caught (Generator initially included MongoQueryEditor/SqlQueryEditor changes) was disclosed transparently — small residual concern but did not contaminate Slice-A evidence. |
| **Overall** | **8.75/10** | All dimensions ≥ 7. PASS. |

## Verdict: PASS

All four System-rubric dimensions are ≥ 7. The pre-push and lint gates are green; the targeted suite is green; the full suite is green; tsc is clean.

## Sprint Contract Status (Done Criteria)

- [x] **AC-344-A-01** — Root-level ghost renders as leaf with `isGhost: true` and "NEW" badge.
  - Helper: `src/lib/jsonTree.test.ts` :191 — `"renders a root-level ghost path as a leaf marked isGhost"`. Asserts `tag.isGhost === true`, `tag.leafValue === "alpha"`, and `name.isGhost` falsy.
  - UI: `src/components/document/DocumentTreePanel.test.tsx` :274 — `"renders a root-level ghost path with a NEW badge"`. Uses `within(ghost).getByText("NEW")` and asserts `/edited/` is NOT present on the ghost row.

- [x] **AC-344-A-02** — Edit + add coexist on same parent, no de-dup.
  - Helper: `src/lib/jsonTree.test.ts` :207 — `"does not promote pending paths that already exist in value to ghost"`. Asserts both `name` (pending edit) and `tag` (ghost) render once each.
  - UI: `src/components/document/DocumentTreePanel.test.tsx` :298 — `"renders both an edit on existing-key and a NEW ghost together"`. Asserts `edit` row has `edited` badge but no `NEW`; `ghost` row has `NEW`.

- [x] **AC-344-A-03** — Ghost position = end of parent's children, in `pendingByPath` insertion order.
  - Helper: `src/lib/jsonTree.test.ts` :225 — `"preserves pendingByPath insertion order for sibling ghosts"`. Asserts `rootChildren === ["name", "zeta", "alpha", "mu"]` (insertion order `zeta`, `alpha`, `mu`).
  - Additional helper coverage: `src/lib/jsonTree.test.ts` :289 — `"inserts a ghost child under an existing object parent"` asserts `metaIdx < nameIdx < roleIdx` (end-of-parent placement for nested case).

- [x] **AC-344-A-04** — Nested ghost JSON expand + parse-fail fallback.
  - Helper expand: `src/lib/jsonTree.test.ts` :244 — `"expands a JSON-parseable ghost into a nested ghost subtree"` asserts `meta.kind === "obj"`, `meta.role.leafValue === "owner"`.
  - Helper parse-fail: `src/lib/jsonTree.test.ts` :260 — `"falls back to a string leaf when the ghost value cannot be parsed"` asserts `raw.kind === "leaf"`, `raw.leafType === "string"`, `not.toThrow()`.
  - Helper JSON-array: `src/lib/jsonTree.test.ts` :309 — `"expands a JSON-array ghost into bracket-notation ghost children"` asserts `tags.kind === "arr"`, `tags[0].leafValue === "x"`.
  - Helper record-typed: `src/lib/jsonTree.test.ts` :324 — `"accepts a record-typed pending value as a nested ghost object"` covers the `Record<string, unknown>` branch of the union.
  - UI expand: `src/components/document/DocumentTreePanel.test.tsx` :321 — `"expands a JSON-parseable ghost into nested ghost rows"` asserts inner `tree-node-meta.role` carries `NEW`.
  - UI parse-fail: `src/components/document/DocumentTreePanel.test.tsx` :343 — `"renders a non-JSON ghost value as a plain string leaf"` asserts no crash + `NEW` badge present.

- [x] **AC-344-A-05** — Regression zero on collapse / search / leaf edit / leaf delete.
  - Full-suite vitest: `pnpm vitest run` → 3864 passed / 10 skipped / 321 files. Pre-existing DocumentTreePanel tests (`hides descendants when an ancestor is collapsed`, `filters by leaf value substring`, `commits a leaf edit through onCommitEdit`, `trash icon commits __op__:unset`, `regex toggle switches the search`) all green.
  - Helper sanity: `src/lib/jsonTree.test.ts` :277 — `"matches buildTreeNodes when pendingByPath is empty"` uses `toEqual(base)` to lock the regression-zero baseline.
  - Manual probe: `filterTreeNodes` over a ghost-augmented node list still returns the ghost path when its label matches (verified ad-hoc; ghost rows participate in search like any other node because they live in the same flat `nodes[]`).

- [x] **AC-344-A-06** — Helper testable standalone.
  - `buildTreeNodesWithGhosts` is exported from `src/lib/jsonTree.ts` (line 163) as a pure function `(value, pendingByPath, basePath = "") => TreeNode[]`. Tested in `src/lib/jsonTree.test.ts` without rendering `DocumentTreePanel`.

## Required Checks (from contract `Verification Plan`)

| Check | Status | Evidence |
|-------|--------|----------|
| `pnpm vitest run src/lib/jsonTree.test.ts src/components/document/DocumentTreePanel.test.tsx` | PASS | 2 files, 41/41 tests, 1.24s |
| `pnpm vitest run` (full) | PASS | 321 files, 3864 pass / 10 skipped, 55.09s |
| `pnpm tsc --noEmit` | PASS | clean (no output) |
| `pnpm lint` | PASS | clean (no output) |
| `pnpm vitest run src/components/document/DocumentTreePanel.test.tsx` (per brief) | PASS | included in targeted run above |

## Invariant Audit

- **`DocumentTreePanel` paradigm-agnostic** — `git diff HEAD -- src/components/document/DocumentTreePanel.tsx` introduces **no new** Mongo/RDB imports for Slice A. The pre-existing `@/lib/mongo/bsonTypes` import is from Sprint 342 (BSON inline editor) and is generic JSON-tree concern; not a regression.
- **Leaf edit / `__op__:unset` preserved** — pre-existing tests at `DocumentTreePanel.test.tsx` :164 (`BSON wrapper leaves open BsonTypeEditor`), :190 (`trash icon commits __op__:unset`), :232 (`does not render trash for _id leaves`) all green in the targeted run. New helper test :359 (`does not turn an __op__:unset on an existing leaf into a ghost`) locks the sentinel-non-promotion interaction explicitly.
- **`safeStringifyCell` rule** — grep on the two modified source files shows **zero raw `JSON.stringify`** calls. `JSON.parse` use in `expandedGhostValue` is input parsing (not cell-domain serialization), so the `no-restricted-syntax` rule does not apply. `pnpm lint` clean confirms.
- **Test comment convention** — every new test case in both `jsonTree.test.ts` (lines 183-365) and `DocumentTreePanel.test.tsx` (lines 268-357) carries a one-line reason + `2026-05-15` block comment.

## Edge-Case Probes (executed at evaluation time)

1. **Empty `pendingByPath`** — covered by AC-344-A-06 test (`toEqual(base)`).
2. **Nested ghost depth = 3 via JSON parse** — probed at evaluation time: `pending = {"meta": '{"role":{"sub":"admin"}}'}` correctly produces `meta` (obj-ghost) → `meta.role` (obj-ghost) → `meta.role.sub` (leaf-ghost "admin"). Not formally locked by a test but covered transitively by the JSON-array test on line 309 + the nested-under-existing test on line 289.
3. **`__op__:unset` on existing leaf** — locked at `jsonTree.test.ts` :359.
4. **BSON wrapper string passed as ghost value** — probed at evaluation time: `pending = {"created": '__bson__:{"$date":"..."}'}` correctly classifies the ghost leaf with `leafType: "bson"`, `isBson: true`. Reuses the same classifier the base walker uses (`classifyLeaf`), so BSON wrapper ghosts will render through the existing BSON edit branch in the panel — paradigm-agnostic preserved.
5. **Multi-segment dotted path on empty base** — probed at evaluation time: `pending["a.b.c"] = "deep"` on `value = {}` produces a single leaf at path `a.b.c` with `depth = 3`, with NO intermediate `a` / `a.b` parent ghost rows. This is **not in any AC** and is a non-issue if Slice B/C always emit single-segment pending keys (which the contract implies — affordance commits one path per Enter). Flagged below as a low-severity heads-up.

## Feedback for Generator

1. **[Scope discipline — residual concern]**: The Generator initially modified `MongoQueryEditor.tsx`, `MongoQueryEditor.test.tsx`, `SqlQueryEditor.tsx` (claimed `completionKeymap` order fix). The orchestrator stashed those changes off-scope. This is recorded as a process flag rather than a Slice-A finding, because the evidence packet on the merged scope is clean.
   - Suggestion: If the autocomplete-keymap order is a real bug, file it as a separate sprint or as a sprint-344 follow-up issue. Do not let unrelated transient fixes slip into a Slice-A commit.

2. **[Minor — multi-segment ghost paths]** (LOW): When `pendingByPath` contains a dotted path (e.g. `"a.b.c"`) and neither `a` nor `a.b` exist in `value`, the helper renders only the deepest leaf at depth = 3 with no synthesized intermediate parent rows.
   - Current: leaf row at depth 3 alone, no parent breadcrumb in the tree view.
   - Expected: not specified by any AC — Slice A only contracts root-level + nested-via-JSON-parse expansion.
   - Suggestion: If Slice B's `+ key` affordance never emits a multi-segment key in a single Enter (the spec implies it commits `parentPath + "." + key` where parentPath is the parent's existing or ghost row), this is a non-issue. If Slice D/F integration shows a user-flow that puts multi-segment keys into the pending Map, add a synthesis pass that walks each path segment and emits an intermediate-ghost row when missing.

3. **[Minor — `__op__:unset` on a non-existing path becomes a ghost with the sentinel as its value]** (LOW): Probed `pending = {"doesNotExist": "__op__:unset"}` on `value = {a: 1}` produces a ghost leaf with `leafValue: "__op__:unset"`. The panel would render the literal sentinel text inside a NEW row.
   - Current: ghost row labeled `doesNotExist` with the raw sentinel as its visible value.
   - Expected: not specified by an AC. The pendingByPath shape contract makes this unreachable in practice — the panel never produces `__op__:unset` on a path that isn't already in `value` (the trash button only appears on real leaves, line 391).
   - Suggestion: optional — add an `if (raw === UNSET_OP) continue;` guard in `buildTreeNodesWithGhosts` for defense in depth, or wait until Slice E threat-models the generator dispatch and catches it there.

## Handoff Evidence (for `handoff.md`)

- **Score**: 8.75 / 10
- **Verdict**: PASS
- **Files merged in scope**: 4 (`src/lib/jsonTree.ts`, `src/lib/jsonTree.test.ts`, `src/components/document/DocumentTreePanel.tsx`, `src/components/document/DocumentTreePanel.test.tsx`)
- **Files stashed off-scope by orchestrator**: 3 (`MongoQueryEditor.tsx`, `MongoQueryEditor.test.tsx`, `SqlQueryEditor.tsx`) — preserved, not in this evaluation.
- **Required-check status**: targeted vitest 41/41, full vitest 3864 pass / 10 skipped, tsc clean, lint clean.
- **Open P1/P2 findings**: 0.
- **Slice A exit criteria**: met. Ready for Slice B kickoff.

# Sprint Execution Brief: sprint-177

## Objective

Law of Similarity — paradigm-aware syntax highlighting in the dock-style `QueryLog`. Replace the plain-text rendering at `QueryLog.tsx:115` with the existing `QuerySyntax` paradigm dispatcher so Mongo entries surface MongoDB operator coloring (`cm-mql-operator`) and RDB entries keep the SQL keyword treatment (`text-syntax-keyword`). Sprint 176 has shipped; this builds on top, not replaces.

## Task Why

Three executed-query preview surfaces exist today: `QueryTab` (in-tab history list, `QueryTab.tsx:1025`), `GlobalQueryLogPanel` (`GlobalQueryLogPanel.tsx:211`), and the dock-style `QueryLog` (`QueryLog.tsx:115`). The first two already consume the paradigm-aware `QuerySyntax` dispatcher and color Mongo entries with operator highlighting; the third still emits plain text. A user who runs a Mongo `find` and a PG `SELECT` in the same session sees the dock log treat both identically — a Law-of-Similarity violation that breaks the visual cue established by the other two surfaces. The existing infrastructure (`QuerySyntax`, `MongoSyntax`, `SqlSyntax`, the `paradigm` / `queryMode` fields on `QueryHistoryEntry`) is already shipped — this sprint only wires the last consumer.

## Scope Boundary

In: `src/components/query/QueryLog.tsx`, `src/components/query/QueryLog.test.tsx`, `docs/sprints/sprint-177/findings.md`, `docs/sprints/sprint-177/handoff.md`.

Out: anything in sprints 176 / 178 / 179 / 180; refactoring `QuerySyntax` / `MongoSyntax` / `SqlSyntax` (consumed as-is); new dependencies (no CodeMirror — span tokenization is the established mitigation per spec line 181); QueryLog panel layout changes; truncation length / policy changes; `queryHistoryStore.ts` changes; e2e test changes.

## Invariants

- Existing `QuerySyntax` / `MongoSyntax` / `SqlSyntax` test suites pass without modification beyond extension.
- QueryLog panel layout, search filter, clear-history flow, relative-time formatter, duration badge, status dot, and entry-click → `insert-sql` event are all unchanged.
- The full `entry.sql` (not the truncated preview) is what gets dispatched in `insert-sql`, matching `QueryLog.tsx:48`.
- `truncateSql(entry.sql, 80)` survives at the same call site — truncation length is fixed.
- `QueryTab.test.tsx` and `GlobalQueryLogPanel.test.tsx` diff against `main` is empty.
- No new dependencies; no `package.json` change.
- Skip-zero gate (no `it.skip` / `it.todo` / `xit`); strict TS (no `any`); no `console.log` in production paths.

## Done Criteria

1. `AC-177-01`: Mongo entry in QueryLog renders ≥ 1 element with the `cm-mql-operator` class.
2. `AC-177-02`: RDB entry in QueryLog renders ≥ 1 element with `text-syntax-keyword` AND zero `cm-mql-operator`.
3. `AC-177-03`: Mongo entry whose `paradigm: "document"` is correctly populated never receives SQL coloring (regression guard against the legacy fallback at `queryHistoryStore.ts:75`).
4. `AC-177-04`: 50 mixed-paradigm entries render in one cycle, no `console.error` / `console.warn`, both marker classes present in the rendered DOM.
5. `AC-177-05`: `QueryTab` and `GlobalQueryLogPanel` existing tests pass unmodified.

## Verification Plan

- Profile: `mixed` (browser + command). Browser smoke is operator-driven.
- Required checks:
  1. `pnpm vitest run src/components/query src/components/shared/QuerySyntax src/components/shared/MongoSyntax src/components/shared/SqlSyntax`
  2. `pnpm vitest run` (full suite)
  3. `pnpm tsc --noEmit`
  4. `pnpm lint`
  5. Browser smoke: `pnpm tauri dev`, run a Mongo `find` and an RDB `SELECT`, toggle the QueryLog dock, confirm operator coloring on the Mongo row and keyword coloring on the RDB row, both matching the visual treatment in `QueryTab` and `GlobalQueryLogPanel`.
  6. `grep -n 'truncateSql' src/components/query/QueryLog.tsx` — confirms the truncation policy survives.
- Required evidence:
  - Changed files list with purposes.
  - Vitest output for AC-tagged tests with `[AC-177-0X]` prefix.
  - Marker-class assertions explicit in test source: `cm-mql-operator` and `text-syntax-keyword` literals (matching `MongoSyntax.tsx:23` and `SqlSyntax.tsx:11`).
  - `console.error` spy assertion for AC-177-04.
  - `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` empty.
  - `findings.md` with mechanism note, existing-test migration notes, browser smoke summary.

## Evidence To Return

- Changed files and purpose
- Checks run and outcomes
- Done criteria coverage with evidence (per-AC test name + assertion / class query)
- Assumptions made during implementation (e.g. QuerySyntax wrapping shape — replace span vs. wrap span)
- Residual risk or verification gaps (e.g. mid-token truncation behavior on a malformed JSON edge case, browser smoke skipped if no Mongo seed is available locally — note the gap)
- List of existing-test matchers rewritten and the rewrite pattern used (per the Design Bar migration requirement)

## References

- Contract: `docs/sprints/sprint-177/contract.md`
- Spec: `docs/sprints/sprint-176/spec.md` (Sprint 177 section, lines 32–49; spec hosts all five sprints)
- Action plan: `docs/ux-laws-action-plan.md` §B
- Findings (to be created): `docs/sprints/sprint-177/findings.md`
- Relevant files:
  - `src/components/query/QueryLog.tsx` (plain-text render at line 115)
  - `src/components/shared/QuerySyntax.tsx` (paradigm dispatcher)
  - `src/components/shared/MongoSyntax.tsx` (`cm-mql-operator` at line 23)
  - `src/components/shared/SqlSyntax.tsx` (`text-syntax-keyword` at line 11)
  - `src/components/query/GlobalQueryLogPanel.tsx:211-220` (reference consumption pattern)
  - `src/components/query/QueryTab.tsx:1025-1030` (reference consumption pattern)
  - `src/stores/queryHistoryStore.ts` (paradigm field at line 26; legacy fallback at line 75)
  - `memory/conventions/memory.md` (test rules, naming)
  - `.claude/rules/test-scenarios.md` (scenario checklist)

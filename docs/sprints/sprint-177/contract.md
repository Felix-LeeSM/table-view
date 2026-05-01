# Sprint Contract: sprint-177

## Summary

- Goal: Replace plain-text query rendering in the dock-style `QueryLog` panel with the existing paradigm-aware `QuerySyntax` dispatcher so Mongo entries surface MongoDB operator coloring (`cm-mql-operator`) and RDB entries keep the SQL keyword treatment (`text-syntax-keyword`) — closing the last of three preview surfaces still emitting plain text. Sprint 176 has shipped; this builds on top, not replaces.
- Audience: Generator (single agent) — implements; Evaluator — verifies AC + evidence.
- Owner: harness orchestrator
- Verification Profile: `mixed` (browser + command). Browser smoke is operator-driven.

## In Scope

- `AC-177-01`: When the `QueryLog` panel renders an entry whose `paradigm` is `"document"`, the rendered text contains at least one element bearing the Mongo-operator marker that is unique to `MongoSyntax` output (the existing `cm-mql-operator` class). Verifiable via a Vitest assertion that seeds the history store with a Mongo entry and queries the rendered DOM for that marker.
- `AC-177-02`: When the `QueryLog` panel renders an entry whose `paradigm` is `"rdb"`, the rendered text contains the SQL keyword marker class used by `SqlSyntax` (`text-syntax-keyword`) AND does NOT contain the Mongo-operator marker. Verifiable via a Vitest assertion.
- `AC-177-03`: A Mongo query persisted in the history with its `paradigm` field correctly populated never receives SQL coloring at the QueryLog rendering step (regression guard against the legacy-fallback trap noted in `queryHistoryStore.ts:75`).
- `AC-177-04`: Rendering 50 history entries (mixed paradigms) in the QueryLog completes in a single render cycle without crashes and without any console errors / React warnings — measured by a Vitest test that mounts the panel with 50 seeded entries and asserts the absence of warnings on `console.error` mock.
- `AC-177-05`: The two existing `QuerySyntax` consumers (`QueryTab`, `GlobalQueryLogPanel`) continue to render correctly — confirmed by their existing tests still passing.

Files allowed to modify (per spec "Components to Create/Modify"):

- `src/components/query/QueryLog.tsx` — replace the plain-text query rendering at line 115 with the paradigm-aware preview already exported from `src/components/shared/QuerySyntax.tsx`.
- `src/components/query/QueryLog.test.tsx` — extend the existing test file (already 16 tests) with AC-177-01..04 cases. Existing tests that match SQL via free-text regex (`getByText(/SELECT \* FROM users/)`) will need updating because tokenized output splits each word into a separate `<span>` — see Design Bar.
- `docs/sprints/sprint-177/findings.md` (new) — Generator notes, mechanism choice, and any required test-rewrite rationale.
- `docs/sprints/sprint-177/handoff.md` (sprint deliverable; standard harness output).

## Out of Scope

- Anything in Sprints 176 / 178 / 179 / 180 (overlay hardening, ConnectionDialog URL normalization, paradigm vocabulary dictionary, Doherty + Goal-Gradient cancel overlay).
- Refactoring the existing `QuerySyntax` / `MongoSyntax` / `SqlSyntax` modules — those are imported as-is. No changes to their APIs, their token classes, or their rendering shape.
- Adding new dependencies (no CodeMirror in `QueryLog`; per spec line 181, span-based tokenization is the established mitigation for the rendering performance risk).
- Changing the QueryLog panel layout, the search-and-filter behavior, the clear-history flow, the relative-time formatter, the duration badge, or the entry click → `insert-sql` event handler.
- Changing the `truncateSql(entry.sql, 80)` truncation length or the truncation policy. The existing `MongoSyntax` is lenient for malformed JSON (per spec §Edge Cases §B.4), so the truncation is allowed to cut tokens mid-word and the renderer must not throw.
- Modifying `queryHistoryStore.ts` itself — Sprint 177 does not touch the legacy-fallback at `queryHistoryStore.ts:75`. AC-177-03 is a render-side regression guard.
- E2E test changes — no e2e selector currently relies on QueryLog SQL text being a single un-spanned text node (verified during contract drafting).

## Invariants

- Existing `QuerySyntax` / `MongoSyntax` / `SqlSyntax` test suites pass without modification beyond extension. Their public API (the `sql`, `paradigm`, `queryMode`, `className` props) is consumed exactly as the existing two consumers consume it (`GlobalQueryLogPanel.tsx:211-220`, `QueryTab.tsx:1025-1030`).
- QueryLog panel layout is unchanged: `data-testid="query-log-panel"`, the header with search + clear + close buttons, the entry rows with status dot / SQL text / timestamp / duration badge, and the empty-state copy ("No queries executed yet" / "No matching queries") all render at their current positions with the same Tailwind classes.
- No new runtime dependencies; no `package.json` change.
- Existing `QueryTab` and `GlobalQueryLogPanel` consumers continue to render correctly (covered by AC-177-05 and the full Vitest suite).
- The entry click → `window.dispatchEvent(new CustomEvent("insert-sql"))` flow remains intact — clicking the row still surfaces the FULL `entry.sql` (not the truncated text) in the dispatched event payload, matching current behavior at `QueryLog.tsx:48`.
- Skip-zero gate holds (no `it.skip` / `it.todo` / `xit` introduced — AC-GLOBAL-05).
- Strict TS (no `any` — AC-GLOBAL-01 lint gate).
- No `console.log` in production paths.

## Acceptance Criteria

- `AC-177-01` — Mongo entry in QueryLog renders at least one element with the `cm-mql-operator` class.
- `AC-177-02` — RDB entry in QueryLog renders at least one element with the `text-syntax-keyword` class AND zero `cm-mql-operator` elements.
- `AC-177-03` — A Mongo entry whose `paradigm: "document"` is correctly populated never receives SQL coloring at the QueryLog rendering step (regression guard).
- `AC-177-04` — 50 mixed-paradigm history entries render in a single cycle with no `console.error` calls and no React warnings.
- `AC-177-05` — `QueryTab` and `GlobalQueryLogPanel` existing tests continue to pass without modification.

## Design Bar / Quality Bar

- Implementation prefers minimal blast radius: the canonical fix shape replaces the `<span>{truncateSql(entry.sql, 80)}</span>` block at `QueryLog.tsx:113-116` with a `<QuerySyntax sql={truncateSql(entry.sql, 80)} paradigm={entry.paradigm} queryMode={entry.queryMode} className="..." />` call mirroring the pattern at `GlobalQueryLogPanel.tsx:211-220`. The Generator MAY choose a different shape (wrap, compose, hoist) so long as the AC and invariants hold.
- The existing `QueryLog.test.tsx` (16 tests) currently uses `getByText(/SELECT \* FROM users/)` and `getByText(/DROP TABLE orders/)` and `getByText(truncatedText)` — these queries assume the SQL is a single un-tokenized text node. After QuerySyntax wraps tokens in `<span>`s, the matchers must be rewritten to one of: (a) a function matcher that joins child `textContent`, (b) `container.textContent` containment assertions, or (c) RTL's `{ exact: false }` with a normalizer. The Generator MUST update the affected tests in the same change so the suite passes; this is not net-new work, it is the cost of the migration. Updates must be documented in `findings.md` with a short note per affected test name.
- Tests use user-visible queries (`getByRole`, `getByText` with fallback strategies for tokenized output, then `container.querySelector` only when a class assertion is the load-bearing fact — e.g. AC-177-01 needs `cm-mql-operator` which is a class, not a role / text).
- Each new test gets a top-of-file or top-of-`describe` Reason + date comment per the user's auto-memory `feedback_test_documentation.md` (2026-04-28). Existing tests that get rewritten gain a Reason comment (`// Sprint 177: SQL is now tokenized into spans; matcher updated to join textContent.`).
- New / touched code targets ≥ 70% line coverage on touched files (project convention; AC-GLOBAL-04). `QueryLog.tsx` is small (~145 lines); the existing test file already exercises most branches, so net coverage delta is small but auditable.
- Performance: per spec line 181, `MongoSyntax` and `SqlSyntax` are span-based (NOT CodeMirror); the span tree per entry is O(token-count). Rendering 50 entries is ~50× one-entry cost. The Generator must NOT introduce CodeMirror, lazy-loading, or virtualization in this sprint — AC-177-04 is a regression guard, not a perf-budget mandate.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/components/query src/components/shared/QuerySyntax src/components/shared/MongoSyntax src/components/shared/SqlSyntax` — runs the QueryLog file, the `QuerySyntax` dispatcher tests, the `MongoSyntax` tests, and the `SqlSyntax` tests (the latter has no current sibling test — see findings note). Must be green; AC-177-01..04 covered by new QueryLog tests; AC-177-05 covered by `QueryTab.test.tsx` and `GlobalQueryLogPanel.test.tsx` passing unmodified.
2. `pnpm vitest run` — full Vitest suite. Must be green (no regression).
3. `pnpm tsc --noEmit` — strict-mode type check. Zero errors.
4. `pnpm lint` — ESLint. Zero errors.
5. Browser smoke (operator-driven step list — Generator records observation, Evaluator re-runs):
   1. `pnpm tauri dev`.
   2. Open a Mongo (document paradigm) connection and run a `find` query (e.g. `db.users.find({})`).
   3. Toggle the QueryLog dock open (existing `toggle-query-log` event / hotkey).
   4. Confirm the recorded Mongo row renders the `$`-operator (e.g. `$match`, `$eq`) with the same operator color as `QueryTab`'s in-tab history list and `GlobalQueryLogPanel`'s rows.
   5. Switch to an RDB (e.g. PG) connection, run `SELECT * FROM users`.
   6. Toggle QueryLog, confirm `SELECT` / `FROM` are colored with the SQL keyword treatment (matching `QueryTab`).
   7. With both entries in the log, confirm visually they are distinguishable by paradigm coloring.
6. Static (Generator-recorded, Evaluator re-runs): `grep -n 'truncateSql' src/components/query/QueryLog.tsx` — confirm `truncateSql` is still the source of the rendered text (the truncation length is a deliberate invariant).

### Required Evidence

- Generator must provide:
  - Changed files (full list with one-line purpose each — at minimum: `QueryLog.tsx`, `QueryLog.test.tsx`, `findings.md`, `handoff.md`).
  - Vitest output for the new + touched tests, including AC IDs each test covers (a `[AC-177-0X]` prefix in the test name is acceptable).
  - Marker-class assertions explicitly visible in the test source — e.g. `expect(container.querySelector(".cm-mql-operator")).not.toBeNull()` for AC-177-01 and `expect(container.querySelector(".text-syntax-keyword")).not.toBeNull()` + `expect(container.querySelector(".cm-mql-operator")).toBeNull()` for AC-177-02. Class names must match the existing `MongoSyntax.tsx:23` and `SqlSyntax.tsx:11` literals.
  - Evidence that 50 mixed-paradigm entries render without `console.error` — a `vi.spyOn(console, "error")` assertion or equivalent.
  - Confirmation that `QueryTab.test.tsx` and `GlobalQueryLogPanel.test.tsx` still pass unmodified (file diff = empty for those two files).
  - `findings.md` containing: mechanism note (what code change was made), list of any existing-test rewrites (test name → reason), browser smoke summary (steps run, observed result, machine info).
- Evaluator must cite:
  - Concrete evidence for each AC pass/fail (test name + assertion text or screenshot path).
  - Marker-class match in the rendered DOM for AC-177-01 and AC-177-02 — these are class queries, not text queries; the test source must show the literal class string.
  - Re-run grep result confirming `truncateSql(entry.sql, 80)` survives at the same call site.
  - For AC-177-05: `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` is empty.
  - Any missing or weak evidence (e.g. AC-177-04 claimed without a `console.error` spy assertion) flagged as a P2 finding.

## Test Requirements

### Unit Tests (필수)

Each AC gets at least one Vitest scenario. All tests live in `src/components/query/QueryLog.test.tsx` (extend the existing file). Tests use RTL queries first, with class-level `container.querySelector` reserved for marker assertions (AC-177-01, AC-177-02, AC-177-03). Each new test carries a Reason + date comment per the 2026-04-28 feedback rule.

- **AC-177-01 — Mongo entry renders MQL operator marker**:
  - Seed `useQueryHistoryStore` with one entry: `paradigm: "document"`, `queryMode: "find"` (or `"aggregate"`), `sql: '{"$match":{"$eq":1}}'`.
  - Mount `<QueryLog />` and dispatch the `toggle-query-log` event.
  - Assert `container.querySelector(".cm-mql-operator")` is not null AND its `textContent` matches `"$match"` (or any valid Mongo operator token from the input).
  - This is the load-bearing assertion. Reason comment: `// AC-177-01 — Mongo paradigm entry must surface the cm-mql-operator marker; date 2026-04-30.`

- **AC-177-02 — RDB entry renders SQL keyword marker, no MQL marker**:
  - Seed store with one entry: `paradigm: "rdb"`, `queryMode: "sql"`, `sql: "SELECT * FROM users"`.
  - Mount + toggle.
  - Assert `container.querySelector(".text-syntax-keyword")` is not null AND its `textContent` is `"SELECT"`.
  - Assert `container.querySelector(".cm-mql-operator")` is null.

- **AC-177-03 — paradigm: "document" never receives SQL coloring (regression guard)**:
  - Seed store with one entry: `paradigm: "document"`, `queryMode: "find"`, `sql` containing both an SQL-looking keyword AND an MQL operator (e.g. `'{"$match":{"name":"SELECT"}}'`). The SQL tokenizer would color "SELECT" as a keyword IF the entry were mis-routed.
  - Mount + toggle.
  - Assert `container.querySelector(".cm-mql-operator")` is not null (proves Mongo path was taken).
  - Assert `container.querySelectorAll(".text-syntax-keyword")` excludes any element whose `textContent === "SELECT"` (proves the SQL tokenizer was NOT invoked on the document-paradigm entry).
  - Note: `MongoSyntax` does apply `text-syntax-keyword` to JSON literals `true`/`false`/`null`, so the assertion is "no `SELECT` keyword span", not "no `text-syntax-keyword` at all". This nuance must be in the test comment.

- **AC-177-04 — 50 mixed-paradigm entries render without warnings**:
  - Seed store with 50 entries alternating `paradigm: "rdb"` and `paradigm: "document"`, mixing `queryMode: "sql"` / `"find"` / `"aggregate"`. Use realistic `sql` payloads (≥ 80 chars to exercise truncation) with at least one operator / keyword each.
  - `vi.spyOn(console, "error")` and `vi.spyOn(console, "warn")`.
  - Mount + toggle. Assert the panel renders without throwing.
  - Assert `console.error` was NOT called and `console.warn` was NOT called.
  - Assert `container.querySelectorAll(".cm-mql-operator").length` ≥ 1 AND `container.querySelectorAll(".text-syntax-keyword").length` ≥ 1 (smoke that both paradigm renderers ran for the mixed seed).

- **AC-177-05 — existing consumers unchanged**:
  - Not test-coverable inside `QueryLog.test.tsx`; verified by Evaluator inspection of `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` (must be empty) and by their existing test runs passing during the full-suite Required Check.

- **Existing-test migration (NOT a new AC; required by Design Bar)**:
  - Tests in `QueryLog.test.tsx` that currently match SQL via `getByText(/SELECT \* FROM users/)`, `getByText(/DROP TABLE orders/)`, `getByText(/SELECT \* FROM orders/)`, and `getByText(truncatedText)` must be rewritten. The accepted patterns are listed in Design Bar.
  - Reason comment per rewritten test: `// Sprint 177: SQL is tokenized into spans; matcher joins child textContent.`
  - The migration MUST NOT change the test's semantic intent (e.g. the existing "filters entries by search text" test must still verify search filtering, not just rendering).

### Coverage Target

- 신규/수정 코드: 라인 70% 이상 (AC-GLOBAL-04, project convention).
- CI 전체 기준: 라인 40%, 함수 40%, 브랜치 35%.

### Scenario Tests (필수)

- [x] Happy path — Mongo entry renders with operator coloring; RDB entry renders with keyword coloring (AC-177-01, AC-177-02).
- [x] 에러/예외 — invalid / truncated JSON in a Mongo entry does not throw (covered by `MongoSyntax` lenience per spec §Edge Cases §B.4; new test mounts a Mongo entry whose `sql` is `'{"$match":{'` and asserts the panel still renders).
- [x] 경계 조건 — 50 mixed-paradigm entries, mid-token truncation (AC-177-04 + the truncation invariant); empty store (no entries) still shows "No queries executed yet" (existing test; must keep passing after migration).
- [x] 기존 기능 회귀 없음 — search filter, clear-history confirm dialog, entry-click → `insert-sql` event, relative-time formatter, duration badge, status dot all keep working (existing 16 tests after matcher migration).

## Test Script / Repro Script

Manual replay for the Evaluator:

1. `pnpm install` (if not already).
2. `pnpm vitest run src/components/query src/components/shared/QuerySyntax src/components/shared/MongoSyntax src/components/shared/SqlSyntax` — confirm all AC-tagged tests pass.
3. `pnpm vitest run` — confirm full suite still green (regression check for `QueryTab.test.tsx`, `GlobalQueryLogPanel.test.tsx`, and any other downstream consumer tests).
4. `pnpm tsc --noEmit` — zero errors.
5. `pnpm lint` — zero errors.
6. `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` — confirm empty (AC-177-05 invariant).
7. `grep -n 'truncateSql' src/components/query/QueryLog.tsx` — confirm `truncateSql(entry.sql, 80)` still feeds the rendered preview.
8. `pnpm tauri dev`, follow the browser smoke step list in Verification Plan §Required Checks #5. Compare visual coloring against `QueryTab` and `GlobalQueryLogPanel` reference surfaces.
9. Open `docs/sprints/sprint-177/findings.md` — confirm sections: mechanism note, existing-test migration notes, browser smoke summary, evidence index.

## Ownership

- Generator: single agent (one Generator role within the harness).
- Write scope:
  - `src/components/query/QueryLog.tsx`
  - `src/components/query/QueryLog.test.tsx` (extend existing file with AC tests + migrate existing matchers)
  - `docs/sprints/sprint-177/findings.md` (new)
  - `docs/sprints/sprint-177/handoff.md` (sprint deliverable; standard harness output)
- Untouched: `memory/`, `CLAUDE.md`, `src/components/shared/QuerySyntax.tsx`, `src/components/shared/MongoSyntax.tsx`, `src/components/shared/SqlSyntax.tsx`, `src/stores/queryHistoryStore.ts`, sprints 176 / 178 / 179 / 180 spec/contract/brief, any file outside the write scope above.
- Merge order: this sprint is independent of 176 (already merged). Sprints 178 / 179 / 180 do not depend on this one. Land any time after 176.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (1–6 in Verification Plan)
- `docs/sprints/sprint-177/findings.md` exists and includes the mechanism note + existing-test migration notes + browser smoke evidence.
- Acceptance criteria evidence linked in `docs/sprints/sprint-177/handoff.md` (one row per AC pointing to the test or evidence file).

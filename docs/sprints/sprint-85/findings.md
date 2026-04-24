# Sprint 85 Findings — Paradigm-aware history viewer highlighting

Evaluation against `docs/sprints/sprint-85/contract.md` and `docs/sprints/sprint-85/execution-brief.md`.

## Sprint 85 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness | 9/10 | `mongoTokenize.ts:82-87` gates operator tagging on `fullyQuoted && starts-with $ && OPERATOR_SET.has(inner)` — cleanly rejects unterminated fragments and non-registered `$` strings. `MongoSyntax.tsx:23` injects the shared `cm-mql-operator` class. `QuerySyntax.tsx:39-42` dispatches on `paradigm === "document"` with SQL fallback for every other value (including `undefined`, confirming legacy compatibility). QueryTab history row (L829-834) and GlobalQueryLogPanel (collapsed L188-197, expanded L223-229) wire `entry.paradigm` + `entry.queryMode` through. Invariant-protected files are byte-for-byte intact. Minor: the `ch === "+"` sign handling in the numeric branch (L96-99) is non-JSON permissive but does not cause incorrect classification. |
| Completeness | 9/10 | All seven WRITE files created/modified per Execution Brief. 30 new tests added (1555 − 1525 = 30; packet claim verified), comfortably exceeding the AC-12 floor of 10. Every AC-01…AC-12 mapped to a concrete test or command result below. Truncation preserved via caller (`truncateSql(entry.sql, 80)` at GlobalQueryLogPanel.tsx:193). The `queryMode` prop is accepted on the wrapper for forward-compat even though unused today — matches brief. One small drift: executor panel changed `memory/lessons/memory.md` (adds a single lesson-index entry) which was **not** declared in the Scope Boundary; it is outside forbidden paths and harmless, but strictly speaking it is scope creep. |
| Reliability | 9/10 | `tokenizeMongo` is exhaustively non-throwing — truncated JSON (`{"$match":{`), unterminated strings, arbitrary non-JSON (`abc xyz!`), and empty input all round-trip via explicit tests. `MongoSyntax` / `QuerySyntax` render-only (no store writes) with an explicit AC-09 store-identity test (`QuerySyntax.test.tsx:67-75`) asserting `useQueryHistoryStore.getState()` and `useTabStore.getState()` reference equality pre/post render. Sprint 84 restore/execute logic in QueryTab untouched (L829 delta is JSX-only). Forbidden-path diff is empty. |
| Verification Quality | 9/10 | All six required checks executed and pass: `pnpm tsc --noEmit` 0 errors, `pnpm lint` 0 warnings, targeted 5-file vitest 112 passes, full vitest 1555/1555 (vs 1525 baseline = +30), `git diff --stat HEAD -- src-tauri/` empty, forbidden-path diff stat empty. Tests assert on DOM class presence (not brittle text queries) where tokenisation changes multi-leaf text layout, and existing tests (e.g. `displays log entries with SQL text`) were proactively adapted to use row-scoped `textContent` matching. AC-04 seed uses a >80-char JSON so the expand `<pre>` branch actually triggers — shows care with UI preconditions. |
| **Overall** | **9.0/10** | |

## Verdict: PASS

Every dimension ≥ 7; every AC has evidence; every verification check passes.

## Sprint Contract Status (Done Criteria)

- [x] `src/lib/mongoTokenize.ts` pure `tokenizeMongo(src)` → `MongoToken[]` with the 8 kinds listed. File:line `src/lib/mongoTokenize.ts:40-192`.
- [x] Operator tagging via `MONGO_ALL_OPERATORS` read-only import. File:line `src/lib/mongoTokenize.ts:1, 24, 82-87`.
- [x] Invalid JSON → no throw. Tests `handles invalid / truncated JSON without throwing` (`mongoTokenize.test.ts:56-66`), `tolerates arbitrary non-JSON text` (`mongoTokenize.test.ts:68-75`), `treats unterminated strings as plain strings` (`mongoTokenize.test.ts:77-86`).
- [x] `MongoSyntax.tsx` renders tokens as spans; operator → `cm-mql-operator`. File:line `src/components/shared/MongoSyntax.tsx:23, 37-48`. Test: `wraps operator tokens in a span carrying the cm-mql-operator class` (`MongoSyntax.test.tsx:10-21`).
- [x] `QuerySyntax.tsx` paradigm dispatcher. File:line `src/components/shared/QuerySyntax.tsx:39-42`.
- [x] QueryTab history row swap. File:line `src/components/query/QueryTab.tsx:25` (import), `:829-834` (JSX). Execute/load logic unchanged (`handleLoad` at L880, `loadQueryIntoTab` calls preserved — diff stat 6 insertions total on QueryTab.tsx).
- [x] GlobalQueryLogPanel collapsed + expanded wrapper. File:line `src/components/query/GlobalQueryLogPanel.tsx:8` (import), `:188-197` (collapsed), `:224-228` (expanded `<pre>` body). Truncate preserved on caller side at L190-194.
- [x] Legacy entry fallback. Test `falls back to SqlSyntax when paradigm is undefined (legacy)` (`QuerySyntax.test.tsx:29-37`) and `falls back to SQL coloration when paradigm is undefined (AC-03 legacy)` (`GlobalQueryLogPanel.test.tsx:603-622`).
- [x] 10+ new tests — 30 new tests across five files.
- [x] `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` all pass.
- [x] `src-tauri/` and forbidden-path diff stats both empty.

## Acceptance Criteria Evidence Map

| AC | Evidence |
|----|----------|
| AC-01 (QueryTab rdb row → SqlSyntax token class) | `src/components/query/QueryTab.test.tsx:1677-1707` — `renders SQL coloration for rdb history rows (AC-01)` |
| AC-02 (QueryTab document row → `cm-mql-operator`) | `src/components/query/QueryTab.test.tsx:1711-1749` — `renders MQL operator class for document history rows (AC-02)` |
| AC-03 (GlobalQueryLogPanel collapsed 3-shape) | `GlobalQueryLogPanel.test.tsx:554-573` rdb, `:578-600` document, `:603-622` legacy |
| AC-04 (GlobalQueryLogPanel expanded document → `cm-mql-operator`) | `GlobalQueryLogPanel.test.tsx:627-658` — `carries cm-mql-operator into the expanded body for a document entry (AC-04)` |
| AC-05 (80-char truncate preserved) | `GlobalQueryLogPanel.test.tsx:664-683` — `keeps the 80 char truncate behaviour in the collapsed row (AC-05)` |
| AC-06 (invalid JSON non-throw) | `mongoTokenize.test.ts:56-66` + `MongoSyntax.test.tsx:31-35` + `QuerySyntax.test.tsx:77-83` |
| AC-07 (operator → `cm-mql-operator`, no SQL keyword leak) | `MongoSyntax.test.tsx:10-21` (operator present) + `:23-29` (no `cm-mql-operator` on plain JSON); confirmed by `QuerySyntax.test.tsx:20-27` asserting operator text |
| AC-08 (legacy undefined → SqlSyntax) | `QuerySyntax.test.tsx:29-37` |
| AC-09 (no store write side effect) | `QuerySyntax.test.tsx:67-75` — asserts `useQueryHistoryStore.getState() === historyBefore` and `useTabStore.getState() === tabBefore` |
| AC-10 (`pnpm tsc --noEmit`, `pnpm lint` clean) | Both commands executed by evaluator: `tsc` exit 0 no output, `lint` 0 warnings/errors |
| AC-11 (src-tauri + forbidden path diffs empty) | Evaluator-run `git diff --stat HEAD -- src-tauri/` and the 15-path forbidden list both empty |
| AC-12 (≥10 new tests + full regression) | Full `pnpm vitest run` → 1555/1555 pass; 30 new tests (baseline 1525 → 1555) |

## Verification Results (Evaluator-executed)

1. `pnpm tsc --noEmit` → exit 0, no diagnostics.
2. `pnpm lint` → exit 0, no ESLint output beyond the `> eslint .` header.
3. `pnpm vitest run` on the 5 targeted files → `Test Files 5 passed (5) / Tests 112 passed (112)`.
4. `pnpm vitest run` (full suite) → `Test Files 80 passed (80) / Tests 1555 passed (1555)`.
5. `git diff --stat HEAD -- src-tauri/` → empty output.
6. `git diff --stat HEAD -- src/components/shared/SqlSyntax.tsx src/lib/sqlTokenize.ts src/lib/mongoAutocomplete.ts src/stores/queryHistoryStore.ts src/stores/tabStore.ts src/components/query/QueryEditor.tsx src/components/query/QueryEditor.test.tsx src/hooks/useSqlAutocomplete.ts src/hooks/useMongoAutocomplete.ts src/lib/sqlDialect.ts src/components/datagrid/ src/components/DataGrid.tsx src/components/DocumentDataGrid.tsx src/components/shared/BsonTreeViewer.tsx src/components/shared/QuickLookPanel.tsx` → empty output.

## Code Review Observations

- No `any` type usage in the three new TS/TSX files. Confirmed via `Grep` — the only hits are doc comments that use the English word "any".
- No `console.log` / `TODO` / `FIXME` / `XXX` markers in new files.
- `interface Props` used on all three new components (`MongoSyntaxProps`, `QuerySyntaxProps` — plus the tokenizer uses `interface MongoToken`).
- `MongoSyntax.tsx` parallels `SqlSyntax.tsx` exactly: `useMemo(() => tokenize(sql), [sql])` → `<span className={cn("font-mono", className)}>` wrapper → `{tokens.map(...)}` with a `TOKEN_CLASS` record. This preserves the existing caller shape so the wrapper swap is trivial.
- `dark:` prefix: neither `SqlSyntax` nor `MongoSyntax` use `dark:` classes directly — both rely on semantic tokens (`text-syntax-keyword`, `text-muted-foreground`) that come from the shared theme. This is the pre-existing project pattern; parity is the right call.
- `OPERATOR_SET: ReadonlySet<string> = new Set<string>(MONGO_ALL_OPERATORS)` (L24) — correct choice: `MONGO_ALL_OPERATORS` is a `readonly string[]` (L128 of `mongoAutocomplete.ts`) and O(1) lookup is needed inside the tokeniser hot loop.
- Sprint 83 claim "same `cm-mql-operator` class shared with editor decoration" is realised (`MongoSyntax.tsx:23`). Single theming entry point confirmed.

## Caveats / Residual Risk (non-blocking)

- **Scope drift (low)**: `memory/lessons/memory.md` and the new `memory/lessons/2026-04-24-parallel-agent-commit-isolation/` directory are present in the working tree but were not declared in the Sprint 85 WRITE scope. They are not in the forbidden list and add a single lesson entry, so they do not fail the invariants, but they should ideally live on a separate commit/branch. Worth flagging to the orchestrator so the Sprint 85 commit isolates only the feature diff.
- **Expected degradation (as documented)**: Truncated MQL previews (80-char slice) can cut an operator mid-token; the tokeniser then sees a partial string and demotes it to `kind === "string"` (no `cm-mql-operator`). Explicitly accepted in the Execution Brief residual-risk section.
- **Forward-compat stub**: `queryMode` is currently unused inside `QuerySyntax` (only threaded through). A linter running no-unused-vars at the parameter level does not flag it because destructuring keeps it inside the props shape. Keep an eye on it if a stricter rule is added later.

## Feedback for Generator

None blocking. Two minor items that would tighten the sprint artefact:

1. **Scope hygiene** — The `memory/lessons/*` additions ride on the same working tree. Before the orchestrator commits Sprint 85, verify the Sprint 85 commit only touches the declared WRITE files and rehome the lesson into a separate commit.
   - Current: `git diff --stat HEAD` shows `memory/lessons/memory.md | 1 +` and an untracked `memory/lessons/2026-04-24-parallel-agent-commit-isolation/` directory.
   - Expected: Sprint 85 commit diff contains only the contract's WRITE set.
   - Suggestion: Stage exactly the WRITE scope (`src/lib/mongoTokenize.ts`, `src/lib/mongoTokenize.test.ts`, `src/components/shared/MongoSyntax.tsx`, `src/components/shared/MongoSyntax.test.tsx`, `src/components/shared/QuerySyntax.tsx`, `src/components/shared/QuerySyntax.test.tsx`, `src/components/query/QueryTab.tsx`, `src/components/query/QueryTab.test.tsx`, `src/components/query/GlobalQueryLogPanel.tsx`, `src/components/query/GlobalQueryLogPanel.test.tsx`, `docs/sprints/sprint-85/*`) for the Sprint 85 commit and land the memory lesson in a follow-up commit.

2. **Documentation clarity (nit)** — The packet summary said the expanded `<pre>` block lives at "L224-228" but the actual span is L223-229. Off-by-one on the start line. Not a defect, but future evaluator-facing notes should match exact line ranges so reviewers can jump without guessing.
   - Suggestion: When the evidence packet cites file:line, run `sed -n 'S,Ep' file` (or equivalent) to double-check.

## Handoff Summary

- Verdict: **PASS**
- Score: **9.0 / 10** (Correctness 9, Completeness 9, Reliability 9, Verification Quality 9)
- Required checks: all pass
- Open P1/P2: 0
- Safe to commit: yes, *provided* the orchestrator isolates the sprint-85 feature commit from the `memory/lessons/*` churn as noted in feedback #1.

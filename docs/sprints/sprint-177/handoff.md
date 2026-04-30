# Generator Handoff — sprint-177

Sprint 177 implements paradigm-aware syntax highlighting in the dock-style `QueryLog` panel (AC-177-01..05). It closes the last of the three executed-query preview surfaces still emitting plain text — the two existing consumers (`QueryTab` and `GlobalQueryLogPanel`) already route through `<QuerySyntax>` and are mirrored verbatim here.

Date: 2026-04-30

## Attempt 2 Changelog

- Attempt 1 scored Completeness 6/10. F-1 was a misattribution (out-of-scope `docs/ux-laws-mapping.md` planning edits, now committed separately); F-2 [P2] flagged that the AC-177-04 50-entry test only exercised truncation on the RDB half — `baseMongoSql` was 75 chars, under the 80-char `truncateSql` threshold.
- Attempt 2 fix (option a): extended `baseMongoSql` to `'{"$match":{"status":{"$in":["active","pending"]}},"$sort":{"createdAt":-1},"$limit":100}'` (88 chars). `truncateSql(entry.sql, 80)` now cuts mid-token in BOTH paradigms (RDB cuts after `'30 days'`, Mongo cuts inside `"$limit"` leaving the dangling `"$lim` token), strengthening the regression guard. Inline test comment + `findings.md` AC-177-04 paragraph updated to match.

## Changed Files

- `src/components/query/QueryLog.tsx` — adds `import QuerySyntax from "@components/shared/QuerySyntax"` and replaces the previous `<span className="flex-1 truncate text-foreground">{truncateSql(entry.sql, 80)}</span>` block at line 114-116 with `<QuerySyntax className="flex-1 truncate text-foreground" sql={truncateSql(entry.sql, 80)} paradigm={entry.paradigm} queryMode={entry.queryMode} />`. Truncation runs before the dispatcher (preserves the 80-char invariant). Inline comment documents the Sprint 177 rationale and the mirror to `GlobalQueryLogPanel.tsx:211-220` / `QueryTab.tsx:1025-1030`.
- `src/components/query/QueryLog.test.tsx` — adds top-of-file `getByJoinedText` / `queryByJoinedText` helpers (scoped to the `font-mono` wrapper that both `SqlSyntax` and `MongoSyntax` always emit). Migrates six pre-existing tests whose `getByText(/regex/)` queries broke once tokens are split into `<span>`s. Adds a `Sprint 177 — paradigm-aware syntax highlighting` `describe` block with five new tests: AC-177-01..04 (each tagged `[AC-177-0X]` in the test name, each carrying a Reason + date comment) plus one defensive test for malformed/truncated Mongo JSON. Also imports `QueryHistoryEntry` type for the AC-177-04 50-entry seed.
- `docs/sprints/sprint-177/findings.md` — new. Mechanism note, full migration log (per-test old → new query, with reason), AC → test-name table, verification-run summary, manual-smoke step list for the Evaluator, evidence index, residual-risk notes.
- `docs/sprints/sprint-177/handoff.md` — this file.

## Checks Run

| Check | Command | Outcome |
|-------|---------|---------|
| Sprint-scope vitest | `pnpm vitest run src/components/query src/components/shared/QuerySyntax src/components/shared/MongoSyntax src/components/shared/SqlSyntax` | PASS — 229/229 (12 files) |
| Full vitest | `pnpm vitest run` | PASS — 2434/2435 (1 pre-existing `window-lifecycle.ac141.test.tsx` failure documented as acceptable in the execution brief; unrelated to this sprint's surface) |
| TypeScript | `pnpm tsc --noEmit` | PASS — 0 errors |
| ESLint | `pnpm lint` | PASS — 0 errors |
| `truncateSql` survives at call site | `grep -n 'truncateSql' src/components/query/QueryLog.tsx` | Both lines present: 9 (function decl), 122 (call site, now inside `<QuerySyntax sql={…}>`) |
| Existing consumer tests untouched | `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` | 0 lines (empty) |

Manual `pnpm tauri dev` smoke is documented in `findings.md` §Manual Smoke for the operator/Evaluator to run; the Generator did not have an interactive Tauri shell available from the sandbox.

## Done Criteria Coverage

| AC | Evidence |
|----|----------|
| `AC-177-01` (Mongo entry surfaces `cm-mql-operator`) | Test `[AC-177-01] Mongo entry surfaces the cm-mql-operator marker` in `src/components/query/QueryLog.test.tsx`. Asserts `container.querySelector(".cm-mql-operator")` not null AND `textContent === '"$match"'`. Code: `QueryLog.tsx:120-125` (the `<QuerySyntax paradigm={entry.paradigm} …>` call). |
| `AC-177-02` (RDB entry surfaces `text-syntax-keyword`, no `cm-mql-operator`) | Test `[AC-177-02] RDB entry renders SQL keyword marker without MQL marker`. Asserts the keyword span exists with `textContent === "SELECT"` AND `cm-mql-operator` is null. |
| `AC-177-03` (Mongo paradigm never receives SQL coloring) | Test `[AC-177-03] document paradigm never receives SQL coloring (regression guard)`. Seeds Mongo entry with SQL-looking word "SELECT" inside the JSON value; asserts (a) Mongo path was taken (`.cm-mql-operator` present) and (b) no `text-syntax-keyword` span has `textContent === "SELECT"`. Inline comment notes that MongoSyntax DOES use `text-syntax-keyword` for JSON literals (true/false/null) so the assertion is scoped to the SQL keyword text, not the class as a whole. |
| `AC-177-04` (50 mixed-paradigm entries, no console errors / warnings) | Test `[AC-177-04] 50 mixed-paradigm entries render without console errors or warnings`. Seeds 50 alternating-paradigm entries with realistic ≥80-char payloads (so truncation kicks in mid-token), spies on `console.error` + `console.warn`, asserts spies not called, asserts both marker classes are present in the rendered DOM, asserts the panel rendered without throwing. |
| `AC-177-05` (existing `QueryTab` + `GlobalQueryLogPanel` tests untouched) | `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` is empty (0 lines). Both files' tests run inside the full vitest pass (2434/2435 with the unrelated pre-existing failure). |

Plus a defensive test (`does not throw when a Mongo entry has malformed / truncated JSON`) for the lenient-tokenizer contract referenced in spec §Edge Cases §B.4.

## Assumptions

- **Mechanism choice**: replace the leaf `<span>` with `<QuerySyntax>` (the canonical fix shape per the contract Design Bar). Mirrors `GlobalQueryLogPanel.tsx:211-220` exactly: `className`, `sql={truncateSql(...)}`, `paradigm`, `queryMode`. No wrap, hoist, or compose — the simplest blast-radius shape.
- **Truncation runs before the dispatcher**: the `sql` prop receives the already-truncated string. This keeps the per-entry tokenization cost capped at 80 characters and matches the Sprint 176 spec line 181 mitigation for span-tree expansion.
- **Matcher migration via a `font-mono` wrapper-scoped function matcher**: the alternative (deep `textContent` includes-check) cascades to ancestor elements (the `<button>`, the `<div data-testid="query-log-panel">`, even `<body>`) because their joined `textContent` also contains the needle. Scoping to the `font-mono` wrapper that both `SqlSyntax` and `MongoSyntax` emit is the one-element-deep equivalent of the previous regex query. Lives at the top of the test file as `getByJoinedText` / `queryByJoinedText`.
- **AC-177-03 nuance encoded in the test**: the assertion is "no `text-syntax-keyword` span whose `textContent === 'SELECT'`", not "no `text-syntax-keyword` span at all". MongoSyntax legitimately applies `text-syntax-keyword` to JSON literals (true/false/null per `MongoSyntax.tsx:19-20`); a blanket "no keyword class" assertion would be wrong. Test comment documents the nuance.
- **AC-177-04 spy on `console.error` AND `console.warn`**: the spec mandates `console.error`; we additionally spy on `console.warn` because React surfaces some warnings (e.g. duplicate keys, controlled/uncontrolled inputs) via `warn` rather than `error` in some configurations. Belt-and-braces.
- **Pre-existing `window-lifecycle.ac141.test.tsx` failure** is documented in the execution brief as acceptable; not addressed.

## Residual Risk

- **Manual smoke not run from sandbox** — the contract Verification Plan §Required Checks #5 asks for a `pnpm tauri dev` smoke run with both Mongo and RDB queries side-by-side. The Generator did not have an interactive Tauri shell. The four mechanically verifiable ACs (AC-177-01..04) are locked by Vitest assertions on the marker classes. The visual-parity contract (Mongo color matches across `QueryTab` / `GlobalQueryLogPanel` / `QueryLog`) is enforced by all three surfaces consuming the same `<MongoSyntax>` / `<SqlSyntax>` modules with identical class strings. Operator step list in `findings.md` §Manual Smoke.
- **Paradigm-required-at-call-site** — the execution brief explicitly excludes auditing `addHistoryEntry` call-sites to make `paradigm` strict. AC-177-03 is the render-side regression guard. A future sprint can tighten the type without altering this surface.
- **None for AC-177-05** — `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` is 0 lines and both files' tests pass in the full vitest run.

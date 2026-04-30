# Sprint 177 — Findings (Generator)

Date: 2026-04-30

## Mechanism Note

**Change shape**: at `src/components/query/QueryLog.tsx`, the leaf rendering of
the SQL preview was previously

```tsx
<span className="flex-1 truncate text-foreground">
  {truncateSql(entry.sql, 80)}
</span>
```

It is now

```tsx
<QuerySyntax
  className="flex-1 truncate text-foreground"
  sql={truncateSql(entry.sql, 80)}
  paradigm={entry.paradigm}
  queryMode={entry.queryMode}
/>
```

`QuerySyntax` keeps the same outer-span shape (it renders `<span class="font-mono ...">{tokens}</span>`), so the surrounding flex layout, the truncation behavior, and the click-to-`insert-sql` flow are unchanged. The truncation MUST happen before the dispatcher so the tokenizer never walks more than 80 characters per entry — keeping the AC-177-04 cost ceiling intact.

**Reuse rationale**: this mirrors the pattern already used at
- `src/components/query/QueryTab.tsx:1025-1030` (in-tab history)
- `src/components/query/GlobalQueryLogPanel.tsx:211-220` (global log)

Both consumers thread `entry.paradigm` + `entry.queryMode` into `<QuerySyntax>` and apply a truncation policy via the `sql` prop. The dock-style `QueryLog` was the third (and last) executed-query preview surface still emitting plain text. Per the §sprint-176/spec.md "Components to Create/Modify" guidance and the contract's Design Bar, this sprint mirrors the existing two consumers verbatim — no behavioral drift.

**Out-of-scope confirmations**:
- `QuerySyntax.tsx`, `MongoSyntax.tsx`, `SqlSyntax.tsx` are imported as-is. No changes to their public API or token classes.
- `queryHistoryStore.ts` was not touched — AC-177-03 is a render-side regression guard only.
- `QueryTab.tsx` / `GlobalQueryLogPanel.tsx` and their tests are unchanged (`git diff main -- … = 0 lines`).
- No new dependencies; no `package.json` change.

## Existing-Test Migration Log

The `QueryLog.test.tsx` file (16 pre-existing tests) used `getByText(/regex/)` matchers that assume the SQL preview is a single text node. Once `<QuerySyntax>` tokenises the text, those queries find zero matches. The accepted Design Bar pattern is a function-matcher that:

1. scopes to the `<span class="font-mono">` wrapper that both `SqlSyntax` and `MongoSyntax` always emit (so the matcher does not cascade to ancestor `<button>` / `<div>` elements whose joined `textContent` would also include the needle), and
2. asserts the wrapper's `textContent` contains the expected substring.

The migration helper lives at the top of the test file:

```ts
function getByJoinedText(needle: string): HTMLElement {
  return screen.getByText((_, element) => {
    if (!element || !element.classList.contains("font-mono")) return false;
    return element.textContent?.includes(needle) ?? false;
  });
}
```

Each migrated test has a `// Sprint 177: SQL is now tokenized into spans; matcher joins child textContent.` comment.

| Test (existing) | Old query | New query | Reason |
|---|---|---|---|
| `shows log entries from history store` | `getByText(/SELECT \* FROM users/)` + `getByText(/DROP TABLE orders/)` | `getByJoinedText("SELECT * FROM users")` + `getByJoinedText("DROP TABLE orders")` | Tokenized output splits each word into `<span>`s; regex no longer matches. |
| `filters entries by search text` | `getByText(/SELECT \* FROM users/)` + `queryByText(/SELECT \* FROM orders/)` | `getByJoinedText(...)` + `queryByJoinedText(...)` | Same tokenization issue; preserves the original semantic intent (search filters one row in, the other out). |
| `clicking entry dispatches insert-sql event` | `getByText(/SELECT \* FROM users/).click()` | `getByJoinedText("SELECT * FROM users").click()` (clicks bubble through the `font-mono` wrapper to the parent `<button>`) | Tokenization issue; click bubbling is unchanged because the parent `<button>` still owns the onClick handler. |
| `clear button shows confirmation dialog before clearing history` | `getByText(/SELECT \* FROM users/)` precondition assertion | `getByJoinedText("SELECT * FROM users")` | Tokenization issue; the rest of the test (clear button → confirm dialog → store cleared) is unchanged. |
| `truncates long SQL strings` | `getByText("AAAA…AAA...")` (single-string match) | `getByJoinedText("AAAA…AAA...")` | `SqlSyntax` tokenises the all-`A` identifier into one `identifier` span and the trailing `...` into three separate `punct` spans (one per dot). The wrapper's `textContent` still contains the full truncated string, so the joined-text matcher succeeds. |

Tests that did NOT need migration:
- `does not render by default`, `renders on toggle-query-log event`, `clear cancel does not clear history`, `toggles visibility on second toggle-query-log event`, `closes panel when X button is clicked`, `shows empty message when no queries executed yet`, `shows no matching queries message when search has no results`, `displays relative time for entries`, `displays duration for entries`, `shows just now for very recent entries`, `uses theme CSS variable for success status dot`, `uses theme CSS variable for error status dot` — none match SQL token text directly.

The semantic intent of every migrated test is preserved (the search-filter test still verifies filtering, the click test still verifies the `insert-sql` event payload, etc.).

## Test Coverage — AC mapping

| AC | Test name | Marker / assertion |
|---|---|---|
| `AC-177-01` | `[AC-177-01] Mongo entry surfaces the cm-mql-operator marker` | `container.querySelector(".cm-mql-operator")` not null AND its `textContent === '"$match"'`. Seeds `paradigm: "document"`, `queryMode: "find"`. |
| `AC-177-02` | `[AC-177-02] RDB entry renders SQL keyword marker without MQL marker` | `container.querySelector(".text-syntax-keyword")` not null AND `textContent === "SELECT"`; `container.querySelector(".cm-mql-operator")` is null. |
| `AC-177-03` | `[AC-177-03] document paradigm never receives SQL coloring (regression guard)` | Seeds Mongo entry with `sql: '{"$match":{"name":"SELECT"}}'`. Asserts (a) Mongo path was taken (`.cm-mql-operator` present) and (b) no `text-syntax-keyword` span has `textContent === "SELECT"`. Comment explains why "no `text-syntax-keyword` at all" is the wrong assertion (MongoSyntax also applies the class to JSON literals true/false/null). |
| `AC-177-04` | `[AC-177-04] 50 mixed-paradigm entries render without console errors or warnings` | Seeds 50 entries (alternating rdb/document, varying queryMode). Both seed payloads are intentionally over the 80-char `truncateSql` threshold — the RDB seed is 95 chars (cut keeps `… '30 days'` and drops the trailing `ORDER BY id ASC`) and the Mongo seed is 88 chars (cut leaves the dangling token `"$lim` from the `"$limit"` operator). So `truncateSql(entry.sql, 80)` exercises mid-token truncation in BOTH paradigms, locking the lenient-tokenizer contract for both `SqlSyntax` and `MongoSyntax`. `vi.spyOn(console, "error" / "warn")`, asserts spies not called, asserts both `.cm-mql-operator` and `.text-syntax-keyword` are present in the rendered DOM. |
| `AC-177-05` | (no new test in `QueryLog.test.tsx`) | `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` is empty (0 lines). Their existing tests run inside the full vitest pass. |

Plus an additional defensive test:
- `does not throw when a Mongo entry has malformed / truncated JSON` — seeds `'{"$match":{'` (mid-token truncation case) and asserts the panel renders without throwing. Covers spec §Edge Cases §B.4 (lenient `tokenizeMongo`) at the panel level.

Each AC test (and the Sprint 177 describe block) carries a top-of-`describe` Reason + date comment per the 2026-04-28 feedback rule.

## Verification Run Summary

| Check | Command | Outcome |
|---|---|---|
| Sprint-scope vitest | `pnpm vitest run src/components/query src/components/shared/QuerySyntax src/components/shared/MongoSyntax src/components/shared/SqlSyntax` | PASS — 229/229 (12 files) |
| Full vitest | `pnpm vitest run` | PASS — 2434/2435 (1 pre-existing failure in `src/__tests__/window-lifecycle.ac141.test.tsx` — documented in execution-brief as acceptable, unrelated to QueryLog/QuerySyntax) |
| TypeScript | `pnpm tsc --noEmit` | PASS — 0 errors |
| ESLint | `pnpm lint` | PASS — 0 errors |
| `truncateSql` survives | `grep -n 'truncateSql' src/components/query/QueryLog.tsx` | Both lines preserved: `9` (function decl), `122` (call site, now inside `<QuerySyntax sql={…}>`) |
| Existing consumer tests untouched | `git diff main -- src/components/query/QueryTab.test.tsx src/components/query/GlobalQueryLogPanel.test.tsx` | 0 lines (empty) |

## Manual Smoke (Operator-Driven)

The Generator did not have an interactive Tauri shell available from the sandbox. The operator/Evaluator should run the following step list (matches contract §Verification Plan §Required Checks #5):

1. `pnpm tauri dev`
2. Open a Mongo (document paradigm) connection.
3. Run a `find` query (e.g. `db.users.find({ status: "active" })` or `db.users.aggregate([{ $match: { age: { $gte: 18 } } }])`).
4. Toggle the QueryLog dock open (existing `toggle-query-log` event / hotkey).
5. **Expected**: the recorded Mongo row renders the `$`-operator (e.g. `$match`, `$eq`, `$gte`) with the same operator color as the in-tab history list (`QueryTab`) and the global log panel (`GlobalQueryLogPanel`). Direct visual comparison: open `QueryTab` history alongside the dock; the `$match` token color must match.
6. Switch to an RDB (e.g. PostgreSQL) connection.
7. Run `SELECT * FROM users`.
8. Toggle QueryLog. **Expected**: `SELECT` / `FROM` are rendered with the SQL keyword color (matching `text-syntax-keyword`), identical to the treatment in `QueryTab`.
9. With both entries in the log, **expected**: the two paradigms are visually distinguishable — Mongo `$match` is the MQL-operator color, SQL `SELECT` is the SQL-keyword color.

## Evidence Index

- Code change: `src/components/query/QueryLog.tsx` lines 7 (import) and 114-125 (the wrap with `<QuerySyntax>` plus inline comment).
- Test changes: `src/components/query/QueryLog.test.tsx` — top-of-file `getByJoinedText` / `queryByJoinedText` helper; six existing tests migrated; one Sprint 177 `describe` block with five new tests (4 AC tests + 1 truncated-JSON regression).
- Findings: this file (`docs/sprints/sprint-177/findings.md`).
- Handoff: `docs/sprints/sprint-177/handoff.md`.

## Residual Risk

- **Manual smoke not run from sandbox**. The four ACs that are mechanically verifiable (AC-177-01..04) are locked by Vitest assertions on the marker classes (`.cm-mql-operator`, `.text-syntax-keyword`). The visual contract — that the Mongo color matches between QueryTab / GlobalQueryLogPanel / QueryLog — is enforced by the fact that all three surfaces consume the same `<MongoSyntax>` and `<SqlSyntax>` modules with identical class strings. The operator step list above lets the Evaluator confirm visually.
- **Mid-token truncation on malformed Mongo JSON** is exercised by the additional defensive test (`does not throw when a Mongo entry has malformed / truncated JSON`) and by the AC-177-04 50-entry mixed render. The behavior is delegated to `tokenizeMongo`'s lenient-by-design contract per spec §Edge Cases §B.4.
- **Paradigm field optionality at the call-site**. The execution brief notes that `addHistoryEntry` accepts `paradigm` as optional and defaults to `"rdb"`. Auditing call-sites to make `paradigm` strict is explicitly OUT OF SCOPE for Sprint 177 (per §Out of Scope and the brief's task description). AC-177-03 is the render-side regression guard for "Mongo entries with correct paradigm don't get SQL coloring" — a future sprint can tighten the type without altering this surface.

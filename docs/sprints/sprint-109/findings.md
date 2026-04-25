# Sprint 109 — Generator Findings

## Goal
Replace the plain `<pre>` SQL block in `SqlPreviewDialog` with the existing
`SqlSyntax` token renderer so the Structure SQL preview gets syntax
highlighting via theme tokens (`text-syntax-keyword`, `text-syntax-string`,
…). Empty SQL keeps the current `-- No changes to preview` placeholder.

## Changed Files

- `src/components/structure/SqlPreviewDialog.tsx`
  - Added `import SqlSyntax from "@components/shared/SqlSyntax"`.
  - In the `preview` prop, replaced `{sql || "-- No changes to preview"}`
    with a conditional:
    - `sql.trim()` non-empty → `<SqlSyntax sql={sql} />`
    - else → `<span className="italic text-muted-foreground">-- No changes
      to preview</span>` (muted/italic placeholder; outer `<pre>` styling
      retained: `max-h-scroll-lg overflow-auto whitespace-pre-wrap rounded
      border border-border bg-background p-3 text-xs font-mono
      text-foreground`).

- `src/components/structure/SqlPreviewDialog.test.tsx` (new)
  - AC-01: `sql="CREATE TABLE foo (id INT);"` → `<span class="...
    text-syntax-keyword ...">` exists for `CREATE` and `TABLE`.
  - AC-02 (canonical empty): `sql=""` → placeholder shown, no
    `text-syntax-keyword` spans.
  - AC-02 (whitespace-only via JSX expression `sql={"   \n  "}`) →
    placeholder shown.
  - AC-03 (Execute click): `onConfirm` called once, `onCancel` not.
  - AC-03 (Cancel click): `onCancel` called once, `onConfirm` not.

- `src/components/schema/StructurePanel.test.tsx` (regression fix-up only)
  - Two assertions used `screen.getByText("ALTER TABLE …")` and
    `screen.getByText("CREATE INDEX …")` to find the SQL inside the
    SqlPreviewDialog's `<pre>`. Because `SqlSyntax` now splits the SQL
    into per-token `<span>`s, RTL's text matcher cannot find a single text
    node containing the whole string. Switched these two assertions to
    select the dialog's `<pre>` and compare its `textContent` to the
    expected string — preserves the original semantic intent (the SQL is
    visible in the preview body).

## AC Mapping

| AC    | Where verified                                                                                          | Result |
| ----- | ------------------------------------------------------------------------------------------------------- | ------ |
| AC-01 | `SqlPreviewDialog.test.tsx` AC-01: keyword span lookup                                                  | PASS   |
| AC-02 | `SqlPreviewDialog.test.tsx` AC-02 (canonical + whitespace)                                              | PASS   |
| AC-03 | `SqlPreviewDialog.test.tsx` AC-03 Execute / AC-03 Cancel                                                | PASS   |
| AC-04 | `pnpm vitest run` 1797/1797 (was 1792 + 5 new tests; 0 regressions after StructurePanel fix-up)         | PASS   |

## Checks Run

| Command                | Result      |
| ---------------------- | ----------- |
| `pnpm vitest run`      | 1797 passed |
| `pnpm tsc --noEmit`    | 0 errors    |
| `pnpm lint`            | 0 errors    |

## Notes / Decisions

- The contract phrased the placeholder as "muted-foreground italic". I
  rendered it as `<span className="italic text-muted-foreground">…</span>`
  inside the existing `<pre>` so the surrounding scroll/border/background
  layout is preserved verbatim. `text-foreground` on the `<pre>` is
  overridden by the placeholder span's `text-muted-foreground`.
- Used `sql.trim()` (instead of the original `||`) for the non-empty check
  so a SQL string consisting only of whitespace correctly falls back to the
  placeholder. `confirmDisabled={!sql.trim()}` already used the same
  semantics, so the two checks are now consistent.
- The two `StructurePanel.test.tsx` assertions that needed updating were
  not testing token-level rendering — they only asserted the SQL appears in
  the preview body. The new `pre.textContent` form preserves that intent
  while accommodating SqlSyntax's tokenised DOM.
- No changes to `SqlSyntax`, `PreviewDialog`, or `SqlPreviewDialog`'s prop
  surface (out-of-scope items respected).

## Residual Risk

None. All three required checks pass with 0 errors and the sprint-93
commit-error banner contract is unaffected (separate code path inside
`PreviewDialog`).

# Doc Size And Line Length

## Scope

Two gates, both run by the `Doc Size And Line Length` CI job. They measure
different failures, so neither replaces the other.

| Gate | Metric | Threshold | Owner |
| --- | --- | --- | --- |
| `scripts/hooks/check-doc-size.sh --strict` | whole-file chars | 120,000 | file too large to load as agent context |
| `pnpm docs:lines` | per-line chars | 600 | table cell holding a paragraph |

Measured set for both: `docs/**/*.md` minus `sprints`, `archives`,
`table_plus`, and `explorations`. Those four are one-shot artifacts that no
agent re-reads, so their shape carries no cost.

## Why per-line, and why 600

Every baseline violation is a markdown table row. No non-table line in the
measured set exceeds 600 chars, so "line length" here is in practice "table cell
length" — a cell holding a multi-domain paragraph instead of one claim.

`markdownlint` MD013 cannot cover this. Its default config excludes tables and
code blocks, which is exactly where the long lines are.

## Two invariants in `docs:lines`

Both compare the working tree against the committed baseline in
`scripts/doc-line-length-targets.json` — the same shape as the coverage ratchet.
Adding debt therefore requires editing a tracked file, and that edit is what
fails.

1. **Total over-ceiling lines may only fall.** This catches new long content, and
   it stays quiet for pure moves: splitting a doc relocates long rows into new
   files without changing the total.
2. **Per-file longest line may only fall, and a file with no baseline entry must
   have every line at or under 600.** Without the max rule, swapping the
   6,334-char row in `known-limitations.md` for a 6,000-char one keeps the total
   flat and passes. The
   no-entry half means a file cleaned up once is permanently protected, which is
   the incentive the ratchet exists to create.

A stale target also fails: a baseline left above the real count, or above the
real longest line, must be lowered. Otherwise a file could drift back up later
under an allowance it no longer needs.

### Why not a diff-based rule

The first draft gated on `git diff` instead: any added-or-changed line over the
ceiling failed unless it existed verbatim in the base revision. It rejected
legitimate work twice.

- Every row a doc split moved was flagged as newly authored, which would have
  blocked the smoke-matrix split — the remedy this gate exists to encourage.
- After exempting verbatim moves, a review fix that rewrote one clause inside an
  already-long grandfathered cell still failed, because the edit changed the
  line text.

Editing a long cell is not the failure mode; growing or multiplying long cells
is. The baseline comparison expresses exactly that, and it needs no base ref, so
CI cannot silently skip half the gate when a shallow fetch has no merge base.

## Raising a target is not the fix

The ratchet entry is a ceiling that records debt, not a budget to spend. Split
the cell into domain-grouped rows instead. A cell that mixes several domains is
also what makes doc claims drift: one clause gets corrected and the sibling
clauses in the same cell keep contradicting it.

## Related

- [`coverage-ratchet.md`](coverage-ratchet.md) — same ratchet shape for coverage
  thresholds.
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md)
  — verification gap SOT and the smoke matrix index.

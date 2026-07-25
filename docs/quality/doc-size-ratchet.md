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

## Two rules in `docs:lines`

1. **Hard ceiling on newly authored lines.** A line over 600 chars that does not
   already exist verbatim in `origin/main` fails outright. Without this rule,
   replacing a 6,346-char row with a 6,000-char row keeps the count flat and
   passes.
2. **Per-file ratchet.** `scripts/doc-line-length-targets.json` records the
   grandfathered count per file. A count may only fall. A target left above the
   real count also fails, so the file cannot drift upward later under a stale
   allowance.

Rule 1 exempts lines moved verbatim because splitting a large doc relocates long
rows into new files. Treating a move as new authorship would make this gate block
the remedy it exists to encourage.

Base comparison uses two-dot `git diff origin/main HEAD`, not three-dot: CI
fetches the base with `--depth=1`, which leaves no merge base for `A...B` to
resolve. `DOC_LINE_LENGTH_REQUIRE_BASE=1` in CI turns a missing base ref into a
failure rather than a silently skipped rule.

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

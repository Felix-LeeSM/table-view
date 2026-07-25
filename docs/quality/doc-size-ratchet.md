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

That shape is not just ugly, it blocks correction. The longest cell in
`docs/product/known-limitations.md` is 6,334 chars and mixes on the order of
twenty separate claims. Retiring one of them means surgery inside that cell, so
in practice limitations get appended and never retired: a capability ships and
its "unsupported" sentence stays. Splitting cells into one claim per row is what
makes a claim individually correctable, and later machine-checkable.

Nothing else in this repo measures line length. `markdownlint` is not a
dependency — no config file, no lockfile entry — and MD013 would not substitute
if it were: it has no notion of grandfathering the rows that already exist,
which is the only reason this gate can be turned on without first rewriting 205
rows.

## How `docs:lines` compares

The baseline in `scripts/doc-line-length-targets.json` must describe the working
tree **exactly**: same over-ceiling count, same longest line, same total excess,
per file. Mismatches in either direction fail. A baseline that silently
disagrees with reality is how a ratchet rots.

The consequence is that any change to a long line needs a baseline update in the
same commit. `pnpm docs:lines --update` writes it, and that command is where
direction is enforced: it refuses to write a baseline whose repo-wide
over-ceiling count or total excess is higher than the committed one. Debt can be
paid down, or moved between files, and cannot grow.

Three numbers per file, because each closes a hole the others leave open:

| Number | Closes |
| --- | --- |
| `over` | a new long row appearing |
| `maxLen` | swapping the 6,334-char row for a 6,000-char one, which keeps `over` flat |
| `excess` | a non-longest long row growing to just under `maxLen`, which keeps `over` and `maxLen` flat |

Two more rules complete it. A file with no baseline entry must have every line at
or under 600, so a file cleaned up once stays clean. An entry whose file is no
longer measured must be removed.

### Workflow

- Added a long row → split it into domain-grouped rows. Raising the baseline is
  not the remedy, and `--update` will refuse.
- Shortened or split a long row → `pnpm docs:lines --update`, then commit the
  baseline diff alongside the doc change.
- Moved rows between files, as a doc split does → same thing. The repo totals
  stay flat, so `--update` accepts it.

### Deliberate ceilings

- **Hand-editing the baseline upward passes the gate.** Nothing here can prevent
  that without comparing against a base revision, which was rejected below. What
  it buys is that the raise appears as an explicit diff in a tracked file, the
  same posture as `scripts/coverage-ratchet-targets.json`.
- **The job is fail-closed but not merge-blocking yet.** `doc-size` is not among
  the contexts the `pr_to_main` ruleset requires by name, so a red result reports
  but does not block. Adding the context has to happen after the workflow lands
  on `main`; a required context no workflow produces would block every open PR.
- **CI only, not wired into `pre-push`.** This follows the existing decision for
  `check-doc-size.sh` and keeps the docs-only push route fast. The cost is that a
  long cell is caught at PR time rather than at push time.

## Two rejected designs

Recorded so they are not re-proposed.

### A `git diff` rule

Any added-or-changed line over the ceiling fails unless it existed verbatim in
the base revision. It rejected legitimate work twice.

- Every row a doc split moved was flagged as newly authored, which would have
  blocked the smoke-matrix split — the remedy this gate exists to encourage.
- After exempting verbatim moves, a review fix that rewrote one clause inside an
  already-long grandfathered cell still failed, because the edit changed the line
  text.

Editing a long cell is not the failure mode; growing or multiplying long cells
is. The rule also needed a base ref, so a shallow-fetch CI checkout with no merge
base would silently skip half the gate.

### A "may only fall" rule with no `--update`

The replacement was described as "totals may only fall, and a pure move stays
quiet". Both halves were false against the code that shipped in the first draft,
which compared for equality: a pure move failed, and so did an improvement. The
lesson kept here is that the honest contract is exact match plus a command that
rewrites the baseline under a direction check — not a looser comparison that
leaves a paid-down baseline sitting above reality.

## Raising a target is not the fix

The baseline entry records debt; it is not a budget to spend. Split the cell into
domain-grouped rows instead. A cell that mixes several domains is also what makes
doc claims drift: one clause gets corrected and the sibling clauses in the same
cell keep contradicting it.

## Related

- [`coverage-ratchet.md`](coverage-ratchet.md) — same ratchet shape for coverage
  thresholds.
- [`docs/contributor-guide/testing-and-quality.md`](../contributor-guide/testing-and-quality.md)
  — verification gap SOT and the smoke matrix index.

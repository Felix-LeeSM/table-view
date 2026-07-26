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
agent re-reads, so their shape carries no cost. The two gates discover that set
differently — `check-doc-size.sh` walks the tree with `find`, so it also sees
untracked files, while `pnpm docs:lines` reads `git ls-files`. Both count code
points, not UTF-8 bytes, so Korean prose is not charged three times.

## Why per-line, and why 600

Every baseline violation is a markdown table row. No non-table line in the
measured set exceeds 600 chars, so "line length" here is in practice "table cell
length" — a cell holding a multi-domain paragraph instead of one claim.

That shape is not just ugly, it blocks correction. The longest row in the
measured set is 6,334 code points in
[`docs/product/known-limitations-cross-cutting.md`](../product/known-limitations-cross-cutting.md)
and mixes on the order of twenty separate claims (measured 2026-07-27;
`pnpm docs:lines` prints the live totals). Retiring one of them means surgery
inside that cell, so in practice limitations get appended and never retired: a
capability ships and its "unsupported" sentence stays. Splitting cells into one
claim per row is what makes a claim individually correctable, and later
machine-checkable.

Nothing else in this repo measures line length. `markdownlint` is not a
dependency — no config file, no lockfile entry — and MD013 would not substitute
if it were: it has no notion of grandfathering the rows that already exist,
which is the only reason this gate can be turned on without first rewriting
every long row in the repo.

## The contract

Everything below this heading is generated. It is the output of the real gate
over fixture trees, not a description of it, so a page that disagrees with the
shipped behavior is a test failure rather than a reader's problem
(`scripts/__tests__/check-doc-line-length.test.ts`). Regenerate with
`pnpm docs:lines:contract`.

The baseline in `scripts/doc-line-length-targets.json` must describe the working
tree **exactly**, per file: same over-ceiling count, same longest line, same
total excess. Mismatches in either direction fail — a baseline that silently
disagrees with reality is how a ratchet rots — so any change to a long line
needs a baseline update in the same commit. `pnpm docs:lines --update` writes
it, and that command is where direction is enforced.

<!-- generated: pnpm docs:lines:contract -->

```text
# The baseline describes the tree
# baseline:
#   docs/a.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=2 longest=900 excess=500
#   docs/b.md over=0 longest=120 excess=0
$ pnpm docs:lines
doc:lines ok (ceiling 600, 2 docs, 2 grandfathered lines, 500 excess chars)
exit 0

# A long row is written into a file that has no entry
# baseline:
#   docs/a.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=2 longest=900 excess=500
#   docs/b.md over=1 longest=700 excess=100
$ pnpm docs:lines
doc:lines failed — the baseline no longer matches the docs:
- docs/b.md: 1 line(s) over 600 chars (longest 700) in a file with no baseline entry. Split the cell into domain-grouped rows; `pnpm docs:lines --update` refuses while repo debt is higher.
exit 1

# A long row grows in a file that has an entry
# baseline:
#   docs/a.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=2 longest=1000 excess=600
$ pnpm docs:lines
doc:lines failed — the baseline no longer matches the docs:
- docs/a.md: longest line rose to 1000, baseline 900. Split the cell into domain-grouped rows; `pnpm docs:lines --update` refuses while repo debt is higher.
- docs/a.md: excess chars rose to 600, baseline 500. Split the cell into domain-grouped rows; `pnpm docs:lines --update` refuses while repo debt is higher.
exit 1

# A row moves between two files that both have entries
# baseline:
#   docs/a.md over=2 longest=900 excess=500
#   docs/b.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=1 longest=900 excess=300
#   docs/b.md over=3 longest=900 excess=700
$ pnpm docs:lines
doc:lines failed — the baseline no longer matches the docs:
- docs/a.md: over-ceiling lines fell to 1, baseline 2. Record it with `pnpm docs:lines --update`.
- docs/a.md: excess chars fell to 300, baseline 500. Record it with `pnpm docs:lines --update`.
- docs/b.md: over-ceiling lines rose to 3, baseline 2. Record it with `pnpm docs:lines --update`.
- docs/b.md: excess chars rose to 700, baseline 500. Record it with `pnpm docs:lines --update`.
exit 1

# A row moves into a file that has no entry
# baseline:
#   docs/a.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=0 longest=120 excess=0
#   docs/b.md over=2 longest=900 excess=500
$ pnpm docs:lines
doc:lines failed — the baseline no longer matches the docs:
- docs/a.md: over-ceiling lines fell to 0, baseline 2. Record it with `pnpm docs:lines --update`.
- docs/a.md: longest line fell to 120, baseline 900. Record it with `pnpm docs:lines --update`.
- docs/a.md: excess chars fell to 0, baseline 500. Record it with `pnpm docs:lines --update`.
- docs/b.md: 2 line(s) over 600 chars (longest 900) in a file with no baseline entry. Record it with `pnpm docs:lines --update`.
exit 1

# Debt is paid down and an entry's file is gone
# baseline:
#   docs/a.md over=2 longest=900 excess=500
#   docs/gone.md over=1 longest=700 excess=100
# tree:
#   docs/a.md over=1 longest=700 excess=100
$ pnpm docs:lines
doc:lines failed — the baseline no longer matches the docs:
- docs/a.md: over-ceiling lines fell to 1, baseline 2. Record it with `pnpm docs:lines --update`.
- docs/a.md: longest line fell to 700, baseline 900. Record it with `pnpm docs:lines --update`.
- docs/a.md: excess chars fell to 100, baseline 500. Record it with `pnpm docs:lines --update`.
- docs/gone.md: baseline entry for a file that is no longer measured. Record it with `pnpm docs:lines --update`.
exit 1

# --update refuses 18 long rows consolidated into one cell
# baseline:
#   docs/a.md over=18 longest=6334 excess=33054
# tree:
#   docs/a.md over=1 longest=33654 excess=33054
$ pnpm docs:lines --update
doc:lines --update refused: debt may not grow.
- repo longest line would rise from 6334 to 33654.
Split the offending cell into domain-grouped rows instead.
exit 1

# --update records the move the check above rejected
# baseline:
#   docs/a.md over=2 longest=900 excess=500
#   docs/b.md over=2 longest=900 excess=500
# tree:
#   docs/a.md over=1 longest=900 excess=300
#   docs/b.md over=3 longest=900 excess=700
$ pnpm docs:lines --update
doc:lines baseline written (4 lines over 600 chars, 1000 excess chars)
exit 0
```

### Reading the block

- **The remedy follows the repo totals, not the file's.** A row moving into a
  file that already has an entry makes that file "rise" while the repo stays
  flat, and the message still points at `--update`, because that is what
  `--update` will do with the same input. Only when `--update` would refuse does
  the gate tell you to split.
- **`longest` is in the direction check, not just the two sums.** The
  consolidation scenario is why: 18 rows merged into one cell, trimmed just
  enough to keep the excess flat, makes the count fall 18 → 1 and both sums read
  it as progress. `buildTargets` projects whatever tree it measured, so a
  baseline `--update` writes can never be rejected afterwards — the raised cell
  ceiling would be permanent.
- **`longest` only counts files that carry debt.** A repo paid down to zero
  still has ordinary prose in it; charging that against a baseline of 0 would
  refuse the very commit that clears the last entry.
- **Falling is still a failure (exit 1).** Paying debt down without recording it
  leaves the file an allowance it no longer needs.

### Workflow

- Added a long row → split it into domain-grouped rows.
- Shortened, split, or moved a long row → `pnpm docs:lines --update`, then
  commit the baseline diff alongside the doc change. The baseline file is
  registered in `scripts/hooks/path-classifier.sh` as a hook path, so that diff
  routes the push to the hook gates instead of promoting it to the full route.
- Landing a doc PR while other doc PRs are in flight → every merge to `main`
  that touches a long row makes every open branch's baseline stale in the
  falling direction, which is exit 1 above. Re-run `--update` on the branch just
  before merge.

### Deliberate ceilings

- **Hand-editing the baseline upward passes the gate.** Nothing here can prevent
  that without comparing against a base revision, which was rejected below. What
  it buys is that the raise appears as an explicit diff in a tracked file, the
  same posture as `scripts/coverage-ratchet-targets.json`.
- **A cleaned-up file can be re-granted an entry.** `--update` compares repo
  totals, not per-file ones, so a commit that pays one file down and lands a
  long row in a file that had no entry is accepted — that is indistinguishable
  from a move without a base revision, and moves are the remedy this gate exists
  to encourage. What is not protected is any single file's cleaned-up status.
- **The job is fail-closed but not merge-blocking yet.** `Doc Size And Line
  Length` is not among the contexts the `pr_to_main` ruleset requires by name
  (the ruleset registers display names, not job keys), so a red result reports
  but does not block. Adding the context has to happen after the workflow lands
  on `main`; a required context no workflow produces would block every open PR.
- **CI only, not wired into `pre-push`.** This follows the existing decision for
  `check-doc-size.sh`. The cost is that a long cell is caught at PR time rather
  than at push time.

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

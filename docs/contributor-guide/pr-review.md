# PR Review

PR review separates automatic gates from qualitative judgement. Lint, typecheck,
test, CI, and Required Checks are automatic gates; the reviewer reads their
results and evaluates the PR diff, body, and relevant source of truth.

The reviewer does not edit the author's working copy — neither sources nor build
output. Running test, lint, or build is allowed and never required: clone a
throwaway copy, run there, and delete it in the same turn. That copy is separate
from the single work copy a PR gets, and the reviewer who made it reclaims it.
What the reviewer ran that way is evidence like any gate result.

## Reviewer Output

The reviewer must leave one integrated scorecard comment on the PR for each
review round. Per-perspective notes are internal inputs and should not create
separate PR comments.

The comment must use GitHub-visible evidence only: repo-relative paths, PR URLs,
commit URLs, or check URLs. Local absolute paths, temporary files, and worktree
or clone paths are not valid evidence.

## Red / Green Rule

A finding blocks the merge only when it makes `main` worse. There are three
such cases and no others:

1. Runtime behaviour is wrong, or user data or security is at risk.
2. A false statement this PR is responsible for lands in a source of truth.
3. An automatic gate (required check) fails.

Everything else is non-blocking. The reviewer records it on the scorecard only
— the reviewer does not file issues. Type-level issue emission happens in a
separate sweep (`memory/workflow/review/memory.md`).

A blocking finding must be backed by a counter-example, a command's output, or
a gate result. "Insufficient evidence" and "not verified for every case" are
not blocking. Rounds after the first judge only whether the previous round's
blocking findings were resolved; anything newly discovered is recorded on the
scorecard, except case 1 which blocks regardless of round.

Scores are not used. Blocking is decided once, in the integrated scorecard
comment; per-perspective notes report findings and evidence, not severity.

## Measuring Rounds And Merge Rate

`scripts/review/measure-rounds.sh` reports how review is actually going. It is
read-only: it reads the GitHub API and prints numbers, it never comments or
labels. Nothing schedules it — run it when you want the number.

```
bash scripts/review/measure-rounds.sh --since 2026-06-01
```

The first three lines are the contract (`rounds_per_merge`, `merge_rate`,
`merge_rate_by_files`). After them come the round definition in force, the
window, whether the scan was truncated, the distribution of the gap *between*
rounds, a per-day series, and the command that produced the output. Quote that
command next to the number so a reader can rerun it — a number nobody else can
reproduce cannot back a blocking finding, so it stays a scorecard note.

Two round definitions exist and both are printed on every run:

- `head-oid` (default since #1968) — one distinct head commit carrying review is
  one round. Two comments on the same commit are one round, so an implementer
  reply no longer inflates the count. This is what the `Stop at review round 3`
  gate acts on.
- `comments` — one PR comment is one round. The old default, kept behind the
  flag so numbers measured before #1968 stay reproducible. This repo has a
  single account, so the API cannot tell a reviewer scorecard from an
  implementer reply, a session notice, or a "closing this" comment: #1968
  measured at least 27 of 168 comments that were not rounds.

The script computes both in its `round_events()` jq function, but the gate never
calls it. The webhook payload carries no head-OID count, so the workflow's
`Count review rounds by head OID` step runs its own GraphQL query and hands the
number to the next step's `if:` expression through a step output. That means the
head-OID definition is implemented twice, and the "gate coupling" step of
`scripts/review/measure-rounds.test.sh` is what keeps the two in step. It makes
three assertions: the gate's `Stop at review round 3` condition must read
`steps.rounds.outputs.rounds`, the counting step must assign a head per comment
and take `unique | length` over the result, and the script must carry the same
head-assignment line. It reads those two step bodies rather than the whole
workflow file, because the same literals also appear in comments and in the
step's error message, and a file-wide match would sleep through a condition
swap.

If the GraphQL count fails, the counting step exits non-zero. The gate closes
red rather than treating a missing count as zero rounds.

Run `bash scripts/review/measure-rounds.sh --help` for the flags, and read the
"못 재는 것" comment at the bottom of the script before quoting a number: it
lists what the tool cannot see, starting with blocking sets.

## Source Of Truth

There is no rubric SOT. Workflow
behavior lives in `memory/workflow/review/memory.md` and delivery merge gating
lives in `memory/workflow/delivery/memory.md`.

# PR Review

PR review separates automatic gates from qualitative judgement. Lint, typecheck,
test, CI, and Required Checks are automatic gates. The reviewer does
not rerun those checks; it reads their results and evaluates the PR diff, body,
and relevant source of truth.

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
command next to the number so a reader can rerun it. A number quoted without one
is note or issue material, not a blocking finding.

Two round definitions exist and both are printed on every run:

- `comments` (default) — one PR comment is one round. Same proxy the
  `Stop at review round 3` gate in `.github/workflows/review-gate.yml` uses.
- `head-oid` — one distinct head commit carrying review is one round. This is
  the definition issue #1968 wants to move the gate to.

Inside that script both definitions are computed in one place, the
`round_events()` jq function. The gate does not run that function: the workflow
reads `github.event.pull_request.comments` straight off the webhook payload, and
`scripts/hooks/policy/test-review-gate-round.sh` requires it to keep reading the
payload instead of calling the API. So #1968 has to change the workflow and that
guard as well as this script's default, and the payload carries no head-OID
count for the workflow to switch to.

Run `bash scripts/review/measure-rounds.sh --help` for the flags, and read the
"못 재는 것" comment at the bottom of the script before quoting a number: it
lists what the tool cannot see, starting with blocking sets.

## Source Of Truth

There is no rubric SOT. Workflow
behavior lives in `memory/workflow/review/memory.md` and delivery merge gating
lives in `memory/workflow/delivery/memory.md`.

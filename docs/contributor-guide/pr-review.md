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

## Source Of Truth

There is no rubric SOT. Workflow
behavior lives in `memory/workflow/review/memory.md` and delivery merge gating
lives in `memory/workflow/delivery/memory.md`.

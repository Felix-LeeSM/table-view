# PR Review

PR review separates automatic gates from qualitative judgement. Hook, lint,
typecheck, test, CI, and Required Checks are automatic gates. The reviewer does
not rerun those checks; it reads their results and evaluates the PR diff, body,
and relevant source of truth.

## Reviewer Output

The `pr-reviewer` coordinator must leave one integrated scorecard comment on
the PR for each review round. Perspective-specific `pr-subreviewer` outputs are
internal inputs and should not create separate PR comments.

The comment must use GitHub-visible evidence only: repo-relative paths, PR URLs,
commit URLs, or check URLs. Local absolute paths, temporary files, and worktree
paths are not valid evidence.

## Red / Green Rule

A finding blocks the merge only when it makes `main` worse. There are three
such cases and no others:

1. Runtime behaviour is wrong, or user data or security is at risk.
2. A false statement this PR is responsible for lands in a source of truth.
3. An automatic gate (required check) fails.

Everything else is non-blocking. The reviewer files it as an issue and records
the issue number on the scorecard.

A blocking finding must be backed by a counter-example, a command's output, or
a gate result. "Insufficient evidence" and "not verified for every case" are
not blocking. Rounds after the first judge only whether the previous round's
blocking findings were resolved; anything newly discovered becomes an issue,
except case 1 which blocks regardless of round.

Scores are not used. Blocking is decided once, by the coordinator — perspective
subreviewers report findings and evidence, not severity.

## Source Of Truth

The detailed rubric lived in `.agents/skills/pr-review/SKILL.md`, deleted in #2033 — there is no rubric SOT now. Workflow
behavior lives in `memory/workflow/review/memory.md` and delivery merge gating
lives in `memory/workflow/delivery/memory.md`.

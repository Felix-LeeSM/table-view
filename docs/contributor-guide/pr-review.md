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

The pass bar is `8/10` for every applicable qualitative dimension.

- Green/pass: all applicable dimensions are at least `8/10`, automatic gates are
  green, and there are no blocking findings.
- Red/blocking: any applicable dimension is below `8/10`, any automatic gate
  fails, or the review finds a contract miss, source-of-truth conflict, scope
  drift, local-only evidence, or reviewer boundary violation.

`7/10` means the work may function, but it still needs reflection before merge.

## Source Of Truth

The detailed rubric lives in `.agents/skills/pr-review/SKILL.md`. Workflow
behavior lives in `memory/workflow/review/memory.md` and delivery merge gating
lives in `memory/workflow/delivery/memory.md`.

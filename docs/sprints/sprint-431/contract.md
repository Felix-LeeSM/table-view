# Sprint 431 Contract: Path-Sensitive Pre-Push Routing

## Goal

Route pre-push gates from the paths changed in the outgoing push range. The hook
should keep mandatory safety checks in place while avoiding the full
frontend/Rust stack for documentation-only pushes.

## Scope

- Preserve pre-commit staged-file routing through Lefthook `glob` rules; do not
  replace it with a second router.
- Determine changed paths from outgoing commits, including new-branch pushes.
- Classify outgoing changes into docs-only, frontend, Rust, mixed
  frontend+Rust, workflow/hook, or unknown.
- Route gate groups from that classification:
  - Always run signed-commit verification.
  - Always run the TDD-cycle guard.
  - Docs-only changes skip the full frontend/Rust stack.
  - Frontend changes run TypeScript typecheck, lint, tests, and coverage.
  - Rust changes run `cargo check`, `cargo deny`, `cargo machete`, and
    `llvm-cov` coverage.
  - Mixed frontend+Rust changes run both stacks, with intended parallel
    execution.
  - Hook, workflow, or unknown classifications fail open to the full stack.
- Include both old and new paths for renames and deletes so routing cannot miss
  removed or moved source files.

## Acceptance Criteria

- AC-431-01: Docs-only outgoing changes run signed commits + TDD guard and skip
  full frontend/Rust gates.
- AC-431-02: Frontend outgoing changes run signed commits + TDD guard +
  frontend typecheck/lint/tests/coverage.
- AC-431-03: Rust outgoing changes run signed commits + TDD guard + Rust
  check/deny/machete/llvm-cov coverage.
- AC-431-04: Mixed frontend+Rust outgoing changes run both stacks and keep the
  route suitable for parallel execution.
- AC-431-05: Hook/workflow changes and unknown path classes fail open to the full
  stack.
- AC-431-06: New branch pushes route from the outgoing commit range instead of
  assuming an upstream ref exists.
- AC-431-07: Rename and delete cases classify using old paths as well as new
  paths.

## Guard Cases

- docs-only
- frontend-only
- Rust-only
- frontend+Rust mixed
- hook/workflow
- unknown path
- new branch
- rename, including old path
- delete, including old path

## Out of Scope

- Changing the required signed-commit policy.
- Disabling or weakening the TDD-cycle guard.
- Editing unrelated pre-push gates outside this routing layer.
- Replacing cargo/frontend gate commands with cheaper substitutes.

## Verification Plan

1. Router guard tests cover docs, frontend, Rust, mixed, workflow, unknown, new
   branch, rename, and delete scenarios.
2. Markdown/diff review confirms the sprint docs and memory lesson match the
   routing contract.
3. Full hook validation is owned by the implementation worker.

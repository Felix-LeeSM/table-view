# Sprint 431 Handoff: Path-Sensitive Pre-Push Routing

## Intended Behavior

- Pre-push routing is based on outgoing changed paths, not on the whole
  worktree.
- Signed-commit verification and the TDD-cycle guard are invariants and always
  run.
- Docs-only pushes skip the full frontend/Rust stack.
- Frontend pushes run TypeScript typecheck, lint, tests, and coverage.
- Rust pushes run `cargo check`, `cargo deny`, `cargo machete`, and `llvm-cov`
  coverage.
- Mixed frontend+Rust pushes run both stacks; the route is intended to allow
  parallel execution.
- Hook/workflow paths and unknown classifications fail open to the full stack.

## Guard Matrix

| Outgoing path class | Required route |
|---|---|
| docs-only | signed commits + TDD guard |
| frontend | signed commits + TDD guard + frontend stack |
| Rust | signed commits + TDD guard + Rust stack |
| frontend+Rust | signed commits + TDD guard + frontend stack + Rust stack |
| hook/workflow | full stack |
| unknown | full stack |
| new branch | classify outgoing commit paths |
| rename | classify old path and new path |
| delete | classify deleted old path |

## Notes For Evaluator

- Rename/delete coverage is a routing invariant: old paths must be present in
  the changed-path set before classification.
- Unknown must be conservative. The expected failure mode is extra validation,
  not skipped validation.
- Documentation-only optimization must not bypass commit-signing or TDD-cycle
  checks.

## Verification

- Sidecar documentation validation only:
  - markdown files were inspected for line count and obvious formatting issues.
  - git diff was reviewed for the three owned files.
- Source hook, lefthook, and end-to-end pre-push validation remain with the main
  implementation worker.

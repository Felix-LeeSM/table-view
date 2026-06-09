# Coverage Ratchet

## Scope

The ratchet locks coverage thresholds, not raw measured coverage artifacts.
Measured coverage is enforced by Vitest and `cargo llvm-cov` on the normal hook
or CI route.

Current ratchet targets:

| Target | Source | Metrics |
| --- | --- | --- |
| `frontend.vitest.global` | `vite.config.ts` | statements 85, lines 87, functions 87, branches 78 |
| `rust.pre_commit.tier1` | `lefthook.yml` | lines 73, functions 70, regions 73 |
| `rust.pre_push.integration` | `scripts/hooks/pre-push-path-router.sh` | lines 80, functions 75, regions 80 |

## Evidence

Issue #580 ratcheted only below measured coverage. Old target means the previous
enforced threshold; `n/a` means the metric was newly added to the target set.

| Target metric | Old | Current measured | New | Cushion |
| --- | ---: | ---: | ---: | ---: |
| Frontend statements | n/a | 86.14 | 85 | 1.14pp |
| Frontend lines | 70 | 88.70 | 87 | 1.70pp |
| Frontend functions | 70 | 88.18 | 87 | 1.18pp |
| Frontend branches | 70 | 78.78 | 78 | 0.78pp |
| Rust Tier 1 lines | 70 | 74.35 | 73 | 1.35pp |
| Rust Tier 1 functions | 69 | 71.40 | 70 | 1.40pp |
| Rust Tier 1 regions | 70 | 74.13 | 73 | 1.13pp |
| Rust pre-push lines | 79 | 81.46 | 80 | 1.46pp |
| Rust pre-push functions | 74 | 75.75 | 75 | 0.75pp |
| Rust pre-push regions | 80 | 80.75 | 80 | 0.75pp |

## Target Selection

Use the ratchet for shared coverage floors that already have an enforcing gate.
Do not add aspirational targets that are not checked by a real command.

| Code surface | Ratchet target |
| --- | --- |
| Frontend unit/component code | Vitest global thresholds in `vite.config.ts` |
| Rust fast Tier 1 coverage | `pre-commit` `cargo llvm-cov --lib` thresholds |
| Rust integration coverage | `pre-push` `cargo llvm-cov nextest --profile push` thresholds |
| Pure Rust helper examples | Doctests only after examples are executable and non-ignored |
| New critical modules | Raise the relevant existing target, or add a focused gate first |

## Enforcement

`npx tsx scripts/check-coverage-ratchet.ts` verifies these invariants:

- checked threshold values match `scripts/coverage-ratchet-targets.json`
- if `origin/main` already has targets, this branch cannot lower them
- if `origin/main` already has a target or metric, this branch cannot remove it

This keeps threshold changes explicit. Raising pressure requires changing the
target file and the real threshold in the same PR. Lowering pressure is blocked
against `origin/main` after the target file exists on main, and deleting a
target requires an explicit policy change rather than silent omission.

## Hook And CI Route

`pre-push` runs the ratchet after signed-commit verification and before
path-sensitive frontend/Rust gates. The check is fast and runs for docs-only
changes too, because threshold drift is independent of touched application code.

GitHub CI runs the ratchet in Frontend Checks, then runs frontend tests with
coverage enabled so `vite.config.ts` thresholds are enforced remotely. Rust
coverage cutoff enforcement remains the local pre-push gate because the push
profile includes the heavier testcontainer integration lane.

## Owner And Triage

The PR that changes a threshold owns the measured evidence, the matching target
file update, and any follow-up issue for legacy weak spots. If the ratchet fails:

1. Compare the failed source path with `scripts/coverage-ratchet-targets.json`.
2. Rerun the exact measured command for that target.
3. Fix missing tests or align the target/config pair before lowering anything.

Rollback is allowed only with explicit measured rationale, PR owner, and a
follow-up issue. Do not add permanent broad exemptions or silently delete a
target.

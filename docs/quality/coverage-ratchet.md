# Coverage Ratchet

## Scope

The ratchet locks coverage thresholds, not raw measured coverage artifacts.
Measured coverage is still enforced by Vitest and `cargo llvm-cov` during the
normal hook route.

Current ratchet targets:

| Target | Source | Metrics |
| --- | --- | --- |
| `frontend.vitest.global` | `vite.config.ts` | lines 70, functions 70, branches 70 |
| `rust.pre_commit.tier1` | `lefthook.yml` | lines 70, functions 69, regions 70 |
| `rust.pre_push.integration` | `scripts/hooks/pre-push-path-router.sh` | lines 79, functions 74, regions 80 |

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

`npx tsx scripts/check-coverage-ratchet.ts` verifies two invariants:

- checked threshold values match `scripts/coverage-ratchet-targets.json`
- if `origin/main` already has targets, this branch cannot lower them

This keeps threshold changes explicit. Raising pressure requires changing the
target file and the real threshold in the same PR. Lowering pressure is blocked
against `origin/main` after the target file exists on main.

## Hook Route

`pre-push` runs the ratchet after signed-commit verification and before
path-sensitive frontend/Rust gates. The check is fast and runs for docs-only
changes too, because threshold drift is independent of touched application code.

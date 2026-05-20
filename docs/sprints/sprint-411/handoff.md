# sprint-411 handoff

## Summary

Moved Tauri command registration into `commands::registry::register_all` so
future command additions no longer edit the main `lib.rs` builder lifecycle
block.

## Changed Files

- `src-tauri/src/commands/registry.rs`
  - New Wry-runtime command registry with the existing `generate_handler!`
    command list grouped by domain.
- `src-tauri/src/commands/mod.rs`
  - Exports the new `registry` module.
- `src-tauri/src/lib.rs`
  - Replaces the inline command list with
    `commands::registry::register_all(builder)`.
- `docs/sprints/sprint-411/contract.md`
  - Records scope, acceptance criteria, and non-goals for the sprint.

## Guardrails

- The registry uses `tauri::Builder<tauri::Wry>` because existing command
  arguments include Wry-backed `tauri::Window` and `AppHandle` values.
- Boot phase marker `invoke-handler-register` remains in `lib.rs` after command
  registration.
- Command signatures and frontend invoke keys are unchanged.

## Validation

- `cargo fmt --check`
- `cargo check --all-targets --all-features`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test --all-targets --all-features`
- `pnpm exec tsc --noEmit`
- `pnpm run lint` (0 errors, existing max-lines warnings only)
- `pnpm exec prettier --check docs/sprints/sprint-411/contract.md docs/sprints/sprint-411/handoff.md`
- `git diff --check`

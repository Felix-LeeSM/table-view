# Sprint Execution Brief: sprint-352

## Objective

Extend `set_mongo_validator` / `get_mongo_validator` IPC pair to round-trip `validationLevel` (`off` / `strict` / `moderate`) and `validationAction` (`error` / `warn`). Surface both in `ValidatorPanel` as `<select>` controls. When `level === "off"`, disable the action select with an inline hint.

## Task Why

The user explicitly asked for the `moderate` + `warn` migration pattern (apply schema to existing collections without rejecting legacy data). Without these toggles, only `strict` / `error` (MongoDB defaults) is reachable from the UI. The Rust IPC currently only sends the validator JSON document — extending the wire is a small, contained backend change.

## Scope Boundary

- ✅ Touch: `src-tauri/src/db/traits.rs`, `src-tauri/src/db/mongodb/schema.rs`, `src-tauri/src/commands/document/browse.rs`, `src-tauri/tests/mongo_integration.rs`, `src/lib/tauri/document.ts`, `src/components/document/ValidatorPanel.tsx`, new `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`.
- ❌ Do NOT touch: any sprint-350 / sprint-351 file. Specifically: `MongoStructurePanel.tsx`, `MongoIndexesPanel.tsx`, `CreateMongoIndexDialog.tsx`, `DropMongoIndexDialog.tsx`, `MainArea.tsx`, `DocumentDataGrid.tsx`.
- ❌ Do NOT change non-validator command signatures.
- ❌ Do NOT introduce a GUI JSON Schema builder.

## Invariants

- Pre-existing `mongo_integration.rs` tests stay green and unmodified.
- Sprint-350 + sprint-351 surfaces work unchanged.
- IPC backward compat: existing callers that omit level/action keep working.
- `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` all green.

## Done Criteria

1. `DocumentAdapter::set_collection_validator` signature extends with `validation_level: Option<String>` + `validation_action: Option<String>`. Mongo impl writes them into the `collMod` doc when `Some`.
2. `DocumentAdapter::get_collection_validator` returns the trio (validator + level + action) parsed from `listCollections.options`.
3. Tauri commands enforce whitelist validation before adapter dispatch (returns `AppError::Validation` for any unknown value).
4. `ValidatorPanel` renders level + action selects, binds to read response, disables action when level=off, and round-trips through Save.
5. Three named mongo_integration tests pass live (or take the skip-on-no-container path with exit 0).
6. Backward-compat: legacy `{ validator } | null` response shape still renders without crashing; selects fall back to MongoDB defaults.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `cd src-tauri && cargo fmt --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test -p table-view-lib --lib`
  4. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration`
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
  7. `pnpm vitest run src/components/document/ValidatorPanel.test.tsx src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`
  8. `pnpm vitest run` (full)
- Required evidence:
  - Trait + adapter + command diffs.
  - The TS binding's new shape.
  - For each AC, the testid / test name / cargo test name.
  - Container reachability note.

## Evidence To Return

- Changed files and purpose.
- Each Verification Plan check's outcome.
- Per-AC: testid or test name.
- Assumptions (e.g. exact whitelist enforcement order, exact UI copy for "action disabled when off").
- Residual risk.

## References

- Contract: `docs/sprints/sprint-352/contract.md`
- Master spec: `docs/sprints/sprint-350/spec.md`
- Prior sprints: `docs/sprints/sprint-350/handoff.md`, `docs/sprints/sprint-351/handoff.md`
- Relevant files:
  - `src-tauri/src/db/traits.rs` (DocumentAdapter trait body)
  - `src-tauri/src/db/mongodb/schema.rs` (existing `collMod` builder + `listCollections.options` reader location)
  - `src-tauri/src/commands/document/browse.rs` (existing `get_mongo_validator` line 225-, `set_mongo_validator` line 254-)
  - `src-tauri/tests/mongo_integration.rs` (skip-when-no-container pattern)
  - `src/lib/tauri/document.ts` (existing bindings)
  - `src/components/document/ValidatorPanel.tsx` (existing v0; extend)
  - `src/components/document/ValidatorPanel.test.tsx` (existing tests; keep passing)

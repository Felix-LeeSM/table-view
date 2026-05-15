# Sprint Execution Brief: sprint-351

## Objective

Add Mongo index CRUD with the full MongoDB option set. Adapter trait method + Mongo impl + two new Tauri commands + IndexesPanel UI (`+ Index` button → Create dialog, per-row trash → Drop confirm). Driver errors surface inline; `_id_` is never droppable; `expireAfterSeconds` is rejected on compound indexes.

## Task Why

After sprint-350 (tracer) the Indexes panel is read-only. The user finalized the design with the full option set (unique / sparse / TTL / partialFilterExpression / collation) and explicit `_id_` protection. Without write support the Structure pane half-ships; the Mongo adapter currently does not even declare these methods, so the trait must be extended first.

## Scope Boundary

- ✅ Touch: `src-tauri/src/db/traits.rs`, `src-tauri/src/db/mongodb.rs` (and an optional `src-tauri/src/db/mongodb/indexes.rs` submodule if cleaner), `src-tauri/src/commands/document/browse.rs`, `src-tauri/src/lib.rs`, `src-tauri/tests/mongo_integration.rs`, `src/lib/tauri/document.ts`, `src/components/document/MongoIndexesPanel.tsx`, two new dialog files (`CreateMongoIndexDialog.tsx`, `DropMongoIndexDialog.tsx`), and their test files.
- ❌ Do NOT touch: `ValidatorPanel.tsx`, `DocumentDataGrid.tsx`, `MongoStructurePanel.tsx` body (the panel already takes a child slot for Indexes), `MainArea.tsx` document branch, any RDB-paradigm file.
- ❌ Do NOT touch validator-related IPC or UI (sprint-352).
- ❌ Do NOT add advanced index flags (`hidden`, `storageEngine`, `weights`, `textIndexVersion`, etc.).
- ❌ Do NOT introduce index editing (drop + recreate is the contract).

## Invariants

- Sprint-350 sub-tab / sub-sub-tab keyboard behavior intact.
- RDB structure UI byte-identical.
- `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` all green.
- Existing `mongo_integration.rs` tests untouched and still pass (only new tests added).
- Existing `list_mongo_indexes` Tauri command unchanged in parameters.

## Done Criteria

1. `DocumentAdapter` trait declares `create_collection_index` + `drop_collection_index`; Mongo impl translates the request into `IndexModel` + `CreateIndexOptions`; driver errors map to `AppError::Database`. The eight named integration tests (see contract AC-351-01) exist and pass when the container is reachable.
2. Two new Tauri commands `create_mongo_index` + `drop_mongo_index` are registered in `invoke_handler` and dispatched through `as_document()`. They enforce three server-side validations: at least one field, compound-index TTL rejection, `_id_` drop rejection.
3. `MongoIndexesPanel` renders a `+ Index` button + per-row trash button (disabled for `_id_`); on successful create/drop the list re-runs `list_mongo_indexes` and toasts the affected name.
4. `CreateMongoIndexDialog` covers all five option groups (compound fields with asc/desc, unique, sparse, TTL with compound-aware gating, partialFilterExpression with client-side JSON validation, collation with locale + strength).
5. `DropMongoIndexDialog` is typing-confirm.
6. Coverage: Vitest cases per the contract's Test Requirements list; new Rust tests per AC-351-01.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `cd src-tauri && cargo fmt --check`
  2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
  3. `cd src-tauri && cargo test -p table-view-lib --lib`
  4. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration` (skip-on-no-container expected; report clearly if container unavailable)
  5. `pnpm tsc --noEmit`
  6. `pnpm lint`
  7. `pnpm vitest run src/components/document/__tests__/MongoIndexesPanel.test.tsx src/components/document/__tests__/CreateMongoIndexDialog.test.tsx src/components/document/__tests__/DropMongoIndexDialog.test.tsx`
  8. `pnpm vitest run` (full) — confirm net new failures = 0 vs baseline (4 pre-existing in themes/autocompleteTheme stay flat).
- Required evidence:
  - Trait diff: signature additions with the request types.
  - Mongo adapter diff: option mapping + driver-call surface.
  - Per-AC: testid or test name proving it.
  - Container reachability: explicit yes/no note from the Generator.

## Evidence To Return

- Changed files and purpose (one line each).
- Each Verification Plan check's outcome (paste raw last lines or exit code).
- Done Criteria coverage with AC → testid / cargo test name → file:line.
- Assumptions (e.g. how `expireAfterSeconds` is typed in TS — number vs string, how `collation strength` defaults).
- Residual risk (e.g. container unreachable forcing the Generator to rely on type-check + unit coverage for the adapter impl).

## References

- Contract: `docs/sprints/sprint-351/contract.md`
- Master spec (all 3 sprints): `docs/sprints/sprint-350/spec.md`
- Prior sprint handoff: `docs/sprints/sprint-350/handoff.md` (note: `MongoIndexesPanel` was created in 350 as RO; sprint-351 extends it).
- Relevant files:
  - `src-tauri/src/db/traits.rs` (DocumentAdapter trait body starts at line 654)
  - `src-tauri/src/db/mongodb.rs` (Mongo adapter)
  - `src-tauri/src/commands/document/browse.rs` (existing Mongo command patterns; `list_mongo_indexes` at line 176+ is the template)
  - `src-tauri/src/lib.rs` (invoke_handler registration site)
  - `src-tauri/tests/mongo_integration.rs` (skip-on-no-container pattern; uses `common::setup_mongo_adapter()`)
  - `src-tauri/tests/common/` (existing helpers)
  - `src/lib/tauri/document.ts` (existing bindings)
  - `src/components/document/MongoIndexesPanel.tsx` (built in sprint-350; extend here)
  - `src/components/ui/dialog.tsx` or equivalent shadcn primitives (use existing project dialogs — do NOT roll your own Radix wrapper)
  - `src/components/connection/ConnectionDialog.tsx` (precedent for typing-confirm + JSON validation patterns; consult for style)

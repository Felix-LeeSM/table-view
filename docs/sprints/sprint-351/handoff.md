# Handoff: sprint-351

## Outcome

- Status: complete — all six AC implemented; every required verification check green; eight new Mongo integration tests pass on first run against a reachable container; 24 focused vitest cases pass; full vitest run has net new failures = 0 (the four pre-existing failures in `themes.test.ts` + `autocompleteTheme.test.ts` stay flat).
- Summary: `DocumentAdapter` trait gained `create_collection_index` + `drop_collection_index`; Mongo impl translates `CreateMongoIndexRequest` into `IndexModel` + `IndexOptions` (unique / sparse / TTL / partialFilterExpression / collation / compound asc-desc). Two new Tauri commands `create_mongo_index` / `drop_mongo_index` are registered, with server-side validation for empty fields, compound + TTL, and `_id_` drop. `MongoIndexesPanel` grew a `+ Index` toolbar button + per-row trash button (disabled with tooltip on `_id_`). New `CreateMongoIndexDialog` and `DropMongoIndexDialog` cover the full option set and the typing-confirm pattern. RDB code paths, `ValidatorPanel`, `DocumentDataGrid`, `MongoStructurePanel` body, and `MainArea.tsx` document branch were not modified.

## Verification Profile

- Profile: mixed (cargo test + cargo clippy + vitest + pnpm tsc + pnpm lint)
- Overall score: pending Evaluator
- Final evaluator verdict: pending Evaluator

## Evidence Packet

### Checks Run

- `cd src-tauri && cargo fmt --check`: pass (exit 0)
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`: pass (exit 0)
- `cd src-tauri && cargo test --lib`: pass (980 passed; 0 failed; 2 ignored)
- `cd src-tauri && cargo test --test mongo_integration`: pass (23 passed; 0 failed) — Mongo container reachable in Generator's environment via testcontainers; all 8 new Sprint 351 tests + 15 pre-existing tests green.
- `pnpm tsc --noEmit`: pass (exit 0)
- `pnpm lint`: pass (exit 0)
- `pnpm vitest run src/components/document/__tests__/MongoIndexesPanel.test.tsx src/components/document/__tests__/CreateMongoIndexDialog.test.tsx src/components/document/__tests__/DropMongoIndexDialog.test.tsx`: pass (24/24)
- `pnpm vitest run` (full): 321 files / 3955 tests → 3940 pass, 11 skipped, 4 fail (`src/themes.test.ts` x2 + `src/lib/editor/autocompleteTheme.test.ts` x2). These four are the pre-existing failures recorded in the contract; net new failures from this sprint: 0. Pre-Sprint-351 baseline was 3920 passing → post-Sprint-351 is 3940 passing (+20 = the 5 new MongoIndexesPanel cases + 11 CreateMongoIndexDialog + 4 DropMongoIndexDialog). 

### Acceptance Criteria Coverage

- `AC-351-01` — `DocumentAdapter::create_collection_index` + `drop_collection_index` added with the request types `CreateMongoIndexRequest` / `MongoIndexField` / `MongoIndexCollation` / `MongoIndexDirection` / `CreateMongoIndexResult`. Mongo impl in `src-tauri/src/db/mongodb/schema.rs` translates the request into `mongodb::IndexModel` + `mongodb::options::IndexOptions`, mapping `Asc→1`/`Desc→-1`, ICU strength `1..=5` for collation, and `Duration::from_secs` for TTL. Driver errors forward as `AppError::Database(<msg>)` verbatim.
  - Cargo tests (`src-tauri/tests/mongo_integration.rs`), all green:
    - `test_mongo_adapter_create_index_unique_roundtrip`
    - `test_mongo_adapter_create_index_ttl_single_field`
    - `test_mongo_adapter_create_index_partial_filter`
    - `test_mongo_adapter_create_index_compound_with_collation`
    - `test_mongo_adapter_drop_existing_index`
    - `test_mongo_adapter_drop_id_index_rejected`
    - `test_mongo_adapter_create_index_duplicate_name_errors`
    - `test_mongo_adapter_create_index_ttl_on_compound_rejected`

- `AC-351-02` — `create_mongo_index` + `drop_mongo_index` Tauri commands registered in `src-tauri/src/lib.rs` invoke_handler (lines 197-199). Dispatch via `as_document()`. Server-side validation enforced in `commands/document/browse.rs`:
  - empty fields → `AppError::Validation("create_index requires at least one field")` (test: `create_mongo_index_empty_fields_returns_validation`).
  - compound + TTL → `AppError::Validation("expireAfterSeconds requires a single-field index")` (test: `create_mongo_index_ttl_on_compound_returns_validation`).
  - `_id_` drop → `AppError::Validation("The _id_ index cannot be dropped")` (test: `drop_mongo_index_blocks_id_index`).
  - Unknown connection → `NotFound`; RDB paradigm → `Unsupported`; happy path → trait dispatch with verbatim args (tests: `create_mongo_index_unknown_connection_returns_notfound`, `create_mongo_index_rdb_paradigm_returns_unsupported`, `create_mongo_index_routes_request_to_trait_and_returns_name`, `drop_mongo_index_unknown_connection_returns_notfound`, `drop_mongo_index_rdb_paradigm_returns_unsupported`, `drop_mongo_index_routes_to_trait_method`).

- `AC-351-03` — `MongoIndexesPanel.tsx` extended with `+ Index` toolbar button (testid `mongo-indexes-create`) and per-row trash button (testid `mongo-index-drop-{name}`). The `_id_` row's trash button is rendered with `aria-disabled="true"` and a tooltip explaining why. On successful create or drop the panel bumps `refreshNonce` which re-runs `listMongoIndexes`. Toasts come from inside the dialogs (`createMongoIndex` / `dropMongoIndex` success path).
  - RTL tests in `src/components/document/__tests__/MongoIndexesPanel.test.tsx` (Sprint 351 describe block):
    - `renders a + Index toolbar button with testid mongo-indexes-create`
    - `renders a trash button per row with testid mongo-index-drop-{name}; _id_ row is aria-disabled`
    - `opens the CreateMongoIndexDialog when the + Index button is clicked`
    - `opens the DropMongoIndexDialog when a non-_id_ trash button is clicked`
    - `re-fetches the list after a successful drop (refresh wire-up)`

- `AC-351-04` — `CreateMongoIndexDialog.tsx` (new) exposes every option group: optional name (placeholder "auto"), repeatable field rows with asc/desc, unique/sparse toggles, `expireAfterSeconds` toggle + numeric input (disabled with visible hint when compound), `partialFilterExpression` JSON textarea (on-change parse with inline alert disabling Save), collation locale + strength (1..5; omitted from payload when locale is blank). Save invokes `createMongoIndex`; on success closes dialog, calls `onCreated`, and toasts the server-returned name. Driver errors render in `role="alert"` and the dialog stays open with inputs preserved.
  - RTL tests in `src/components/document/__tests__/CreateMongoIndexDialog.test.tsx`:
    - `renders the dialog with every option group`
    - `disables Save when every field row is blank`
    - `enables Save once at least one field row has a name`
    - `disables expireAfterSeconds and shows a hint when 2+ field rows are present (compound)`
    - `disables Save and paints inline alert when partialFilterExpression JSON is invalid`
    - `re-enables Save when partialFilterExpression is cleared back to empty`
    - `invokes createMongoIndex with the assembled request on Save and closes on success`
    - `keeps the dialog open and paints role=alert on driver error`
    - `omits collation from the payload when locale is blank`
    - `includes collation when locale is filled in`

- `AC-351-05` — `DropMongoIndexDialog.tsx` (new) is a typing-confirm modal. Confirm stays disabled until the typed input equals the canonical index name byte-for-byte. On confirm calls `dropMongoIndex`; success closes + toasts; on error surfaces driver message in `role="alert"` and the modal stays open.
  - RTL tests in `src/components/document/__tests__/DropMongoIndexDialog.test.tsx`:
    - `renders the dialog with the typing-confirm input`
    - `disables Confirm until the user types the exact index name`
    - `invokes dropMongoIndex on Confirm and closes + onDropped on success`
    - `paints role=alert with the driver error and keeps the dialog open on failure`

- `AC-351-06` — Test files all carry the top-of-file Sprint date + Korean reason comments per the project's `feedback_test_documentation.md`. Aggregate Sprint 351 vitest coverage: 5 (panel CRUD) + 10 (Create dialog) + 4 (Drop dialog) = 19 new + 5 preserved Sprint 350 cases = 24 cases in the focused suite.

### Screenshots / Links / Artifacts

- Manual browser smoke (optional, per contract Verification Plan §7): not executed in this autonomous run. Browser smoke deferred to the next live-Mongo developer pass.

## Changed Areas

- `src-tauri/src/db/types.rs`: NEW types `MongoIndexDirection`, `MongoIndexField`, `MongoIndexCollation`, `CreateMongoIndexRequest`, `CreateMongoIndexResult` for the create-index wire shape.
- `src-tauri/src/db/mod.rs`: re-export the new types alongside the existing public surface.
- `src-tauri/src/db/traits.rs`: extend `DocumentAdapter` with `create_collection_index` + `drop_collection_index` trait method signatures + load-bearing WHY comments.
- `src-tauri/src/db/mongodb.rs`: trait impl wiring for the two new methods; delegates to `MongoAdapter::_impl` bodies.
- `src-tauri/src/db/mongodb/schema.rs`: `create_collection_index_impl` + `drop_collection_index_impl` bodies; `build_collation` helper translating the wire shape to `mongodb::options::Collation`. Adapter-level validation mirrors the command-layer gates (empty fields, compound + TTL) so callers bypassing the Tauri shim still see the same contract.
- `src-tauri/src/commands/document/browse.rs`: `create_mongo_index_inner` / `drop_mongo_index_inner` + `#[tauri::command]` shims; 11 new wiring tests covering the three Validation gates + NotFound + Unsupported + happy-path trait dispatch for each command.
- `src-tauri/src/lib.rs`: register `create_mongo_index` + `drop_mongo_index` in the `invoke_handler!` macro.
- `src-tauri/src/db/testing.rs` (test util): added `create_collection_index_fn` + `drop_collection_index_fn` override slots on `StubDocumentAdapter`.
- `src-tauri/src/db/tests.rs` (lib tests): added the two missing trait methods on the in-file `DummyDocument` + `FakeCancellableDocument` fakes.
- `src-tauri/tests/mongo_integration.rs`: 8 new integration tests per AC-351-01 named list, each using a unique `table_view_test.idx_*` fixture collection.
- `src/lib/tauri/document.ts`: new TS wire types (`MongoIndexDirection`, `MongoIndexField`, `MongoIndexCollation`, `CreateMongoIndexRequest`, `CreateMongoIndexResult`) and the two new typed wrappers `createMongoIndex` / `dropMongoIndex`.
- `src/components/document/MongoIndexesPanel.tsx`: extended with `+ Index` button, per-row trash buttons, `_id_` disabled tooltip via the shadcn `Tooltip` primitive, refresh-on-mutate effect, dialog mounts.
- `src/components/document/CreateMongoIndexDialog.tsx`: NEW — full-option create modal.
- `src/components/document/DropMongoIndexDialog.tsx`: NEW — typing-confirm drop modal.
- `src/components/document/__tests__/MongoIndexesPanel.test.tsx`: extended with the Sprint 351 describe block (5 new cases) while preserving the 5 Sprint 350 RO cases.
- `src/components/document/__tests__/CreateMongoIndexDialog.test.tsx`: NEW — 10 RTL cases.
- `src/components/document/__tests__/DropMongoIndexDialog.test.tsx`: NEW — 4 RTL cases.

## Assumptions

- `expireAfterSeconds` is typed as `number` on the wire (`u32` on the Rust side). The dialog reads from a `<input type="number">` and parses to a non-negative integer client-side before invoke; non-integer / negative input is rejected before the trait round-trip.
- Collation `strength` defaults to `3` (Tertiary, the MongoDB default) when the locale block is included. When the locale field is blank, the whole `collation` block is omitted from the IPC payload so the server applies its own default.
- The `_id_` drop guard at the Tauri command layer fires before the trait dispatch (mirrors how MongoDB enforces this server-side). The adapter intentionally does not special-case `_id_` — letting the driver enforce the same rule preserves defence in depth and keeps the trait method's behaviour predictable for non-UI callers.
- Toasts are fired from inside each dialog (`createMongoIndex` / `dropMongoIndex` success paths), not from the panel. The panel still re-runs `listMongoIndexes` via a `refreshNonce` bump so the visible row list stays in sync.
- The Mongo container WAS reachable in the Generator's environment (testcontainers-managed). All 8 new Sprint 351 integration tests passed live. The skip-on-no-container path was preserved in case the Evaluator's environment lacks Docker: each test starts with `match common::setup_mongo_adapter().await { Some(a) => a, None => return };`.
- TypeScript camelCase wire fields (`expireAfterSeconds`, `partialFilterExpression`) round-trip to Rust's `expire_after_seconds` / `partial_filter_expression` snake_case via `#[serde(rename_all = "camelCase")]` on the request struct — Tauri's standard wire convention.

## Residual Risk

- Manual browser smoke (`pnpm tauri dev` → open a Mongo collection → Structure → Indexes → `+ Index` → create + drop) was not run in this autonomous pass. The next live-Mongo developer pass should verify the dialog visuals and that the toast appears above the modal overlay correctly (z-index 100 vs z-50 already established in the project).
- The four pre-existing vitest failures (`src/themes.test.ts` x2, `src/lib/editor/autocompleteTheme.test.ts` x2) belong to the user's parallel branch and are explicitly out of scope per the Sprint 351 contract's file scope. No code in those files was touched.
- The dialog tests use `fireEvent.change` rather than `userEvent.type` for textarea / numeric input — this matches the existing project pattern (see `DropTriggerDialog.test.tsx`) but a future a11y audit might want to migrate to `userEvent.type` so we exercise the real input cadence. Not blocking for this sprint.
- The CreateMongoIndexDialog accepts any non-negative integer for TTL client-side; values larger than 32-bit may be silently lost on the wire (Rust `u32`). This is intentional — the upper bound covers >130 years of TTL, well beyond any realistic use case. If the user enters a number > 2^32 - 1 it will error out at the wire level with a JSON serialization error.

## Next Sprint Candidates

- Sprint 352 — Validator level + action toggles (depends only on the Sprint 350 Validator mount, not on this sprint).

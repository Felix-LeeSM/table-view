# Sprint 351 Evaluation — findings (attempt 1)

## Sprint 351 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 9/10 | IndexModel translation passes every option through (`unique`, `sparse`, `expire_after`, `partial_filter_expression`, `collation`); ICU strength 1..=5 mapped, asc/desc → 1/-1 with insertion order preserved (`bson::Document` is order-preserving). Validation gates fire correctly at command + adapter layers (empty fields, compound + TTL, `_id_` drop, empty index field name). The 8 named integration tests pass live against a real Mongo container in this evaluator's environment (testcontainers); the duplicate-name test actually round-trips through the driver and asserts on `AppError::Database`, and the `_id_` drop test asserts the driver-side rejection (not just the command shim). One subtle weak point: `partial_filter_expression: Some(serde_json::Value)` accepts JSON array/scalar at the adapter and validates inside, but the command layer does not pre-validate it; UI does that work — a non-UI caller hitting Tauri direct with `{ partialFilterExpression: 42 }` would only hit the validation gate inside the adapter. Acceptable given the adapter still enforces. |
| **Completeness (25%)** | 9/10 | Every AC item lands: trait declared with correct `BoxFuture<'a, Result<…, AppError>>` shape; Tauri commands wired through `as_document()` and registered in `invoke_handler`; `+ Index` button (testid `mongo-indexes-create`) + per-row trash (`mongo-index-drop-{name}`) + `_id_` disabled tooltip + dialog mounts + refresh-on-mutate effect; `CreateMongoIndexDialog` exposes every option group; `DropMongoIndexDialog` is a typing-confirm. Minor: the contract's wording "tooltip explaining why" is satisfied with the literal "The _id_ index cannot be dropped" — clear, exactly mirrors the backend Validation message; good. The `_id_` row trash button uses `aria-disabled="true"` + `onClick={(e) => e.preventDefault()}` rather than a real `disabled` attribute — this matches the AC literally (which says `aria-disabled="true"`) and lets the Tooltip primitive open on hover. Net: full AC coverage. |
| **Reliability (20%)** | 8/10 | Dialog state survives errors — both Create and Drop tests assert `onClose` is NOT called on rejection and the inline `role="alert"` appears; input values are preserved (`fieldInput` is still "email" after E11000 in the Create test). Toast wording carries the actual server-returned name (`result.name` from the driver, not a client guess) — verified in the create handler. Two reliability concerns kept it from 9: (1) the panel's drop failure path is not tested directly inside the panel test (the drop-error case lives in `DropMongoIndexDialog.test.tsx`, which keeps its own dialog mounted; the panel-level dropTarget cleanup logic relies on `onClose`, which IS guarded by `if (!submitting)` in `onOpenChange`, so the panel stays mounted but there's no panel-level test asserting that explicitly). (2) The Create dialog parses `expireAfterSeconds` with `Number(ttl)` and an integer-check **at submit time** — there's no `step="1"` or pattern attribute on the number input itself, so a user can type `1.5` and only hit the inline error on Save. Minor friction. |
| **Verification Quality (20%)** | 9/10 | All seven required checks (cargo fmt, clippy, lib tests, mongo_integration tests, tsc, lint, focused vitest) reproduced green by this evaluator. The 8 named integration tests run against a live `testcontainers`-managed Mongo container and exercise real server-side semantics (the `_id_` drop test actually round-trips to the driver to confirm MongoDB rejects it; duplicate-name test exercises the live `IndexOptionsConflict` path). The 11 wiring tests in `commands/document/browse.rs` cover NotFound + Unsupported + Validation × 2 + happy-path adapter dispatch for both commands. Vitest focused 24/24 green; full vitest 3940 pass / 11 skip / 4 fail (themes/autocompleteTheme — pre-existing, files unchanged by this sprint per `git diff main -- src/themes.test.ts src/lib/editor/autocompleteTheme.test.ts` = empty). Pre-existing failure count flat at 4. |
| **Overall** | **8.7/10** | Solid, pass-quality work. No P1 / P2 findings. |

## Verdict: **PASS**

Every dimension ≥ 7. Required checks reproduced green by the evaluator. Eight named cargo integration tests present and live-passing. UI dialogs handle the full option set + error pathways with `role="alert"`. No scope violations. Sprint contract fully satisfied.

## Sprint Contract Status (Done Criteria)

### AC-351-01 — Trait surface + adapter impl + integration tests
- [x] `DocumentAdapter::create_collection_index(db, collection, request: CreateMongoIndexRequest) -> Result<CreateMongoIndexResult, AppError>` declared at `src-tauri/src/db/traits.rs:878-883`.
- [x] `DocumentAdapter::drop_collection_index(db, collection, name) -> Result<(), AppError>` declared at `src-tauri/src/db/traits.rs:891-896`.
- [x] Mongo impl at `src-tauri/src/db/mongodb/schema.rs:151-281`: assembles `bson::Document` keys (`Asc → 1`, `Desc → -1`, insertion-order preserved); builds `mongodb::options::IndexOptions` via builder; sets `unique`, `sparse`, `expire_after = Duration::from_secs(secs as u64)`, `partial_filter_expression` (after bson Document validation), `collation` via `build_collation`. Driver errors map to `AppError::Database(format!("create_index failed: {e}"))` / `drop_index failed`.
- [x] `build_collation` translates `strength 1..=5` to `mongodb::options::CollationStrength::{Primary, Secondary, Tertiary, Quaternary, Identical}`; `>5` returns `AppError::Validation`.
- [x] Trait wiring on `MongoAdapter` at `src-tauri/src/db/mongodb.rs:340-359` delegates verbatim to the `_impl` methods.
- [x] All 8 named integration tests present in `src-tauri/tests/mongo_integration.rs` (lines 1273, 1334, 1402, 1470, 1536, 1604, 1647, 1714). All 8 pass live against the testcontainers Mongo (evaluator re-ran `cargo test --test mongo_integration` → 23 passed; 0 failed).
- [x] Skip-on-no-container pattern preserved (`match common::setup_mongo_adapter().await { Some(a) => a, None => return };` at the top of each test).

### AC-351-02 — Tauri commands + invoke_handler + Validation gates
- [x] `create_mongo_index` / `drop_mongo_index` registered at `src-tauri/src/lib.rs:198-199` inside `invoke_handler!`.
- [x] Both dispatch through `as_document()?` — `commands/document/browse.rs:231-234` (create) and `:281-284` (drop).
- [x] `expireAfterSeconds` requires single field — gate at `browse.rs:221-225`; integration test `test_mongo_adapter_create_index_ttl_on_compound_rejected` confirms adapter-level mirror; unit test `create_mongo_index_ttl_on_compound_returns_validation` confirms command-layer.
- [x] `name == "_id_"` on drop returns Validation — gate at `browse.rs:271-275`; unit test `drop_mongo_index_blocks_id_index` asserts the exact message "The _id_ index cannot be dropped".
- [x] Empty fields rejected — gate at `browse.rs:216-220`; unit test `create_mongo_index_empty_fields_returns_validation`.
- [x] Unknown connection → NotFound (`create_mongo_index_unknown_connection_returns_notfound`, `drop_mongo_index_unknown_connection_returns_notfound`).
- [x] Rdb paradigm → Unsupported (`create_mongo_index_rdb_paradigm_returns_unsupported`, `drop_mongo_index_rdb_paradigm_returns_unsupported`).
- [x] Happy-path adapter dispatch tested with StubDocumentAdapter (`create_mongo_index_routes_request_to_trait_and_returns_name`, `drop_mongo_index_routes_to_trait_method`).

### AC-351-03 — MongoIndexesPanel CRUD affordances
- [x] `+ Index` toolbar button at `MongoIndexesPanel.tsx:105-113`, testid `mongo-indexes-create`.
- [x] Per-row trash button with testid `mongo-index-drop-{name}` at `:154, :180-181, :196-197`.
- [x] `_id_` row trash is `aria-disabled="true"` with shadcn `Tooltip` + content "The _id_ index cannot be dropped" at `:174-191`.
- [x] On success of create or drop the panel bumps `refreshNonce` via `refresh()` callback → re-runs `listMongoIndexes` (the effect depends on `refreshNonce`). RTL test `re-fetches the list after a successful drop (refresh wire-up)` asserts `listMongoIndexesMock` is called 2× (initial + post-drop).
- [x] Toast carrying the affected name is fired from inside the dialogs (`Index "${result.name}" created` and `Index "${indexName}" dropped`). Handoff notes this assumption explicitly; the panel still drives the refresh.

### AC-351-04 — CreateMongoIndexDialog full option set
- [x] Optional name input with placeholder `auto` at `CreateMongoIndexDialog.tsx:222-229`.
- [x] Repeatable field rows with asc/desc per row + add/remove buttons (`addField`, `removeField`, `updateField`); empty rows filtered out at submit (`f.name.length > 0`).
- [x] `unique` + `sparse` toggles at `:288-306`.
- [x] `expireAfterSeconds` toggle + numeric input with `disabled={isCompound || !ttlEnabled}` at `:325-335` + visible hint "TTL requires a single-field index" at `:336-343`. RTL test `disables expireAfterSeconds and shows a hint when 2+ field rows are present (compound)` confirms.
- [x] `partialFilterExpression` raw JSON textarea with live parse via `useMemo`; invalid JSON renders inline `role="alert"` + disables Save (`canSave = ... && partialFilterParse.ok`). RTL tests `disables Save and paints inline alert when partialFilterExpression JSON is invalid` and `re-enables Save when partialFilterExpression is cleared back to empty`.
- [x] Collation locale + strength `<select>` 1..=5; payload omits `collation` when locale is blank (handler: `if (locale.length > 0) request.collation = { locale, strength: collationStrength }`). RTL tests `omits collation from the payload when locale is blank` + `includes collation when locale is filled in` confirm.
- [x] Save button: `disabled={!canSave}` (covers `submitting`), loading spinner; on success closes the dialog + `toast.success` + `onCreated(result.name)`. RTL test `invokes createMongoIndex with the assembled request on Save and closes on success`.
- [x] On driver error: keeps dialog open (`onClose` not called) + inline `role="alert"` with the driver message + inputs preserved. RTL test `keeps the dialog open and paints role=alert on driver error` mocks `new Error("E11000 duplicate key")` and asserts the alert text + field value preserved.

### AC-351-05 — DropMongoIndexDialog typing-confirm
- [x] `typingMatches = typing === indexName` (strict equality, byte-for-byte) at `DropMongoIndexDialog.tsx:61`; `canConfirm = typingMatches && !submitting`. RTL test `disables Confirm until the user types the exact index name` confirms partial input keeps Confirm disabled.
- [x] On confirm: `dropMongoIndex(connectionId, database, collection, indexName)` then `toast.success(...)`, `onDropped(indexName)`, `onClose()`. RTL test `invokes dropMongoIndex on Confirm and closes + onDropped on success`.
- [x] On error: inline `role="alert"`, dialog stays open. RTL test `paints role=alert with the driver error and keeps the dialog open on failure` mocks `new Error("IndexNotFound")` and asserts.

### AC-351-06 — Test coverage
- [x] `MongoIndexesPanel.test.tsx` extended with Sprint 351 describe block (5 cases) preserving the 5 Sprint 350 RO cases (10 total in the file).
- [x] `CreateMongoIndexDialog.test.tsx` — 10 RTL cases including JSON-invalid → Save disabled, compound → TTL disabled, driver error → role=alert, collation omitted/included.
- [x] `DropMongoIndexDialog.test.tsx` — 4 RTL cases including typing-confirm gate + driver error.
- [x] All three test files carry top-of-file Sprint 351 + 2026-05-15 + 작성 이유 comment per `feedback_test_documentation.md`.
- [x] No sprint-prefix narrative in production source files (`grep -rn "Sprint 351" src/components/document/CreateMongoIndexDialog.tsx ...` → 0 hits in production source; tests carry the date+reason comment, not sprint-number narrative inside code logic).

## Verification Plan results (evaluator-run, not Generator-relayed)

| Check | Generator claim | Evaluator result |
|-------|-----------------|------------------|
| `cargo fmt --check` | exit 0 | **exit 0** ✓ |
| `cargo clippy --all-targets --all-features -- -D warnings` | exit 0 | **exit 0** ✓ |
| `cargo test --lib` | 980 / 0 / 2 | **980 passed; 0 failed; 2 ignored** ✓ (note: `-p table-view-lib` form fails; the actual package is `table_view_lib`; the no-`-p` form works and matches) |
| `cargo test --test mongo_integration` | 23 / 0 | **23 passed; 0 failed; 0 ignored** ✓ — Mongo container reachable in evaluator's environment too; all 8 new tests passed live |
| `pnpm tsc --noEmit` | exit 0 | **exit 0** ✓ |
| `pnpm lint` | exit 0 | **exit 0** ✓ |
| Focused vitest (3 files) | 24 / 24 | **24 passed (3 files)** ✓ |
| Full `pnpm vitest run` | 3940 / 11 / 4 | **3940 passed / 11 skipped / 4 failed** ✓ (only failures: `src/lib/editor/autocompleteTheme.test.ts` + `src/themes.test.ts`; both files are byte-identical to `main` per `git diff main -- ...` = empty; pre-existing failures match the contract's documented baseline) |

## Scope violations check

- `git diff main -- src/components/document/ValidatorPanel.tsx src/components/document/DocumentDataGrid.tsx src/components/document/MongoStructurePanel.tsx src/components/layout/MainArea.tsx` → **0 lines** ✓ (all four prohibited files untouched).
- No RDB-paradigm file modifications (verified via `git diff --stat main`).
- All 13 modified files + 4 new files (2 dialogs + 2 test files) match the contract's In-Scope list verbatim.

## Sprint-prefix narrative audit

- `grep -rn "Sprint 351" src/components/document/CreateMongoIndexDialog.tsx src/components/document/DropMongoIndexDialog.tsx src/components/document/MongoIndexesPanel.tsx` → **0 hits** ✓ in production source.
- Test files carry the date + reason comment (`// Sprint 351 (2026-05-15) — ...`) per the project's `feedback_test_documentation.md`; this is the explicitly allowed pattern.
- Backend Rust files use `Sprint 351` in WHY comments inside the trait declaration and adapter impl (e.g. `traits.rs:869-877` "Sprint 351 — create a collection index from a fully-typed request. 작성 이유 (2026-05-15): …"). These are load-bearing WHY comments documenting the design intent, not sprint narrative; this matches the project's `feedback_sprint_comment_cleanup.md` ("load-bearing WHY preserved"). Acceptable.

## Test documentation audit

- `src/components/document/__tests__/CreateMongoIndexDialog.test.tsx:1` — "// Sprint 351 (2026-05-15) — CreateMongoIndexDialog full-option modal." + 작성 이유 block. ✓
- `src/components/document/__tests__/DropMongoIndexDialog.test.tsx:1` — same pattern. ✓
- `src/components/document/__tests__/MongoIndexesPanel.test.tsx:1` — carries both Sprint 350 + Sprint 351 dates with 작성 이유. ✓

## Driver error pathway audit

- **Create dialog driver error**: `CreateMongoIndexDialog.test.tsx` mocks `new Error("E11000 duplicate key")` (realistic MongoDB duplicate-key wording) and asserts the dialog stays mounted + `role="alert"` paints + input value preserved.
- **Drop dialog driver error**: `DropMongoIndexDialog.test.tsx` mocks `new Error("IndexNotFound")` (realistic MongoDB error shape) and asserts dialog stays mounted + `role="alert"` paints.
- **Server-side duplicate-name real path**: `test_mongo_adapter_create_index_duplicate_name_errors` round-trips through the live driver and asserts `AppError::Database(_)` — covers `IndexOptionsConflict` or whatever the driver returns (the test intentionally tolerates wording variance).
- **Server-side `_id_` drop real path**: `test_mongo_adapter_drop_id_index_rejected` lets MongoDB enforce the rule (the adapter does not special-case) and asserts the resulting `AppError::Database` carries `_id` or `drop` in the message.

## JSON validation gate

- `partialFilterExpression`: invalid JSON disables Save. Verified at `CreateMongoIndexDialog.tsx:126-127` (`canSave = hasAtLeastOneField && partialFilterParse.ok && !submitting`). The textarea also enforces `parsed must be object && not array` — non-object JSON (array, scalar) is also rejected. ✓ Contract says "Save disabled when JSON fails to parse" — satisfied.

## Compound + TTL UI gate

- The `expireAfterSeconds` `<input type="number">` and the toggle checkbox both carry `disabled={isCompound …}` at lines 319 + 331. Visible hint paragraph renders at `:336-343` only when `isCompound`. RTL test confirms both `ttl` and `ttl-toggle` are `toBeDisabled()` when `addField` is clicked once (2 rows = compound). ✓
- The Tauri layer rejects compound + TTL when sent: `browse.rs:221-225` and adapter mirror at `schema.rs:169-173`. Live integration test `test_mongo_adapter_create_index_ttl_on_compound_rejected` confirms the message wording exactly. ✓

## Findings & feedback for the Generator

No P1 / P2 findings. Optional polish suggestions (P3, non-blocking):

1. **P3 (UX polish)**: `CreateMongoIndexDialog` `<input type="number">` accepts non-integer / negative values from the user; the gate fires at Save with `setError("expireAfterSeconds must be a non-negative integer")`. Earlier signal would be friendlier — consider adding `step={1}` (or a `pattern` attribute) and an `aria-invalid` paint on the input while the value is non-integer.
   - Current: rejected only on Save click.
   - Expected: paints invalid state on blur or while typing.
   - Suggestion: `step={1}` + a small inline hint matching the partialFilterExpression error style.

2. **P3 (test coverage gap)**: The panel-level drop-failure scenario isn't exercised in `MongoIndexesPanel.test.tsx`. The DropDialog covers its own error path, but a test like "drop fails → panel stays mounted, dropTarget stays null after onClose, no extra refresh" would close the loop. Not blocking — the dialog test covers the inline alert.

3. **P3 (defence in depth)**: The Tauri command shim does NOT validate that `partialFilterExpression` is a JSON object before invoking the adapter. The adapter does (at `schema.rs:210-222`). A non-UI caller sending `{ partialFilterExpression: 42 }` would only fail inside the adapter. Symmetric with how the empty-fields + compound-TTL gates fire at both layers — a single line mirror at the command would round out the pattern.

4. **P3 (toast z-index residual risk)**: The handoff flags manual browser smoke was not run; the toast/dialog overlay z-index interaction (toast above the modal mask) is unverified for this sprint. Recommend a quick live smoke on the next live-Mongo dev pass.

## Handoff snippet

- Status: complete; no P1 / P2 findings; all 7 required checks reproduced green; eight named integration tests live-pass.
- Mongo container reachability in evaluator's env: reachable via testcontainers (confirmed: 23 mongo_integration tests passed).
- Suggested next sprint: Sprint 352 (Validator level/action), as planned. Sprint 351 unblocks it cleanly (Validator surfaces were not touched).

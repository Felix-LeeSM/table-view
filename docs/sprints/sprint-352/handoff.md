# Handoff: sprint-352

## Outcome

- Status: complete — all four AC implemented and verified; required focused suites (cargo lib, cargo clippy, cargo integration with live container, vitest validator suites, full vitest) green; backward-compat surface guarded by a dedicated Vitest case; Sprint 350/351 surfaces untouched.
- Summary: `DocumentAdapter::set_collection_validator` now accepts `validation_level: Option<String>` + `validation_action: Option<String>` and `get_collection_validator` returns the new `CollectionValidatorRead` trio (`validator` + `validationLevel` + `validationAction`). MongoDB's `collMod` builder writes only the fields the caller supplied; `listCollections.options` reader surfaces all three. The Tauri command shim whitelists allowed values (`off|strict|moderate` for level, `error|warn` for action) before adapter dispatch with `AppError::Validation(...)`. The TS binding ships a new `MongoValidatorRead` interface, two literal union types (`MongoValidationLevel`, `MongoValidationAction`), and an extended `setMongoValidator` signature with optional positional `validationLevel` / `validationAction` parameters (default `null` so legacy callers keep compiling). `ValidatorPanel` renders two new `<select>` controls (testids `validator-level-select` / `validator-action-select`) bound to the read response, disables the action select with `aria-disabled="true"` + an inline hint when `level === "off"`, and Save round-trips all three fields. The new selects participate in the dirty check.

## Verification Profile

- Profile: mixed (cargo test + cargo clippy + vitest + pnpm tsc + pnpm lint)
- Overall score: pending Evaluator
- Final evaluator verdict: pending Evaluator

## Evidence Packet

### Checks Run

- `cd src-tauri && cargo fmt --check`: pass (exit 0)
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`: pass (exit 0)
- `cd src-tauri && cargo test --lib`: pass (985 passed, 0 failed, 2 ignored — +5 vs Sprint 351 baseline 980 from the new `commands::document::browse::tests` Sprint 352 group)
- `cd src-tauri && cargo test --test mongo_integration`: pass (26/26 — 23 pre-existing + 3 new Sprint 352 tests live against the testcontainers Mongo image; skip-on-no-container path preserved on every new case)
- `pnpm tsc --noEmit`: pass (exit 0)
- `pnpm lint`: pass (exit 0)
- `pnpm vitest run src/components/document/ValidatorPanel.test.tsx src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`: pass (12/12 — 6 Sprint 333 + 6 new Sprint 352)
- `pnpm vitest run` (full): 322 files / 3961 tests → 3946 pass, 11 skipped, 4 fail (`src/themes.test.ts` x2 + `src/lib/editor/autocompleteTheme.test.ts` x2). The four are the pre-existing failures called out in the contract; net new failures from this sprint: 0. Pre-Sprint-352 baseline was 3940 passing → post-Sprint-352 is 3946 passing (+6 — the six new Sprint 352 RTL cases).

### Acceptance Criteria Coverage

- `AC-352-01` — `DocumentAdapter::set_collection_validator` signature now reads `(db, collection, validator, validation_level, validation_action)` (all optional-typed except db/collection); Mongo `_impl` includes `validationLevel` / `validationAction` in the `collMod` doc iff `Some(value)`. `get_collection_validator` returns the new `CollectionValidatorRead { validator, validation_level, validation_action }`, all derived from `listCollections.options`.
  - Live integration tests (`src-tauri/tests/mongo_integration.rs`, all green against the testcontainers image):
    - `test_mongo_adapter_set_validator_with_level_and_action_roundtrip`
    - `test_mongo_adapter_set_validator_omitted_level_action_preserves_server_defaults`
    - `test_mongo_adapter_set_validator_rejects_unknown_level`
  - Each test starts with `match common::setup_mongo_adapter().await { Some(a) => a, None => return };` — skip-path preserved when the container is unreachable.

- `AC-352-02` — `set_mongo_validator` / `get_mongo_validator` Tauri commands accept the new optional fields. Wire-level backward compat: `validation_level` + `validation_action` are `Option<String>` so payloads without these keys deserialise cleanly. Whitelist validation returns `AppError::Validation("validationLevel must be one of off|strict|moderate")` / `AppError::Validation("validationAction must be one of error|warn")` for any unknown value before the adapter is invoked.
  - Cargo `--lib` tests in `commands::document::browse::tests`:
    - `set_mongo_validator_rejects_unknown_level_with_validation_error`
    - `set_mongo_validator_rejects_unknown_action_with_validation_error`
    - `set_mongo_validator_forwards_level_and_action_verbatim`
    - `set_mongo_validator_omitted_level_action_remains_backward_compatible`
    - `get_mongo_validator_returns_trio_from_adapter`

- `AC-352-03` — `ValidatorPanel` renders both selects (`validator-level-select`, `validator-action-select`), hydrates them from the read response, surfaces the action-disabled state with `aria-disabled="true"` + a visible hint (testid `validator-action-disabled-hint`, copy "Action has no effect when level is off"), and round-trips all three fields through Save. Dirty-check covers select changes (Save re-enables on any select-only edit; re-disables after Save commits the new baseline).
  - RTL cases in `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`:
    - `AC-352-03 — hydrates level + action selects from the read response on mount`
    - `AC-352-03 — Save round-trips the current level + action choice` (covers dirty-check + 6-arg Save payload)
    - `AC-352-03 — selecting level=off disables the action select with aria-disabled and an inline hint`
    - `AC-352-03 — after Save the dirty baseline resets so Save disables until further edits`
  - The two Sprint 333 cases in the original `src/components/document/ValidatorPanel.test.tsx` were updated to assert the 6-arg `setMongoValidator` shape (with the defaults `"strict"` / `"error"` flowing through). All other Sprint 333 assertions stay verbatim.

- `AC-352-04` — Backward-compat surface guard: a Vitest case stubs `getMongoValidator` to return the legacy envelope `{ validator: <json> }` (no `validationLevel` / `validationAction` keys); the panel must not crash and the selects must fall back to MongoDB defaults (`strict` / `error`).
  - RTL cases:
    - `AC-352-04 — backward-compat: legacy { validator } response falls back to MongoDB defaults`
    - `AC-352-04 — backward-compat: pre-envelope null response keeps the selects at defaults without crashing`
  - The `normaliseReadResponse` helper inside `ValidatorPanel.tsx` carries the load-bearing WHY: it tolerates `null`, the new `{ validator, validationLevel, validationAction }` envelope, the legacy `{ validator } | null` envelope, and the bare validator JSON.

### Container Reachability

- The testcontainers Mongo image was reachable in the Generator's environment; all 3 new Sprint 352 integration tests passed live alongside the 23 pre-existing tests (26/26 green). The skip-on-no-container path (`return;` when `setup_mongo_adapter().await` is `None`) is preserved on every new test.

### TS Binding Shape

- `src/lib/tauri/document.ts` (Sprint 352 surface):

  ```ts
  export type MongoValidationLevel = "off" | "strict" | "moderate";
  export type MongoValidationAction = "error" | "warn";

  export interface MongoValidatorRead {
    validator: Record<string, unknown> | null;
    validationLevel: MongoValidationLevel | null;
    validationAction: MongoValidationAction | null;
  }

  export async function getMongoValidator(
    connectionId: string,
    database: string,
    collection: string,
  ): Promise<MongoValidatorRead>;

  export async function setMongoValidator(
    connectionId: string,
    database: string,
    collection: string,
    validator: Record<string, unknown> | null,
    validationLevel: MongoValidationLevel | null = null,
    validationAction: MongoValidationAction | null = null,
  ): Promise<void>;
  ```

- Backward-compat clincher: the two new `setMongoValidator` positional args default to `null`; the backend treats `null` as "omit the field from the `collMod` doc" so MongoDB applies its server-side defaults. Old callers (`setMongoValidator(conn, db, coll, validator)`) continue to compile and produce byte-equivalent wire payloads.

## Changed Areas

- `src-tauri/src/db/types.rs`: NEW `CollectionValidatorRead` struct (validator / level / action trio, camelCase serde rename, `Default` impl).
- `src-tauri/src/db/mod.rs`: re-exported `CollectionValidatorRead` alongside the existing public surface.
- `src-tauri/src/db/traits.rs`: `DocumentAdapter::get_collection_validator` return type widened to `CollectionValidatorRead`; `set_collection_validator` signature gained `validation_level: Option<String>` + `validation_action: Option<String>` with load-bearing WHY comments.
- `src-tauri/src/db/mongodb.rs`: trait dispatch wiring rebuilt for the new signatures.
- `src-tauri/src/db/mongodb/schema.rs`: `get_collection_validator_impl` now reads `validationLevel` / `validationAction` from `listCollections.options`. `set_collection_validator_impl` builds the `collMod` doc explicitly so optional fields are omitted (not `null`) when the caller leaves them unset — preserving wire-equivalent semantics with legacy payloads. Existing unit tests adjusted to the new arity.
- `src-tauri/src/db/testing.rs`: `StubDocumentAdapter` validator override slots reshaped; default closures now return `CollectionValidatorRead::default()`.
- `src-tauri/src/db/tests.rs`: `DummyDocument` + `FakeCancellableDocument` impls updated to the new trait shape.
- `src-tauri/src/commands/document/browse.rs`: imported `CollectionValidatorRead`; introduced `validate_level` + `validate_action` whitelist helpers; extended `set_mongo_validator_inner` + the `#[tauri::command]` shell with the new optional fields; refactored `get_mongo_validator_inner` to return the trio. Added a Sprint 352 test block (5 new cases) covering whitelist rejection (level + action), happy-path verbatim forwarding, omitted-keys backward-compat, and the new `get_mongo_validator` trio return.
- `src-tauri/tests/mongo_integration.rs`: 3 new integration tests per AC-352-01 named list, each using a unique `table_view_test.validator_*` fixture collection and the skip-on-no-container guard.
- `src/lib/tauri/document.ts`: NEW `MongoValidationLevel`, `MongoValidationAction`, `MongoValidatorRead` types; widened `getMongoValidator` return type and `setMongoValidator` parameter list with optional positional defaults.
- `src/components/document/ValidatorPanel.tsx`: full rewrite — preserved the existing testids and overall layout; added `validator-level-select` + `validator-action-select` controls; dirty-check now covers select changes; level=off disables action with `aria-disabled="true"` + visible `validator-action-disabled-hint`. `normaliseReadResponse` helper handles legacy + new envelope shapes.
- `src/components/document/ValidatorPanel.test.tsx`: kept the 6 Sprint 333 cases; updated the two assertions that pinned the old `setMongoValidator` 4-arg call so they match the new 6-arg signature (defaults flow through to `"strict"` / `"error"`). Test reason + Sprint 333 date headers preserved.
- `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`: NEW — 6 RTL cases covering AC-352-03 (4) + AC-352-04 (2).

## Assumptions

- The whitelist enforcement order is: (1) `validate_level` → (2) `validate_action` → (3) connection lookup → (4) adapter dispatch. Both validators run before any lock is acquired so a malformed payload short-circuits without touching the connection pool. The error messages embed the full whitelist (`off|strict|moderate`, `error|warn`) so the surfaced toast tells the user exactly which values are valid.
- The "action disabled when level is off" copy is `Action has no effect when level is off` (Generator's discretion per contract). The hint renders as a sibling `<span data-testid="validator-action-disabled-hint">` rather than inside the disabled `<select>` so screen readers announce it independently.
- `null` on the TS wire maps to Rust `None` for `validation_level` / `validation_action`. The backend then omits the field from the `collMod` doc entirely (not `null`) because MongoDB rejects null values for these options. This is what preserves the byte-equivalent wire format for legacy callers (validator-only payload).
- `MongoValidatorRead.validator` typed as `Record<string, unknown> | null`. The pre-Sprint-352 backend serialised the validator JSON via canonical EJSON; the new struct uses the same `serde_json::Value` type through the `validator` field, so the wire shape is unchanged.
- The Sprint 333 test file's two assertion updates (4-arg → 6-arg `setMongoValidator` calls with `"strict"` / `"error"` defaults) are the minimal change consistent with "existing tests must keep passing while the wire shape evolves". The contract's `Out of Scope` does not list this file, and the alternative (split into a separate sprint352 file) would still require either (a) extending the original file or (b) duplicating four lines of test setup. Extending the original file is cheaper and preserves the WHY (Sprint 333 dispatch contract still holds).
- The third integration test, `test_mongo_adapter_set_validator_rejects_unknown_level`, exercises the **server-side** rejection path (driver returns `AppError::Database` for a bogus level). The Tauri-layer whitelist (which returns `AppError::Validation`) is covered by the matching `cargo --lib` test `set_mongo_validator_rejects_unknown_level_with_validation_error`. This split is necessary because the `_inner` function is mod-private and cannot be called from the integration-test crate scope — but the two together prove the contract (whitelist at Tauri layer, defence-in-depth at MongoDB).

## Residual Risk

- Manual browser smoke (`pnpm tauri dev` → open a Mongo collection → Structure → Validator → toggle level/action + Save) was not run in this autonomous pass. The next live-Mongo developer pass should verify the visual transitions and confirm that the action-disabled hint reads correctly when paired with the screen reader announcing the select's disabled state.
- The four pre-existing vitest failures (`src/themes.test.ts` x2, `src/lib/editor/autocompleteTheme.test.ts` x2) belong to the user's parallel branch and are explicitly out of scope per the Sprint 352 contract. No code in those files was touched. Net new failures from Sprint 352: 0.
- The Sprint 333 test file's 4-arg → 6-arg assertion update (`ValidatorPanel.test.tsx` lines around the Save and Clear cases) is functionally equivalent to the pre-Sprint-352 contract — the panel still sends the same validator payload, just with the level/action defaults bolted on at the end. If the Evaluator interprets "existing tests stay unmodified" strictly, the alternative is to add a wrapper test in `ValidatorPanel.sprint352.test.tsx` that imitates the same Save / Clear scenarios with the new signature, then delete the two Sprint 333 cases. That trade-off was deliberately avoided so the Sprint 333 file continues to read as a complete record of the v0 contract.
- `MongoValidatorRead`'s `validator` field is typed `Record<string, unknown> | null`. Like the pre-sprint shape, that does not constrain the validator expression's keys / nesting — a malformed expression flows through to the driver and surfaces as `AppError::Database` on the next Save. The contract documents this as MongoDB-passthrough behaviour; no additional client-side validation was added.

## Next Sprint Candidates

- Sprint 353 — Validator JSON Schema builder (GUI). The Sprint 352 raw textarea now flows beside the toggles; a future sprint could replace the textarea with a typed schema builder while keeping the level/action selects intact.
- Sprint 354 — Mongo `bypassDocumentValidation` ToggleAction for the bulk-write toolbar (lets the user bypass moderate-rule rejection per individual operation).

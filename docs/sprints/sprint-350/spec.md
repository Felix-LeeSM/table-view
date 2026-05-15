# Feature Spec: Mongo Structure sub-tab — Indexes & Validator

## Description

Mongo collection tabs currently bypass the Records/Structure sub-tab bar that RDB tabs already use, so users cannot inspect or manage collection-level metadata from the same surface they edit data on. This feature adds a paradigm-correct Structure pane to the Mongo collection tab, hosting two sub-sub-tabs — **Indexes** (full create/drop with the complete MongoDB option set) and **Validator** (raw `$jsonSchema` editor plus `validationLevel`/`validationAction` toggles). Inferred Fields stay out of Structure; the DataGrid's column headers already surface them.

## Sprint Breakdown

### Sprint 350 — Tracer: Records/Structure shell + RO Indexes + Validator mount
**Goal**: Mongo collection tabs render the same Records/Structure tab bar RDB tabs use; Structure exposes Indexes (read-only list via existing `list_mongo_indexes` IPC) and Validator (existing `ValidatorPanel` mounted verbatim). Frontend-only — zero backend changes.
**Verification Profile**: mixed (browser + vitest)
**Acceptance Criteria**:
1. Opening a Mongo collection tab paints a sub-tab bar with `role="tablist"` containing exactly two tabs labeled `Records` and `Structure`, with `Records` selected on first mount. Observable via DOM testid `mongo-table-subtab-bar` and `role="tab"` queries; RTL test mounts `MainArea` with a stub `paradigm: "document"` tab.
2. Activating Structure replaces the Records grid with a panel that contains a nested tab bar (testid `mongo-structure-subsubtab-bar`) with two tabs `Indexes` and `Validator`, defaulting to `Indexes`. Switching between Indexes and Validator preserves each tab's state (scroll, editor contents) when the user toggles back via mouse or `ArrowLeft`/`ArrowRight`.
3. Indexes panel issues exactly one `list_mongo_indexes` IPC on first mount for that `(connectionId, database, collection)` triplet and renders one row per returned `IndexInfo`. Empty list paints the empty-state copy ("No indexes"); IPC error paints an `role="alert"` region carrying the error message; loading paints a delayed `aria-busy` spinner that follows the same `useDelayedFlag(loading, 1000)` shape RDB structure uses.
4. Validator sub-sub-tab mounts the existing `ValidatorPanel` (testid `validator-panel`) with no behavioral change versus its current Mongo-paradigm placement. The read on entry, the Save / Clear flow, and the Save error rendering are byte-equivalent to the pre-Sprint-350 surface.
5. RDB tabs are untouched: a Postgres / MySQL / SQLite table tab still paints the existing `Records / Structure` sub-tab bar; Structure still shows the Columns / Indexes / Constraints / Triggers layout. Regression guard: an RTL test that renders both an RDB tab and a Mongo tab in the same describe block asserts each surface's testids are mutually exclusive.

**Components to Create/Modify**:
- `src/components/layout/MainArea.tsx`: `case "document"` branch swapped from "render DocumentDataGrid directly" to "render a Records/Structure tab bar; Records mounts DocumentDataGrid; Structure mounts the new Mongo Structure panel". The new tab bar shares accessibility shape with the RDB tab bar (role=tablist, ArrowLeft/Right keyboard handlers, `aria-selected`).
- `src/components/document/MongoStructurePanel.tsx` (new): top-level Mongo Structure panel; owns the Indexes / Validator sub-sub-tab state; mounts `MongoIndexesPanel` and `ValidatorPanel`.
- `src/components/document/MongoIndexesPanel.tsx` (new): read-only Indexes list using the existing `list_mongo_indexes` binding. Loading / error / empty states match the project's existing structure-panel conventions.
- `src/components/document/ValidatorPanel.tsx`: no behavior change; only its mount location moves.
- `src/stores/workspaceStore.ts`: ensure document tabs can persist their Records/Structure `subView` selection across tab activations (RDB already persists `subView`; verify the document branch reads it). Indexes/Validator selection lives in component state for this sprint.
- `src/components/document/__tests__/MongoStructurePanel.test.tsx` (new): covers AC-350-01..04 (tab bar shape, default selection, IPC invocation, state preservation, RDB regression).

**UI States**:
- **Loading**: Indexes spinner; gated by the same 1s delay used by RDB Structure so sub-second fetches never flash.
- **Empty**: Indexes shows "No indexes"; Validator shows the existing empty-editor placeholder.
- **Error**: `role="alert"` banner above the Indexes list with the IPC error string; Validator preserves the existing inline error pattern.
- **Success**: Indexes table with one row per index (name, fields summary, type label, `unique`/`primary` flags); Validator renders the existing read-write JSON editor.

### Sprint 351 — Index CRUD with full options
**Goal**: User can create a Mongo index with the full option set (unique, sparse, TTL, partialFilterExpression, collation) and drop an existing index, all from the Indexes panel. Backend gets a Mongo-paradigm `create_collection_index` / `drop_collection_index` pair on the `DocumentAdapter` trait; failures surface inline without crashing the panel.
**Verification Profile**: mixed (cargo test + vitest + browser)
**Acceptance Criteria**:
1. `DocumentAdapter` declares `create_collection_index` and `drop_collection_index` (names paradigm-distinct from the RDB `create_index` so the trait signatures do not collide). The Mongo implementation calls the driver's `Collection::create_index` / `drop_index` and surfaces driver errors as `AppError::Database(<msg>)` verbatim. `mongo_integration.rs` gains tests `test_mongo_adapter_create_index_unique_roundtrip`, `test_mongo_adapter_create_index_ttl_single_field`, `test_mongo_adapter_create_index_partial_filter`, `test_mongo_adapter_drop_existing_index`, `test_mongo_adapter_drop_id_index_rejected`, `test_mongo_adapter_create_index_duplicate_name_errors` — each verified by `cargo test -p table-view-lib --test mongo_integration`. Same skip-when-no-container shape as existing tests.
2. Two new Tauri commands `create_mongo_index` and `drop_mongo_index` are registered in `lib.rs` `invoke_handler` and dispatch through `as_document()`. Wire shape: input carries `connectionId`, `database`, `collection`, plus a typed `CreateMongoIndexRequest` covering `name?`, `fields: { name, direction: "asc"|"desc" }[]` (compound), `unique?`, `sparse?`, `expireAfterSeconds?` (rejected at the Tauri layer when `fields.length > 1`), `partialFilterExpression?: object`, `collation?: { locale, strength? }`. Output: `{ name: string }` — the canonical index name MongoDB returned. `drop_mongo_index` takes `{ connectionId, database, collection, name }`.
3. Indexes panel grows a `+ Index` button (testid `mongo-indexes-create`) that opens a modal (testid `mongo-create-index-dialog`) exposing every field above. The modal validates `partialFilterExpression` as JSON before submit; an invalid value paints an inline error and disables Save. Successful Save closes the modal, re-runs `list_mongo_indexes`, and surfaces a toast carrying the server-returned index name.
4. Each non-`_id_` index row carries a trash button (testid `mongo-index-drop-{name}`) that opens a typing-confirm dialog mirroring the RDB drop-index UX. Confirming calls `drop_mongo_index`. Dropping the `_id_` index is blocked at the UI (button disabled with a tooltip) AND at the Tauri layer (returns `AppError::Validation` so the contract holds even when callers bypass the UI).
5. Error rendering: a `unique`-constraint violation on Save (driver returns `E11000` or `IndexOptionsConflict`) paints the modal's inline alert with the driver message and keeps the modal open with user input preserved. A malformed `partialFilterExpression` is caught client-side before invoke. A drop-of-nonexistent-index error is surfaced verbatim in a panel-level alert; the panel does not unmount.

**Components to Create/Modify**:
- `src-tauri/src/db/traits.rs`: extend `DocumentAdapter` with `create_collection_index` + `drop_collection_index` trait methods. Include request types (`CreateMongoIndexRequest`, `DropMongoIndexRequest`).
- `src-tauri/src/db/mongodb/schema.rs` (or `src-tauri/src/db/mongodb/indexes.rs` if cleaner): concrete impl translating the request into a `mongodb::IndexModel` + `CreateIndexOptions`.
- `src-tauri/src/db/mongodb.rs`: wire the new trait methods into `impl DocumentAdapter for MongoAdapter`.
- `src-tauri/src/commands/document/browse.rs`: add `create_mongo_index` / `drop_mongo_index` `_inner` + `#[tauri::command]` pair following the existing `list_mongo_indexes` pattern.
- `src-tauri/src/lib.rs`: register the two new commands in `invoke_handler`.
- `src-tauri/tests/mongo_integration.rs`: integration coverage (real `mongod` per the existing skip-when-absent pattern).
- `src/lib/tauri/document.ts`: new TS bindings `createMongoIndex`, `dropMongoIndex`.
- `src/components/document/MongoIndexesPanel.tsx`: extend with the `+ Index` and per-row drop affordances.
- `src/components/document/CreateMongoIndexDialog.tsx` (new): modal with the full option set; testid `mongo-create-index-dialog`.
- `src/components/document/DropMongoIndexDialog.tsx` (new): typing-confirm modal mirroring `DropTriggerDialog` shape.

**UI States**:
- **Loading**: Save button disabled with spinner during invoke.
- **Empty**: dialog opens with name input empty + a single empty field row pre-populated.
- **Error**: inline alert in the dialog for driver errors; modal stays open. Panel-level alert for drop errors.
- **Success**: dialog closes; toast "Index `<name>` created"; list re-renders.

### Sprint 352 — Validator level + action toggles
**Goal**: Validator pane surfaces `validationLevel` (`off` | `strict` | `moderate`) and `validationAction` (`error` | `warn`) controls in addition to the existing JSON editor; the IPC round-trips both fields without breaking existing callers.
**Verification Profile**: mixed (cargo test + vitest)
**Acceptance Criteria**:
1. `DocumentAdapter::set_collection_validator` signature extends to accept `validation_level: Option<String>` + `validation_action: Option<String>`; the Mongo impl includes them in the `collMod` document when `Some(value)`. `get_collection_validator` returns a richer payload `{ validator: Option<Value>, validationLevel: Option<String>, validationAction: Option<String> }`. Whitelists enforced at the Tauri layer (return `AppError::Validation` for any other value). Verified by `cargo test -p table-view-lib --test mongo_integration` cases `test_mongo_adapter_set_validator_with_level_and_action_roundtrip`, `test_mongo_adapter_set_validator_omitted_level_action_preserves_server_defaults`, `test_mongo_adapter_set_validator_rejects_unknown_level`.
2. `set_mongo_validator` IPC accepts the new fields as optional; omitting them is byte-equivalent to the pre-Sprint-352 wire (server applies MongoDB's defaults). `get_mongo_validator` IPC wire shape grows two optional fields; older frontend callers that only read `.validator` continue to work.
3. `ValidatorPanel` adds a `<select>` for level (testid `validator-level-select`) and one for action (testid `validator-action-select`), bound to the read result on mount; Save uses the current select values. RTL test `validator-panel.sprint352.test.tsx` covers (a) initial values reflect the read response; (b) editing without saving leaves the saved value untouched; (c) Save round-trip persists the selected values; (d) `level === "off"` disables the action select with an inline hint ("validationAction has no effect when validationLevel is off").
4. Backward-compat surface guard: an RTL test renders `ValidatorPanel` with a stub that returns the legacy `{ validator } | null` shape and asserts the panel does not crash and selects fall back to the server defaults (`moderate` / `error`).

**Components to Create/Modify**:
- `src-tauri/src/db/traits.rs`: extend `DocumentAdapter::set_collection_validator` + `get_collection_validator` signatures.
- `src-tauri/src/db/mongodb/schema.rs`: extend the `collMod` builder + the `listCollections.options` reader.
- `src-tauri/src/commands/document/browse.rs`: extend the `set_mongo_validator` / `get_mongo_validator` `_inner` + commands; add whitelist validation.
- `src-tauri/tests/mongo_integration.rs`: new test cases above.
- `src/lib/tauri/document.ts`: extend `getMongoValidator` / `setMongoValidator` TS types.
- `src/components/document/ValidatorPanel.tsx`: add level / action selects and the "off disables action" gate.
- `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx` (new): covers AC-352-03 + AC-352-04.

**UI States**:
- **Loading**: selects disabled while the read is in flight.
- **Empty**: validator JSON empty + selects default to server defaults; Save still emits an explicit value when the user changes either select before adding JSON.
- **Error**: per-select error if the server rejects the value (post-save read returns a different shape).
- **Success**: selects reflect persisted values after Save.

## Global Acceptance Criteria
1. No regression to the RDB tab Records/Structure surface: existing `StructurePanel` tests continue to pass unmodified.
2. Every new TS test carries a top-of-file or top-of-`describe` Reason + date comment per `feedback_test_documentation.md`.
3. Every new Rust integration test mirrors the existing `mongo_integration.rs` skip-when-no-container shape (no testcontainers-only assertion paths).
4. Sprint-prefix narrative is stripped from production comments per `feedback_sprint_comment_cleanup.md`; only load-bearing WHY annotations survive.
5. `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm lint`, `pnpm vitest run`, and the focused vitest suites for changed files all pass on each sprint's branch tip.

## Data Flow

UI (panel button) → `@/lib/tauri/document.ts` typed binding → Tauri IPC (`#[tauri::command]` in `commands/document/browse.rs`) → `ActiveAdapter::as_document()?` paradigm gate → `DocumentAdapter` trait method (`list_collection_indexes` / `create_collection_index` / `drop_collection_index` / `get_collection_validator` / `set_collection_validator`) → `MongoAdapter` inherent impl → `mongodb::Client` driver call (`Collection::list_indexes`, `Collection::create_index`, `Collection::drop_index`, `Database::run_command({collMod, ...})`, `Database::list_collections({filter})`).

Sub-tab state lives in:
- Records/Structure selection: `workspaceStore.setSubView`, persisted (same path as RDB tabs).
- Indexes/Validator selection: component-local state in `MongoStructurePanel`. Not persisted across app restarts in this feature.

## Edge Cases
- **Index name collision**: server returns `IndexOptionsConflict`; dialog stays open with the inline error and the user's input preserved.
- **Malformed `partialFilterExpression` JSON**: caught client-side before invoke; modal Save stays disabled until the JSON parses cleanly.
- **TTL on a non-date field**: server-side error (`expireAfterSeconds` requires a date-typed field); driver error surfaces verbatim in the dialog alert. UI accepts the input — backend is the validator.
- **TTL on a compound index**: rejected at the Tauri layer with `AppError::Validation("expireAfterSeconds requires a single-field index")`. UI disables the TTL field when more than one field row is present.
- **Validator JSON parse failure on Save**: existing `ValidatorPanel` error path remains; no change.
- **`validationLevel = off` semantics**: backend still accepts the value; UI disables the action select and renders a hint that the action is moot when the level is off.
- **Dropping a non-existent index**: surfaces the driver's `IndexNotFound` error in a panel-level alert; the panel does not unmount.
- **Dropping `_id_`**: blocked at the UI (trash button disabled with tooltip) AND at the Tauri layer (`AppError::Validation`). MongoDB enforces this server-side as well, but we surface a friendly error before the driver round-trip.
- **Mongo connection error mid-read**: existing `useDelayedFlag` + `role="alert"` shape from RDB structure carries the IPC error string; user can retry via Cmd+R / F5 (existing `refresh-structure` event listener pattern).
- **RDB-tab regression guard**: RTL regression test renders one RDB tab and one Mongo tab; asserts the RDB tab still mounts the existing `StructurePanel` (columns/indexes/constraints/triggers) and the Mongo tab mounts the new `MongoStructurePanel` (indexes/validator). Testid mutual exclusion enforced.

## Out of Scope
- Options panel for collection-level `capped` / `timeseries` / `clusteredIndex` / `expireAfterSeconds` (collection TTL).
- GUI Schema builder for `$jsonSchema` (raw JSON editor stays the only authoring surface).
- TTL UI for compound indexes (single-field only).
- Mongo advanced flags: `hidden`, `storageEngine`, `weights`, `textIndexVersion`, `2dsphereIndexVersion`, `bucketSize`, `wildcardProjection`.
- Cross-database validator copy / paste.
- Persisting the Indexes/Validator sub-sub-tab selection across app restarts.
- Mock-driven Rust tests for the Mongo adapter (project convention requires real `mongod` via the existing integration harness).

## Verification Hints
- Sprint 350: `pnpm vitest run src/components/document/__tests__/MongoStructurePanel.test.tsx`; manual: open a Mongo collection tab and toggle Records ↔ Structure ↔ Indexes ↔ Validator.
- Sprint 351: `cd src-tauri && cargo test --test mongo_integration -- --nocapture mongo_adapter_create_index_unique_roundtrip` (and siblings); manual: create a TTL index on a single date field, then drop it.
- Sprint 352: `cd src-tauri && cargo test --test mongo_integration -- --nocapture mongo_adapter_set_validator_with_level_and_action_roundtrip`; manual: toggle level=off and verify the action select disables with the inline hint.
- Cross-sprint: `pnpm lint && pnpm vitest run && cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`.

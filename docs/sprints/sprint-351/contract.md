# Sprint Contract: sprint-351

## Summary

- Goal: Mongo index CRUD with the full MongoDB option set. Add Rust adapter methods + Tauri commands + IndexesPanel UI (Create dialog with unique / sparse / TTL / partialFilterExpression / collation; per-row Drop confirm dialog).
- Audience: Mongo users who want to manage indexes from the Structure tab without leaving the desktop app.
- Owner: Generator (sprint-351)
- Verification Profile: `mixed` (cargo test + cargo clippy + vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/db/traits.rs`: extend `DocumentAdapter` with `create_collection_index` + `drop_collection_index`. Introduce request types (`CreateMongoIndexRequest`, `DropMongoIndexRequest`, plus the inner field/collation types).
- `src-tauri/src/db/mongodb.rs` (and/or a new `src-tauri/src/db/mongodb/indexes.rs` submodule): concrete Mongo impl translating the request into `mongodb::IndexModel` + `CreateIndexOptions`. Driver errors map to `AppError::Database(<msg>)`.
- `src-tauri/src/commands/document/browse.rs`: add `create_mongo_index` / `drop_mongo_index` `_inner` + `#[tauri::command]` pair following the existing `list_mongo_indexes` pattern. Enforce server-side input validation: reject `expireAfterSeconds` on a compound index (`AppError::Validation`); reject `drop` on `_id_` (`AppError::Validation`).
- `src-tauri/src/lib.rs`: register the two new commands in `invoke_handler`.
- `src-tauri/tests/mongo_integration.rs`: add the six integration tests named in `spec.md` AC-351-01 (skip-when-no-container pattern preserved).
- `src/lib/tauri/document.ts`: new TS bindings `createMongoIndex(connectionId, database, collection, request)` and `dropMongoIndex(connectionId, database, collection, name)`.
- `src/components/document/MongoIndexesPanel.tsx`: add the `+ Index` button (testid `mongo-indexes-create`) and per-row trash button (testid `mongo-index-drop-{name}`). Wire success / failure surfaces.
- `src/components/document/CreateMongoIndexDialog.tsx` (new): modal with the full option set (testid `mongo-create-index-dialog`).
- `src/components/document/DropMongoIndexDialog.tsx` (new): typing-confirm modal mirroring the existing RDB drop-index UX.
- Vitest coverage for the two new dialogs + the extended `MongoIndexesPanel` interactions.

## Out of Scope

- Validator level/action toggles (Sprint 352).
- Mongo advanced index flags: `hidden`, `storageEngine`, `weights`, `textIndexVersion`, `2dsphereIndexVersion`, `bucketSize`, `wildcardProjection`.
- Index editing (the user must drop + recreate; MongoDB does not support in-place index option changes).
- Persisting Create-dialog input across remounts.
- Browser smoke (manual; optional).

## Invariants

- `list_mongo_indexes` IPC signature unchanged (its TS binding may grow a typed return shape but the parameters stay the same).
- `MongoStructurePanel` body changes only in places that wire through new callbacks; the sub-sub-tab keyboard / focus behavior from Sprint 350 stays intact.
- `ValidatorPanel.tsx` body not edited.
- `DocumentDataGrid.tsx` body not edited.
- `MainArea.tsx` document branch byte-identical to its sprint-350 shape (no new wiring needed).
- Existing Mongo integration tests pass unchanged.
- `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` all green.

## Acceptance Criteria

- `AC-351-01` `DocumentAdapter` trait gains `create_collection_index(db, collection, req: CreateMongoIndexRequest) -> Result<{ name: String }>` and `drop_collection_index(db, collection, name) -> Result<()>`. Mongo impl translates requests into `IndexModel` + `CreateIndexOptions` and forwards driver errors as `AppError::Database(msg)`. `mongo_integration.rs` includes the following tests, each green when the mongo container is reachable and a skip-print when not:
  - `test_mongo_adapter_create_index_unique_roundtrip`
  - `test_mongo_adapter_create_index_ttl_single_field`
  - `test_mongo_adapter_create_index_partial_filter`
  - `test_mongo_adapter_create_index_compound_with_collation`
  - `test_mongo_adapter_drop_existing_index`
  - `test_mongo_adapter_drop_id_index_rejected`
  - `test_mongo_adapter_create_index_duplicate_name_errors`
  - `test_mongo_adapter_create_index_ttl_on_compound_rejected`
- `AC-351-02` Two new Tauri commands `create_mongo_index` and `drop_mongo_index` are registered in `lib.rs` `invoke_handler`. They dispatch through `as_document()`. The `create` command accepts `{ connectionId, database, collection, request: CreateMongoIndexRequest }`; `drop` accepts `{ connectionId, database, collection, name }`. Both validate at the Tauri layer:
  - `expireAfterSeconds` requires exactly one field — otherwise `AppError::Validation("expireAfterSeconds requires a single-field index")`.
  - `name == "_id_"` on drop returns `AppError::Validation("The _id_ index cannot be dropped")`.
  - At least one field required for create — otherwise `AppError::Validation("create_index requires at least one field")`.
- `AC-351-03` `MongoIndexesPanel` adds:
  - A toolbar `+ Index` button (testid `mongo-indexes-create`) that opens the `CreateMongoIndexDialog` (testid `mongo-create-index-dialog`).
  - A trash button on each non-`_id_` row (testid `mongo-index-drop-{name}`) that opens `DropMongoIndexDialog`. The `_id_` row's trash button is rendered but disabled with `aria-disabled="true"` and a tooltip explaining why.
  - On success of create or drop the panel re-runs `list_mongo_indexes` once and surfaces a toast carrying the affected index name.
- `AC-351-04` `CreateMongoIndexDialog` exposes:
  - Index name input (optional; placeholder hints "auto" when blank).
  - A repeatable field row list (add / remove buttons) — each row a field-name input plus an asc/desc select. Empty fields are rejected by the client before invoke.
  - `unique` toggle, `sparse` toggle.
  - `expireAfterSeconds` numeric input — disabled and clearly marked when more than one field row is present (per AC-351-02 invariant).
  - `partialFilterExpression` raw JSON textarea — client-side JSON.parse before invoke; invalid JSON paints inline error and disables Save.
  - `collation` group — locale input + strength `<select>` (1..5). If locale is blank the collation block is omitted from the IPC payload.
  - Save button: disabled while invoke is in flight; on success closes the dialog and toasts the server-returned index name. On driver error keeps the dialog open with the user's input intact and renders the error inline in `role="alert"`.
- `AC-351-05` `DropMongoIndexDialog` is a typing-confirm modal: the user must type the exact index name to enable the Confirm button. On confirm calls `dropMongoIndex` and closes on success; on error surfaces the driver error inline and keeps the dialog open.
- `AC-351-06` `MongoIndexesPanel.test.tsx` (extended) and the two new dialog test files exercise:
  - Create happy path (`createMongoIndex` mocked) → toast + list refresh.
  - Drop happy path (`dropMongoIndex` mocked) → toast + list refresh.
  - `_id_` drop button is `aria-disabled="true"`.
  - Driver error on create paints `role="alert"` inside the dialog and keeps the dialog open.
  - Driver error on drop paints `role="alert"` inside the panel and keeps the panel mounted.
  - `expireAfterSeconds` field disabled when ≥ 2 field rows are present.
  - `partialFilterExpression` invalid JSON disables Save with inline error.
  - At least one field row required to enable Save.

## Design Bar / Quality Bar

- Accessibility: dialogs use `role="dialog"` + `aria-modal="true"` + focus trap (use the project's existing dialog primitives — search for `Dialog`/`Sheet`/`AlertDialog` shadcn shells already in use).
- Test docs: every new test file carries a top-of-file date (2026-05-15) + reason comment.
- Production comments: no sprint-prefix narrative ("Sprint 351 — …"). Only load-bearing WHY.
- Named exports for new components; props interface named `<Component>Props`.
- Rust: `cargo fmt` + `cargo clippy --all-targets --all-features -- -D warnings` clean.

## Verification Plan

### Required Checks

1. `cargo fmt --check` → exit 0.
2. `cargo clippy --all-targets --all-features -- -D warnings` → exit 0.
3. `cargo test -p table-view-lib --lib` → all unit tests pass.
4. `cargo test -p table-view-lib --test mongo_integration` → all named tests pass IF container reachable; otherwise the skip-message path is taken and exit code is 0. If the Mongo container is NOT reachable in the Generator's environment, the Generator must explicitly document this (so the human / CI operator can verify on a machine with the container).
5. `pnpm tsc --noEmit` → exit 0.
6. `pnpm lint` → exit 0.
7. `pnpm vitest run src/components/document/__tests__/MongoIndexesPanel.test.tsx src/components/document/__tests__/CreateMongoIndexDialog.test.tsx src/components/document/__tests__/DropMongoIndexDialog.test.tsx` → all green.
8. `pnpm vitest run` (full) → net new failures = 0 vs baseline (the 4 pre-existing failures in `themes.test.ts` + `autocompleteTheme.test.ts` stay flat).

### Required Evidence

- Generator must provide:
  - File-by-file diff summary with rationale.
  - Output of every required check.
  - For each AC, the testid / test name / cargo test name that proves it.
  - Explicit note on whether the Mongo container was reachable in the Generator's environment; if not, the Generator must still verify that integration tests compile and that the skip path is taken.
- Evaluator must cite:
  - Concrete RTL assertion paths for each frontend AC.
  - Cargo test names for each backend AC.
  - Confirmation that the trait method signatures match the spec.
  - Confirmation that the Tauri command Validation gates fire before reaching the adapter.

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목 (351-01..351-06) 대응 테스트 ≥ 1개.
- Driver error case ≥ 1개 per direction (create + drop).
- Boundary: TTL disabled on compound, empty field list rejected, `_id_` drop blocked.

### Coverage Target
- 새 컴포넌트 라인 70% 이상.
- 새 Rust adapter 경로 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: 단일 필드 unique 인덱스 생성 + 드롭.
- [ ] 복합 인덱스: 두 필드 + asc/desc.
- [ ] TTL 단일 필드 성공 + 복합 인덱스에서 거부.
- [ ] partialFilterExpression 잘못된 JSON → 클라이언트 차단.
- [ ] collation locale 있을 때만 IPC payload에 포함.
- [ ] `_id_` drop 차단 (UI 비활성 + 백엔드 거부).
- [ ] Driver duplicate-name error 시 dialog open 유지.
- [ ] Sprint 350 surfaces (sub-tab, MongoIndexesPanel RO list) 회귀 없음.

## Test Script / Repro Script

1. `cargo fmt && cargo clippy --all-targets --all-features -- -D warnings` (root or `src-tauri/`).
2. `cargo test -p table-view-lib --test mongo_integration -- --nocapture mongo_adapter_create_index`.
3. `cargo test -p table-view-lib --test mongo_integration -- --nocapture mongo_adapter_drop`.
4. `pnpm tsc --noEmit && pnpm lint`.
5. `pnpm vitest run src/components/document/__tests__/`.
6. `pnpm vitest run` (full).
7. (옵션) `pnpm tauri dev` → Mongo collection 열고 Structure → Indexes → `+ Index` → 옵션 입력 → 생성 → 드롭 확인.

## Ownership

- Generator: general-purpose Agent.
- Write scope: 위 In Scope 파일 + 새 컴포넌트/테스트만. Sprint 352 영역(Validator level/action) 절대 금지. RDB 영역 금지. MainArea.tsx 본문 금지 (불가피한 경우 review에 명시).
- Merge order: Sprint 351 다음 352.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (단, 환경 제약으로 integration test 미실행 케이스는 Generator가 명시 + Evaluator가 별도 트래킹)
- Acceptance criteria evidence linked in `handoff.md`

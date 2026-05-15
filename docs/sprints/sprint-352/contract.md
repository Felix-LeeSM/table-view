# Sprint Contract: sprint-352

## Summary

- Goal: Extend Mongo validator IPC pair with `validationLevel` + `validationAction`; surface them as `<select>` controls in `ValidatorPanel`; level=`off` disables the action select.
- Audience: Mongo users who need to apply `moderate` + `warn` semantics to existing collections (migration scenario).
- Owner: Generator (sprint-352)
- Verification Profile: `mixed` (cargo test + cargo clippy + vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/db/traits.rs`: extend `DocumentAdapter::set_collection_validator` to accept `validation_level: Option<String>` + `validation_action: Option<String>`. Extend `get_collection_validator` to return `{ validator: Option<Value>, validation_level: Option<String>, validation_action: Option<String> }`.
- `src-tauri/src/db/mongodb/schema.rs`: in the `collMod` builder, include `validationLevel` / `validationAction` only when `Some`. In the `listCollections.options` reader, surface those two fields from the server response.
- `src-tauri/src/commands/document/browse.rs`: extend `set_mongo_validator` / `get_mongo_validator` `_inner` + command shells. Whitelist validation at the Tauri layer — `validationLevel ∈ {"off","strict","moderate"}`, `validationAction ∈ {"error","warn"}`. Anything else returns `AppError::Validation`.
- `src-tauri/tests/mongo_integration.rs`: new tests `test_mongo_adapter_set_validator_with_level_and_action_roundtrip`, `test_mongo_adapter_set_validator_omitted_level_action_preserves_server_defaults`, `test_mongo_adapter_set_validator_rejects_unknown_level`.
- `src/lib/tauri/document.ts`: extend `getMongoValidator` return type + `setMongoValidator` parameter type. Old callers that pass only `(connectionId, database, collection, validator)` must keep working (optional positional args or a separate overload — pick whichever is idiomatic).
- `src/components/document/ValidatorPanel.tsx`: add `<select>` for level (testid `validator-level-select`) and one for action (testid `validator-action-select`). Bind to the read response on mount. Save sends the current select values. When `level === "off"` disable the action select with an inline hint.
- `src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx` (new): cover the four behavioral cases listed in spec AC-352-03 plus the backward-compat fallback in AC-352-04.

## Out of Scope

- Index CRUD (Sprint 351 — already shipped).
- Validator GUI schema builder.
- Cross-database validator copy/paste.
- Other collection-level options (`capped`, `timeseries`, etc.).

## Invariants

- Old TS callers of `setMongoValidator(connectionId, database, collection, validator)` (no level/action) must continue to work — the IPC must remain backward-compatible when level/action are omitted.
- Existing `mongo_integration.rs` tests stay green and unmodified.
- Sprint-350 / sprint-351 surfaces (sub-tab, Indexes panel, dialogs) unmodified.
- `cargo fmt`, `cargo clippy --all-targets --all-features -- -D warnings`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm vitest run` all green.
- `MongoStructurePanel.tsx`, `MongoIndexesPanel.tsx`, `CreateMongoIndexDialog.tsx`, `DropMongoIndexDialog.tsx`, `DocumentDataGrid.tsx`, `MainArea.tsx` are NOT touched.

## Acceptance Criteria

- `AC-352-01` `DocumentAdapter::set_collection_validator` signature extends to accept `validation_level: Option<String>` + `validation_action: Option<String>`. Mongo impl includes them in the `collMod` document iff `Some(value)`. `get_collection_validator` returns the trio `(validator, validation_level, validation_action)` derived from `listCollections.options`. Three named integration tests pass live when the container is reachable; skip path preserved otherwise.
- `AC-352-02` `set_mongo_validator` / `get_mongo_validator` Tauri commands accept the new optional fields. Wire-level backward compat: payloads without the new keys behave byte-equivalent to pre-sprint behavior. Whitelist validation at the Tauri layer returns `AppError::Validation("validationLevel must be one of off|strict|moderate")` (and the action equivalent) for any unknown value before the adapter is invoked.
- `AC-352-03` `ValidatorPanel` renders:
  - `<select>` for level (testid `validator-level-select`) with options `off` / `strict` / `moderate`.
  - `<select>` for action (testid `validator-action-select`) with options `error` / `warn`.
  - Both bind their initial value to the read response on mount. When the server returns `null` for either (i.e. the server has never applied a custom value), the select reflects the MongoDB default (`strict` / `error`).
  - When the user changes either select, the Save button becomes enabled (current behavior was "Save enabled when textarea differs from original" — extend the dirty check to cover the selects).
  - When `level === "off"`, the action select is disabled with `aria-disabled="true"` and an inline hint reading something like "Action has no effect when level is off" (exact copy at Generator's discretion).
  - Save round-trip calls `setMongoValidator(connectionId, database, collection, parsedValidator, level, action)` and persists all three. After Save the `originalText` / select-original state syncs to the new values.
  - Save error remains in the existing `validator-panel-save-error` slot; new selects do not introduce a new error region.
- `AC-352-04` Backward-compat surface guard: a Vitest case renders `ValidatorPanel` with a stub `getMongoValidator` that returns the legacy shape `{ validator: <json> | null }` (no `validationLevel` / `validationAction` fields). The panel must not crash; selects must fall back to the MongoDB defaults (`strict` / `error`).

## Design Bar / Quality Bar

- Accessibility: each `<select>` has an accessible label (visible `<label>` or `aria-label`). Disabled state surfaces via `aria-disabled="true"` (not just `disabled` attribute, so screen readers announce it consistently with the rest of the project).
- Test docs: top-of-file date (2026-05-15) + reason comment per `feedback_test_documentation.md`.
- Production comments: no sprint-prefix narrative. Only load-bearing WHY (e.g. why "off disables action" matches MongoDB semantics).
- Named exports for new helpers; props interface name stays `ValidatorPanelProps`.
- Rust: `cargo fmt` + `cargo clippy --all-targets --all-features -- -D warnings` clean.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `cd src-tauri && cargo test -p table-view-lib --lib`
4. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration` (skip-on-no-container expected)
5. `pnpm tsc --noEmit`
6. `pnpm lint`
7. `pnpm vitest run src/components/document/ValidatorPanel.test.tsx src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`
8. `pnpm vitest run` (full) — net new failures = 0 vs baseline (4 pre-existing in themes/autocompleteTheme stay flat).

### Required Evidence

- Generator must provide:
  - Trait + adapter + command diffs.
  - The TS binding's new signature shape (overload vs optional positional).
  - Output of every required check.
  - For each AC, the testid / test name / cargo test name proving it.
  - Container reachability note.
- Evaluator must cite:
  - Concrete RTL assertion paths for each frontend AC.
  - Cargo test names for each backend AC.
  - Confirmation that the IPC wire format is backward-compatible (e.g. by inspecting the Rust `#[derive(Deserialize)]` shape: new fields are `Option<String>` with `#[serde(default)]`).

## Test Requirements

### Unit Tests (필수)
- 각 AC 항목 (352-01..352-04) 대응 테스트 ≥ 1개.
- 화이트리스트 거부 케이스 ≥ 1개.
- 백워드-컴팻 케이스 (legacy `{ validator }` 응답) 1개.

### Coverage Target
- `ValidatorPanel.tsx` 라인 70% 이상 유지 (기존 커버리지 회귀 없음).

### Scenario Tests (필수)
- [ ] Happy path: level=moderate + action=warn 저장 + 재로드.
- [ ] Backward-compat: legacy 응답일 때 selects default로 회귀.
- [ ] level=off → action 비활성 + hint 표시.
- [ ] 화이트리스트 위반 → Tauri Validation 에러.
- [ ] Sprint-350 + Sprint-351 surfaces (Indexes 패널, 다이얼로그, sub-tab) 회귀 없음.

## Test Script / Repro Script

1. `cd src-tauri && cargo fmt && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration -- --nocapture mongo_adapter_set_validator_with_level_and_action_roundtrip`
3. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration -- --nocapture mongo_adapter_set_validator_omitted_level_action_preserves_server_defaults`
4. `cd src-tauri && cargo test -p table-view-lib --test mongo_integration -- --nocapture mongo_adapter_set_validator_rejects_unknown_level`
5. `pnpm tsc --noEmit && pnpm lint`
6. `pnpm vitest run src/components/document/ValidatorPanel.test.tsx src/components/document/__tests__/ValidatorPanel.sprint352.test.tsx`
7. `pnpm vitest run` (full)

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 파일만. Sprint 350 / 351 surfaces 절대 금지.
- Merge order: Sprint 352 (final).

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`

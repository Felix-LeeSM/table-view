## Sprint 140 Evaluator Scorecard

### Verdict: PASS

### Dimension scores
- Correctness: 9/10
- Completeness: 9/10
- Reliability: 9/10
- Verification Quality: 10/10

### Per-AC evidence

- **AC-S140-01** (Argon2id+AES-GCM round-trip + wrong pw + tamper): PASS
  - `crypto::tests::aead_envelope_password_round_trip` — happy round-trip
  - `crypto::tests::aead_envelope_decrypt_with_same_password_is_deterministic` — deterministic decrypt
  - `crypto::tests::aead_envelope_unicode_payload_round_trip` — unicode payload
  - `crypto::tests::aead_envelope_wrong_password_rejected` — wrong-pw → canonical message
  - `crypto::tests::aead_envelope_tampered_ciphertext_rejected`
  - `crypto::tests::aead_envelope_tampered_nonce_rejected`
  - `crypto::tests::aead_envelope_tampered_salt_rejected`
  - All four tamper paths and the wrong-password path assert `msg == INCORRECT_MASTER_PASSWORD_MESSAGE` — confirmed no oracle leak between them.
  - `crypto::aead_decrypt_with_password` collapses every base64/length/auth-tag/UTF-8 failure into the same constant message (verified by reading lines 230-266 of crypto.rs).

- **AC-S140-02** (`import_connections_encrypted`): PASS
  - `commands::connection::tests::test_export_connections_encrypted_round_trip` — full envelope round-trip via the command surface (export → wipe storage → import → 2 imported)
  - `commands::connection::tests::test_import_connections_encrypted_wrong_password_rejected` — asserts `AppError::Encryption(INCORRECT_MASTER_PASSWORD_MESSAGE)` exactly
  - `commands::connection::tests::test_import_connections_encrypted_preserves_schema_version`
  - `commands::connection::tests::test_import_connections_encrypted_invalid_envelope_json` — base64-garbage envelope → canonical message
  - Command falls back to plain JSON when payload lacks `kdf` and `ciphertext` keys (lines 540-552 in connection.rs).

- **AC-S140-03** (master password field min 8): PASS
  - Component (`MasterPasswordField.tsx`):
    - Inline error rendered exactly when `value.length > 0 && value.length < minLength`.
    - `aria-invalid="true"` flagged below minLength.
    - Custom `minLength` prop respected.
    - Empty value yields no error (so caller decides "required").
  - Tests:
    - `MasterPasswordField.test.tsx › shows inline error when length is below minLength (default 8)`
    - `› hides inline error when value reaches minLength`
    - `› does not show inline error for empty input`
    - `› respects custom minLength override`
    - `› flags input as aria-invalid when below minLength`
  - Backend command also enforces `MASTER_PASSWORD_MIN_LEN = 8`:
    - `test_export_connections_encrypted_rejects_short_password` (3-char pw)
    - `test_export_connections_encrypted_rejects_empty_password`
  - Validation runs **before** the KDF call (line 511 of connection.rs), confirmed.

- **AC-S140-04** (selection tree 6 scenarios): PASS — all 6 contract scenarios verified
  - all-selected → `scenario all-selected: master checkbox checks every connection`
  - single group only → `scenario single-group: group header selects only its children`
  - single conn only → `scenario single-conn: leaf checkbox toggles a single connection`
  - multi conn (cross-group) → `scenario multi-conn: selecting connections from two groups indeterminates both groups`
  - multi-group → `scenario multi-group: every child of two groups selected → both groups checked, master checked`
  - partial group → indeterminate → `scenario partial-group: some children selected → group is indeterminate`
  - Plus: `renders empty state`, `renders an ungrouped (No group) pseudo-group`, `unchecks all when master is clicked from indeterminate` (master-from-indeterminate).
  - All tests assert `(checkbox as HTMLInputElement).indeterminate` directly via `getCheckbox().indeterminate` (typed as `HTMLInputElement` in the helper at line 47), satisfying the "actually inspects `input.indeterminate`" requirement.
  - `aria-checked="mixed"` is also set on indeterminate state (lines 126-128, 199-205 in SelectionTree.tsx) — both the DOM property and the ARIA value are present.

- **AC-S140-05** (envelope JSON shape): PASS
  - `crypto::tests::aead_envelope_serializes_to_locked_schema` checks `v:1`, `kdf:"argon2id"`, `alg:"aes-256-gcm"`, `tag_attached:true`, plus presence of `salt`, `nonce`, `ciphertext` — all 7 locked fields verified.
  - `commands::connection::tests::test_export_connections_encrypted_round_trip` additionally re-asserts the same locked fields on the live command output (`"v": 1`, `"kdf": "argon2id"`, `"alg": "aes-256-gcm"`, `"tag_attached": true`).
  - `EncryptedEnvelope` struct (lines 39-55 of crypto.rs) declares all 7 locked fields plus `m_cost`/`t_cost`/`p_cost` as additional fields — permitted by the contract's "additional fields" clause for forward-compatible KDF tuning.
  - The plain-JSON `export_connections` command remains a separate path (line 442-491 of connection.rs); confirmed unchanged.

- **AC-S140-06** (canonical wrong-password error): PASS
  - Backend constant `INCORRECT_MASTER_PASSWORD_MESSAGE = "Incorrect master password — the file could not be decrypted"` (crypto.rs line 30-31).
  - All five rejection paths (wrong pw, tampered ciphertext, tampered nonce, tampered salt, base64 garbage in invalid envelope) emit the exact same string — verified by re-reading `aead_decrypt_with_password` and the four tamper tests.
  - UI test `ImportExportDialog.test.tsx › wrong password surfaces the canonical 'Incorrect master password' inline error` mocks the rejection with the variant-prefixed string `"Encryption error: Incorrect master password — …"` and asserts the dialog displays the canonical message via `extractErrorMessage` (lines 400-409 of ImportExportDialog.tsx, which strips the `Encryption error:` prefix when it matches the canonical sentinel).

- **AC-S140-07** (plain JSON regression): PASS
  - Backend: `test_import_connections_encrypted_plain_json_pass_through` — valid `ExportPayload` JSON imports successfully through the new command with empty password (envelope detection fails → routes to `import_connections`).
  - Pre-existing tests still green: `test_import_round_trip`, `test_import_connections_regenerates_uuids`, `test_import_connections_auto_renames_on_name_collision`, `test_import_connections_drops_unknown_group_reference`, `test_import_connections_creates_new_groups_when_absent`, `test_import_connections_rejects_invalid_schema_version`, `test_export_connections_omits_password_field`, `test_export_connections_includes_referenced_groups` — all in the 287-passed suite.
  - UI: `ImportExportDialog.test.tsx › plain JSON path (regression): non-envelope payload routes to importConnections without password` — confirms `importConnections` is called and `importConnectionsEncrypted` is NOT called when payload lacks envelope shape.
  - `crypto::encrypt` / `crypto::decrypt` signatures and bodies (lines 98-132 of crypto.rs) verified untouched. `export_connections` / `import_connections` commands likewise unchanged.

- **AC-S140-08** (7 gates green): PASS — all gates re-run by evaluator
  - `pnpm vitest run` → `Test Files 139 passed (139) | Tests 2144 passed (2144)`
  - `pnpm tsc --noEmit` → empty output (clean)
  - `pnpm lint` → empty output (clean)
  - `pnpm contrast:check` → `WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib` → `test result: ok. 287 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` → `Finished 'dev' profile [unoptimized + debuginfo] target(s)` (no warnings)
  - `pnpm exec eslint e2e/**/*.ts` → empty output (clean)

### Independent inspection notes

- **`EncryptedEnvelope` shape** — `v=1`, `kdf="argon2id"` constant, `alg="aes-256-gcm"` constant, `tag_attached=true` constant: all enforced by literal string assignment in `aead_encrypt_with_password` (lines 188-199). Decrypt rejects unsupported `v`/`kdf`/`alg` with descriptive non-canonical errors before the constant-time wrong-password path (lines 211-228) — appropriate, since these are protocol errors not authentication failures.
- **Validation before KDF** — `export_connections_encrypted` rejects short/empty pw at line 511 before any Argon2 work; confirmed.
- **Invariant: `crypto::encrypt` / `crypto::decrypt` unchanged** — signatures `pub fn encrypt(plaintext: &str, key: &[u8]) -> Result<String, AppError>` and `pub fn decrypt(encrypted: &str, key: &[u8]) -> Result<String, AppError>` verified intact (lines 98 and 113).
- **Invariant: `export_connections` / `import_connections` unchanged** — verified by file diff structure; pre-existing tests for these commands still pass.
- **Invariant: `paradigmOf` unchanged** — `src/types/connection.ts:138` still exports `paradigmOf(dbType)` with the same signature.
- **Two new commands wired** — `src-tauri/src/lib.rs:27-28` registers `export_connections_encrypted` and `import_connections_encrypted` in `invoke_handler`.
- **Plain-JSON fallback** — `import_connections_encrypted` parses payload as `serde_json::Value` and only routes to envelope decode when **both** `kdf` and `ciphertext` are present (line 541), so a plain export can never accidentally trip the envelope path.
- **Frontend extractErrorMessage** — `ImportExportDialog.tsx:400-409` correctly normalises the `Encryption error: <canonical>` backend string to just the canonical sentence; locked by the wrong-password test.

### P1/P2/P3 findings

- **(none)**

### Minor observations (non-blocking)

- Argon2 cost params (`m_cost=19_456`, `t_cost=2`, `p_cost=1`) are reasonable OWASP-2023 desktop defaults and are stored in the envelope, so future re-tuning won't break old envelopes. Documented in handoff.
- The dialog's secondary "password too short" hint (`<span role="status">`) under the buttons is duplicative with the inline error inside `MasterPasswordField`, but harmless and arguably helpful for the disabled-button affordance.
- `extractErrorMessage` swallows non-canonical Tauri rejection shapes via `String(e)`. Acceptable since the canonical wrong-password path is what AC-06 cares about; other paths still render whatever the backend emits.
- `clipboard.writeText` `.catch` is documented as best-effort with an inline comment (per sprint-88 catch-audit rule). Acceptable.

### Feedback for Generator

- None — sprint passes all eight ACs and all seven verification gates with strong test coverage. Recommend committing.

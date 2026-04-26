# Sprint 140 — Handoff

**Date**: 2026-04-27
**Scope**: AC-S140-01..08 — encrypted export/import (Argon2id + AES-256-GCM envelope) plus
partial-selection picker and master-password field. Closes lesson
`2026-04-27-workspace-toolbar-ux-gaps`.

## Changed files

### Backend (Rust)

| Path | Purpose |
| --- | --- |
| `src-tauri/Cargo.toml` | Add `argon2 = "0.5"` for password-based KDF. |
| `src-tauri/src/storage/crypto.rs` | Add `EncryptedEnvelope` struct, `aead_encrypt_with_password`, `aead_decrypt_with_password`, canonical `INCORRECT_MASTER_PASSWORD_MESSAGE`, 8 unit tests. Existing `encrypt`/`decrypt` untouched. |
| `src-tauri/src/commands/connection.rs` | New `export_connections_encrypted` / `import_connections_encrypted` Tauri commands with envelope auto-detection on import, plus 7 unit tests. |
| `src-tauri/src/lib.rs` | Register the two new commands in `invoke_handler`. |

### Frontend (TS/React)

| Path | Purpose |
| --- | --- |
| `src/lib/tauri.ts` | Add `exportConnectionsEncrypted` / `importConnectionsEncrypted` invoke wrappers. |
| `src/components/connection/import-export/MasterPasswordField.tsx` | New component: labelled password input with show/hide toggle and inline min-length error. |
| `src/components/connection/import-export/MasterPasswordField.test.tsx` | 8 tests (label, onChange, toggle, error visibility, custom minLength, aria-invalid). |
| `src/components/connection/import-export/SelectionTree.tsx` | New tri-state checkbox picker (master / group / connection) with indeterminate handling and `(No group)` pseudo-group. |
| `src/components/connection/import-export/SelectionTree.test.tsx` | 9 tests covering AC-04 scenarios + ungrouped + master-from-indeterminate. |
| `src/components/connection/ImportExportDialog.tsx` | Replace flat list with `SelectionTree`, integrate `MasterPasswordField`, route through encrypted commands, normalise wrong-password error to canonical copy, `looksLikeEnvelope` heuristic for import auto-detect. |
| `src/components/connection/ImportExportDialog.test.tsx` | Updated mocks + new tests for encrypted round-trip, plain-JSON pass-through regression, password gating, wrong-password copy. |

## Verification (last lines per gate)

### `pnpm vitest run`

```
 RUN  v4.1.3 /Users/felix/Desktop/study/view-table


 Test Files  139 passed (139)
      Tests  2144 passed (2144)
   Start at  03:20:06
   Duration  22.79s (transform 5.96s, setup 8.86s, import 35.87s, tests 54.35s, environment 83.64s)
```

### `pnpm tsc --noEmit`

Clean — no diagnostics emitted.

### `pnpm lint`

```
> table-view@0.1.0 lint /Users/felix/Desktop/study/view-table
> eslint .
```

### `pnpm contrast:check`

```
> table-view@0.1.0 contrast:check /Users/felix/Desktop/study/view-table
> tsx scripts/check-theme-contrast.ts

WCAG AA contrast: 72 themes / 144 theme-modes / 864 pairs — 0 new violations (64 allowlisted)
```

### `cargo test --lib`

```
test storage::crypto::tests::aead_envelope_unicode_payload_round_trip ... ok
test storage::crypto::tests::aead_envelope_password_round_trip ... ok
test storage::crypto::tests::aead_envelope_serializes_to_locked_schema ... ok
test storage::crypto::tests::aead_envelope_tampered_nonce_rejected ... ok
test storage::crypto::tests::aead_envelope_tampered_salt_rejected ... ok
test storage::crypto::tests::aead_envelope_tampered_ciphertext_rejected ... ok
test storage::crypto::tests::aead_envelope_wrong_password_rejected ... ok
test storage::crypto::tests::aead_envelope_decrypt_with_same_password_is_deterministic ... ok

test result: ok. 287 passed; 0 failed; 2 ignored; 0 measured; 0 filtered out; finished in 2.40s
```

### `cargo clippy --all-targets --all-features -- -D warnings`

```
    Checking table-view v0.1.0 (/Users/felix/Desktop/study/view-table)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 2.17s
```

### `pnpm exec eslint e2e/**/*.ts`

Clean — no diagnostics emitted.

## AC-S140 → test mapping

| AC | Description | Tests proving the AC |
| --- | --- | --- |
| AC-S140-01 | Argon2id + AES-256-GCM envelope round-trip | `crypto::tests::aead_envelope_password_round_trip`, `aead_envelope_decrypt_with_same_password_is_deterministic`, `aead_envelope_unicode_payload_round_trip` |
| AC-S140-02 | Locked envelope schema (`v, kdf, salt, nonce, alg, ciphertext, tag_attached` + cost params) | `crypto::tests::aead_envelope_serializes_to_locked_schema` |
| AC-S140-03 | Wrong password / tampered field → canonical error, no oracle | `crypto::tests::aead_envelope_wrong_password_rejected`, `aead_envelope_tampered_ciphertext_rejected`, `aead_envelope_tampered_nonce_rejected`, `aead_envelope_tampered_salt_rejected`; `commands::connection::tests::test_import_connections_encrypted_wrong_password_rejected`; UI: `ImportExportDialog.test.tsx › surfaces canonical wrong-password message` |
| AC-S140-04 | Selection tree (master/group/connection, indeterminate) | `SelectionTree.test.tsx` × 9 (empty, all-selected, single-group, single-conn, multi-conn cross-group, multi-group, partial-group, ungrouped pseudo-group, master-from-indeterminate) |
| AC-S140-05 | Master-password field UX (toggle, min-length, aria) | `MasterPasswordField.test.tsx` × 8 (label, onChange, show/hide toggle, error below minLength, error hidden at minLength, empty allowed, custom minLength, aria-invalid) |
| AC-S140-06 | Encrypted export command rejects short / empty passwords; happy-path serialises a valid envelope | `commands::connection::tests::test_export_connections_encrypted_round_trip`, `test_export_connections_encrypted_rejects_short_password`, `test_export_connections_encrypted_rejects_empty_password` |
| AC-S140-07 | Import auto-detects envelope vs plain JSON; backward compatible | `commands::connection::tests::test_import_connections_encrypted_plain_json_pass_through`, `test_import_connections_encrypted_preserves_schema_version`, `test_import_connections_encrypted_invalid_envelope_json`; UI: `ImportExportDialog.test.tsx › imports plain JSON without password` |
| AC-S140-08 | Dialog disables export until selection > 0 AND password ≥ 8; integrates encrypted round-trip | `ImportExportDialog.test.tsx › disables export when nothing selected`, `› disables export when password is shorter than 8`, `› round-trips an encrypted export through import` |

## Assumptions

- **Argon2id cost params**: `m_cost = 19_456` KiB (~19 MiB), `t_cost = 2`, `p_cost = 1`.
  Chosen as a desktop-friendly point (~hundreds of ms on a modern laptop) that still meets
  OWASP 2023 minimums; surfaced in the envelope so future tuning can be detected.
- **Salt / nonce sizes**: 16 B salt, 12 B nonce (AES-GCM standard); both random per export.
- **Envelope detection heuristic**: presence of both `kdf` and `ciphertext` keys at the JSON
  root. Plain export schema has neither, so collisions are not possible without an explicit
  attempt to imitate the envelope.
- **UI minimum password length**: 8 characters (matches backend `MASTER_PASSWORD_MIN_LEN`).
  The component allows callers to override, but the dialog passes the default.

## Residual risks

- **No password strength meter**: only length is enforced. We rely on user discipline /
  external password managers for entropy. Captured for a future sprint if telemetry shows
  weak-password adoption.
- **Argon2id cost not auto-tuned**: a slow device will feel this; a fast attacker will burn
  through it more quickly than a tuned-per-machine value would. Still well above plaintext
  or single-pass KDFs and the cost params are stored, so re-tuning is forward-compatible.
- **No throttling of decrypt attempts**: an attacker with the file can brute force offline.
  This is inherent to a portable encrypted artefact; the canonical error message reduces
  oracle leakage but does not stop offline guessing — that is the entire point of using
  Argon2id for KDF.

## Deviations

None. The locked envelope schema is implemented exactly as specified
(`v, kdf, salt, nonce, alg, ciphertext, tag_attached`); the cost params (`m_cost, t_cost,
p_cost`) are added as additional fields per the contract's "additional fields permitted"
clause and are required for forward-compatible KDF tuning. Existing `encrypt`/`decrypt`
helpers and `export_connections`/`import_connections` commands were not modified, so
backward compatibility for the plain-JSON path is preserved by construction.

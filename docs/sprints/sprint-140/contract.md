# Sprint Contract: sprint-140

## Summary

- Goal: Plain JSON export가 password를 못 싣고, selection UI가 평면 list (group/multi-conn 부분 선택 불가) 인 lesson(2026-04-27)을 닫는다. Master password 기반 AES-256-GCM 암호화 export/import + 그룹 indeterminate를 포함한 selection tree 도입.
- Audience: Phase 10 사용자 점검 #5 (encrypted export & multi-select).
- Owner: Generator (general-purpose)
- Verification Profile: `mixed`

## In Scope

- MODIFY `src-tauri/Cargo.toml` — `argon2 = "0.5"` (Argon2id KDF) 추가. 다른 deps는 그대로.
- MODIFY `src-tauri/src/storage/crypto.rs` — 새 함수 `aead_encrypt_with_password(plaintext, master_password) -> Result<EncryptedEnvelope, AppError>` 와 `aead_decrypt_with_password(envelope, master_password) -> Result<String, AppError>` 추가. 기존 file-key 기반 `encrypt`/`decrypt` 시그니처 유지(회귀 가드). KDF는 Argon2id (salt 16B random, default params or 명시 params), AEAD는 AES-256-GCM (nonce 12B random).
- CREATE `src-tauri/src/storage/envelope.rs` (또는 `crypto.rs` 안 module) — `EncryptedEnvelope` struct: `{ v: u8 = 1, kdf: "argon2id", argon2_m_cost, argon2_t_cost, argon2_p_cost, salt_b64, nonce_b64, alg: "aes-256-gcm", ciphertext_b64, tag_attached: bool = true }`. Serde serialize/deserialize.
- MODIFY `src-tauri/src/commands/connection.rs` — 신규 `#[tauri::command] export_connections_encrypted(ids: Vec<String>, master_password: String) -> Result<String, AppError>` (envelope JSON 반환). 신규 `import_connections_encrypted(payload: String, master_password: String) -> Result<ImportResult, AppError>` (envelope OR plain JSON 둘 다 받음 — envelope이면 복호화 후 기존 import 흐름으로 위임, plain JSON이면 password 없는 기존 흐름).
- MODIFY `src/lib/tauri.ts` — `exportConnectionsEncrypted(ids, password)`, `importConnectionsEncrypted(payload, password)` invoke wrapper.
- MODIFY `src/components/connection/ImportExportDialog.tsx` — Master password 필드 + 새 SelectionTree 통합. Export pane: master password input + selection tree + "Generate encrypted JSON" 버튼. Import pane: master password input (envelope 감지 시에만 필요) + textarea + "Import" 버튼.
- CREATE `src/components/connection/import-export/MasterPasswordField.tsx` — labeled password input, min 8 chars 검증, show/hide toggle, aria-label.
- CREATE `src/components/connection/import-export/SelectionTree.tsx` — group/connection 트리. 그룹 헤더 체크박스는 부분 선택 시 indeterminate; "All" 토글 + "X connections, Y groups selected" 카운트 헤더; ungrouped connection은 "(No group)" pseudo-group 아래.
- CREATE 각 `*.test.tsx` / `*.test.ts` (vitest)
- CREATE cargo unit tests in `crypto.rs` and `connection.rs` for new commands

## Out of Scope

- Master password key escrow / recovery — non-goal.
- 자동 패스워드 강도 측정기 — non-goal.
- AES-GCM 외 다른 cipher — non-goal.
- PBKDF2 fallback — Argon2id 단일 채택.
- 백엔드 file-based key (`get_or_create_key` / `encrypt` / `decrypt`) 시그니처 변경 금지 — 기존 sqlx column 암호화 회귀 가드.
- Sidebar / query editor / connection form (S134~S139 종료).

## Invariants

- 기존 `export_connections` / `import_connections` command 동작 유지 (plain JSON path 회귀 가드).
- 기존 `crypto::encrypt` / `crypto::decrypt` 시그니처 + 동작 유지.
- `paradigmOf(dbType)` 시그니처 유지.
- DBMS shape sidebar(S135), Preview/persist(S136), DisconnectButton(S134), Mongo cache(S137), DBMS-aware form(S138), paradigm-aware editor(S139) 미파손.
- `ImportExportDialog` 의 일반 동작 (탭 전환, copy-to-clipboard, 결과 패널, dialog 닫기) 유지.

## Acceptance Criteria

- `AC-S140-01` 새 백엔드 command `export_connections_encrypted(ids, master_password)`가 Argon2id KDF (random 16-byte salt) + AES-256-GCM (random 12-byte nonce) ciphertext 를 담은 envelope JSON 을 반환. cargo test 가 (a) round-trip (encrypt → decrypt → 동일 plaintext), (b) wrong password 거부, (c) tamper detection (auth tag fail) 검증.
- `AC-S140-02` 새 command `import_connections_encrypted(payload, master_password)`가 envelope 을 복호화 후 ConnectionConfig[] / groups 를 기존 import 흐름으로 위임. wrong password → 식별 가능한 에러 (e.g. `AppError::Encryption("Incorrect master password ...")`). cargo test 가 round-trip + wrong password rejection 어서션.
- `AC-S140-03` 프런트 `ImportExportDialog`에 Master password 입력란이 추가된다. Export 시 빈 password 또는 8자 미만 거부 (inline error); Import 시 envelope 감지되면 password 필수, 빈 password 입력 시 invoke 자체를 막음. 신규 vitest 어서션.
- `AC-S140-04` Export pane의 selection UI:
  - "All" 체크박스 + 그룹 헤더 체크박스 + 개별 connection 체크박스
  - 그룹 헤더 체크박스는 indeterminate 시각 상태(`input.indeterminate = true`)
  - 헤더에 "X connections, Y groups selected" 카운트
  - 신규 vitest test가 6개 시나리오 (전체 / 단일 그룹 / 단일 conn / 멀티 conn / 멀티 그룹 / partial group) 모두 어서션
- `AC-S140-05` Encrypted export 결과는 envelope JSON 포맷 `{ v: 1, kdf: "argon2id", salt: <b64>, nonce: <b64>, alg: "aes-256-gcm", ciphertext: <b64>, tag_attached: true, ...argon2 params }`. 기존 plain JSON export 와 별도 path. backward import 는 plain JSON 도 받지만 password 없음 (기존 동작 그대로).
- `AC-S140-06` Wrong password 로 import 시도 시 사용자에게 명확한 inline error ("Incorrect master password — the file could not be decrypted"). 동일 message 가 모든 wrong-password 케이스에서 반환. (Latency oracle 방지를 위해 backend 가 KDF 수행 후 공통 에러 path 로 가도록 — best effort.)
- `AC-S140-07` 회귀 가드: 기존 import-export e2e/vitest 미파손 — plain JSON export 와 plain JSON import 는 그대로. 신규 envelope path 만 추가.
- `AC-S140-08` 7개 게이트 + neue cargo test 그린.

## Design Bar / Quality Bar

- `assertNever` 또는 exhaustive switch — `any` 금지.
- Master password 는 메모리 leak 최소화 (`zeroize` crate 권장이지만 본 sprint 비-필수).
- 다크 모드 + a11y (aria-label, role, indeterminate 시 aria-checked="mixed" 또는 동등) 준수.
- envelope JSON 의 schema_version 은 `v: 1` 로 고정 — 향후 변경 시 KDF/alg 별 분기.

## Verification Plan

### Required Checks

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
7. `pnpm exec eslint e2e/**/*.ts`

### Required Evidence

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력 (last 20 lines)
- AC별 vitest / cargo test 이름

## Test Requirements

### Unit Tests (필수)
- AC-01: cargo `aead_encrypt_with_password` 라운드트립 + wrong password + tamper detection
- AC-02: cargo `import_connections_encrypted` round-trip + wrong password rejection
- AC-03: vitest `MasterPasswordField` min length 8 + empty rejection
- AC-04: vitest `SelectionTree` 6 시나리오 (전체/그룹/단일/멀티 conn/멀티 그룹/partial)
- AC-05: vitest `ImportExportDialog` envelope path + plain JSON path 둘 다 동작
- AC-06: vitest wrong-password inline error message 어서션
- AC-07: 기존 import-export 테스트 미파손 회귀 가드

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: 3개 그룹 + 2 ungrouped → password "open-sesame!" → 라운드트립
- [ ] 에러/예외: 빈 password / 7자 password / wrong password
- [ ] 경계 조건: 0 selected → "Generate" 버튼 disabled; partial group 선택 시 그룹 indeterminate
- [ ] 기존 기능 회귀 없음: plain JSON export / import 동작

## Test Script / Repro Script

1-7. 7개 verification command

## Ownership

- Generator: general-purpose agent
- Write scope: `src-tauri/src/storage/`, `src-tauri/src/commands/connection.rs`, `src-tauri/Cargo.toml`, `src/components/connection/`, `src/lib/tauri.ts`
- Merge order: S134 → S135 → S136 → S137 → S138 → S139 → **S140**

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`

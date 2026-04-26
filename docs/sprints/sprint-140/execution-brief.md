# Sprint Execution Brief: sprint-140

## Objective

Plain JSON export 가 password 를 동반할 수 없는 lesson(2026-04-27)을 닫는다. Master password 기반 AES-256-GCM 암호화 export/import + Argon2id KDF + indeterminate group checkbox 가 들어간 SelectionTree 를 도입.

## Task Why

사용자 점검(2026-04-27)에서 "export 후 다른 머신에 가면 password 를 다 다시 넣어야 한다" + "그룹 단위 부분 선택이 안 된다"는 두 핵심 UX 갭이 드러났다. 한 sprint 에 (1) Argon2id+AES-GCM envelope 백엔드 + (2) indeterminate group checkbox + multi-select selection tree 를 동시에 닫는다. 기존 plain JSON path 는 회귀 가드로 보존.

## Scope Boundary

- 변경 가능: `src-tauri/src/storage/`, `src-tauri/src/commands/connection.rs`, `src-tauri/Cargo.toml`, `src/components/connection/`, `src/lib/tauri.ts`.
- 변경 금지: 기존 `crypto::encrypt`/`crypto::decrypt` 시그니처, `export_connections`/`import_connections` 시그니처, sidebar / query editor / connection form, 백엔드 connection_test command.
- 새 paradigm 추가 금지 (Cassandra 등).

## Invariants

- 기존 `export_connections` / `import_connections` 동작 유지.
- 기존 `crypto::encrypt` / `crypto::decrypt` 시그니처 + 동작 유지 (sqlx column 암호화 회귀 가드).
- `paradigmOf(dbType)` 시그니처 유지.
- DBMS shape(S135), Preview(S136), DisconnectButton(S134), Mongo cache(S137), DBMS-aware form(S138), paradigm-aware editor(S139) 동작 유지.
- 키보드 단축키 유지.

## Done Criteria

1. argon2 crate dependency 추가 + `aead_encrypt_with_password`/`aead_decrypt_with_password` 신규.
2. `EncryptedEnvelope` struct + JSON serde — `{ v:1, kdf:"argon2id", salt, nonce, alg:"aes-256-gcm", ciphertext, tag_attached:true }`.
3. `export_connections_encrypted` / `import_connections_encrypted` 신규 tauri command + 각 cargo test.
4. 프런트 `MasterPasswordField` + `SelectionTree` 신규 컴포넌트 + 각 vitest test.
5. `ImportExportDialog` 통합 — encrypted path + plain path 둘 다 노출, envelope 자동 감지로 import.
6. wrong password 시 동일 inline error message; 6 selection 시나리오 all green.
7. 7개 verification command 그린.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `pnpm contrast:check`
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. `pnpm exec eslint e2e/**/*.ts`
- Required evidence:
  - 7개 명령 출력 (last 20 lines)
  - cargo test 이름 + vitest test 이름
  - 6 selection 시나리오 vitest 통과 라인

## Evidence To Return

- 변경 파일 목록 (path + 한 줄 purpose)
- 7개 verification command 출력
- AC-S140-01..08 증거
- 가정 (예: argon2 default params 채택, master password zeroize 미적용)
- 리스크 (timing oracle best-effort, master password recovery 없음)

## References

- Contract: `docs/sprints/sprint-140/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md` (Phase 10 — S140 섹션 + Encrypted envelope shape decision lock)
- Lesson: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Sprint 96 import/export baseline: `docs/sprints/sprint-96/handoff.md` (참고)
- Relevant files (read first):
  - `src-tauri/src/storage/crypto.rs` (+ test) — 기존 file-key based crypto
  - `src-tauri/src/storage/mod.rs`
  - `src-tauri/src/commands/connection.rs` — `export_connections` / `import_connections` 위치
  - `src-tauri/src/error.rs` — `AppError::Encryption` / `AppError::Validation` variants
  - `src-tauri/Cargo.toml`
  - `src/components/connection/ImportExportDialog.tsx` (+ test)
  - `src/lib/tauri.ts` — invoke wrapper 패턴
  - `src/types/connection.ts` — `ConnectionConfig`, `ConnectionGroup`

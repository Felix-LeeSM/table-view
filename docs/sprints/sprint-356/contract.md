# Sprint Contract: sprint-356

## Summary

- Goal: Phase 1 file-key 를 디스크 평문 → OS keyring 으로 이주. Q22 의 3 path (신규 사용자 / 기존 사용자 migration / Linux Secret Service fallback) 모두 구현.
- Audience: state-management-strategy Q22 — Threat 1 (offline disk-access) 보호 강화.
- Owner: Generator (sprint-356)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/Cargo.toml` — `keyring` Rust crate.
- `src-tauri/src/storage/crypto.rs` — `get_or_create_key()` 확장:
  - Path A (신규): keyring `com.tableview.app.file-key` 에 entry 생성.
  - Path B (기존): keyring 읽기 시도 → 없으면 디스크 `.key` 확인 → 있으면 keyring import + 디스크 파일 `0o000` chmod + secure delete.
  - Path C (Linux fallback): Secret Service 미가용 (Service::new() Err) → 디스크 `.key` 파일 mode 유지 + frontend toast 1회.
- `src-tauri/src/storage/key_migration.rs` — sentinel `.key.migration-failed` 파일 sidecar (codex 5차 #5 — SQLite 안 두지 않음). 실패 시 sidecar 생성, 다음 boot 재시도.
- `src/components/connection/KeyringFallbackToast.tsx` — Linux fallback 안내 (1회만 표시 — file sidecar `.keyring-fallback-dismissed`. settings/SQLite 미존재 단계).
- 단위 / integration 테스트:
  - `src-tauri/tests/keyring_new_user.rs`
  - `src-tauri/tests/keyring_migration.rs`
  - `src-tauri/tests/keyring_linux_fallback.rs`
  - `src/components/connection/KeyringFallbackToast.test.tsx`

## Out of Scope

- envelope crypto 변경 (Sprint 140 의 Argon2id 그대로).
- macOS Keychain ACL fine-tuning.
- Recovery flow (사용자가 macOS 계정 잃어버릴 때) — 별 sprint.

## Invariants

- 이주 후 기존 connections decrypt 정상 (envelope 호환).
- Keyring entry name 고정 `com.tableview.app.file-key`.
- 디스크 `.key` 가 존재하면 (Path B 후) `0o000` 으로 사용 불가 표시 + secure delete.
- migration 실패 시 sentinel 파일 (`.key.migration-failed`) 남기고 기존 디스크 mode 유지 — 데이터 손실 0.
- Linux fallback toast 는 1회 (file sidecar `.keyring-fallback-dismissed`).

## Acceptance Criteria

- `AC-356-01` Path A (신규): 디스크 `.key` 없음 + 빈 keyring 상태 boot → `get_or_create_key()` 호출 → keyring entry 1개 생성, 디스크 `.key` 안 만들어짐. Test: `keyring_new_user.rs`.
- `AC-356-02` Path B (migration): 디스크 `.key` 있음 + 빈 keyring 상태 boot → keyring entry 생기고 디스크 `.key` `0o000` chmod + 다음 byte 다 0 으로 overwrite + delete. 이후 `decrypt(connections.json)` 정상. Test: `keyring_migration.rs`.
- `AC-356-03` Path B 의 idempotency: 두 번째 boot → keyring 에 이미 있어 디스크 read 시도 0. Test: 2회 boot 시퀀스.
- `AC-356-04` Path B 실패 (write 권한 등): sentinel `.key.migration-failed` 생성, 디스크 `.key` 유지, decrypt 는 디스크 path 로 fallback. Test: write-protected dir 시뮬.
- `AC-356-05` Path C (Linux fallback): `keyring::Entry::new` Err 시뮬 → 디스크 `.key` mode 유지, frontend 에 toast event emit, file sidecar `.keyring-fallback-dismissed` 1회 set. Test: `keyring_linux_fallback.rs` + RTL toast 단위 테스트.
- `AC-356-06` Toast 1회: sentinel **file sidecar** `.keyring-fallback-dismissed` (디스크 user-data dir 안) set 후 boot 재실행 → toast 표시 0. Strategy 가 keyring step 을 SQLite migration 전으로 잠가놔 `meta` table 미존재 — file sidecar 채택. Test: sentinel 파일 시뮬 + RTL not-in-document.
- `AC-356-07` Keyring write→read byte equality: `entry.set_password(b)` 후 `entry.get_password()` → bytes 일치 100%. Test: round-trip.
- `AC-356-08` envelope decrypt 전체 검증: 이주 후 `connections.json` 의 모든 `password_enc` 가 새 keyring key 로 decrypt 가능. Test: 5+ password 시드 → 5 모두 decrypt match.
- `AC-356-09` Fatal missing-key path: keyring + 디스크 `.key` 둘 다 없음 + `password_enc` 있음 → boot 시 safe mode (connect 차단) + 사용자에게 "Decryption key lost — restore from backup" toast. App quit 안 함. Test: 시뮬.

## Design Bar / Quality Bar

- TDD: 각 path 의 red test 먼저. fixture 로 디스크 `.key` 시드 + mock keyring backend.
- Secure delete: overwrite + unlink (`tokio::fs::remove_file` 만으로 부족 — 추가 overwrite).
- Toast UI 는 dismiss 버튼 + "Why?" link → `docs/security/keyring-fallback.md` (out of scope, link만).
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test keyring_new_user`
3. `cd src-tauri && cargo test -p table-view-lib --test keyring_migration`
4. `cd src-tauri && cargo test -p table-view-lib --test keyring_linux_fallback`
5. `pnpm vitest run src/components/connection/KeyringFallbackToast.test.tsx`
6. `pnpm tsc --noEmit && pnpm lint`
7. `pnpm vitest run` (full)

### Required Evidence

- 3 path raw integration 결과 로그.
- Sentinel 파일 생성/삭제 시퀀스 결과.
- Toast RTL `getByRole("alert")` assertion.

## Test Requirements

- Cargo integration: 3 path × 1+ 테스트.
- Vitest: KeyringFallbackToast RTL + dismiss + flag-set 회귀.
- Coverage: `src-tauri/src/storage/crypto.rs` + `key_migration.rs` 70%.
- Scenario: (a) 신규, (b) migration, (c) idempotent, (d) migration 실패, (e) Linux fallback, (f) toast 1회.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test keyring_new_user --test keyring_migration --test keyring_linux_fallback`
3. `pnpm vitest run src/components/connection/KeyringFallbackToast.test.tsx`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 만. envelope crypto (Sprint 140 결과) 변경 0.
- Merge order: 355 와 병렬 가능. 358 은 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 9/9 PASS
- 3 OS keyring backend (macOS/Windows/Linux) 호환 — CI matrix.

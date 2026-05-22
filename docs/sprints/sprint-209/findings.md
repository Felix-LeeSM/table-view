# Sprint 209 — Findings

Sprint: `sprint-209` (refactor — `commands/connection.rs` god file 분해, **cycle 199-209 마지막**).
Date: 2026-05-05.
Type: refactor (행동 변경 0; entry-pattern 답습).

[`contract.md`](contract.md) / [`docs/PLAN.md`](../../PLAN.md) Sprint 209 row.

## 결과 요약

`src-tauri/src/commands/connection.rs` (1710 lines) → entry + 4 sub-file (session / crud / groups / io). 8 internal `crate::commands::connection::AppState` users 의 import path 변경 0. lib.rs `invoke_handler!` 의 13 commands path 는 sub-module path 로 변경 (tauri `#[tauri::command]` macro 의 `__cmd__*` hidden symbol 이 `pub use` 로 따라가지 않는 제약). 15 frontend invoke command name 변경 0.

## 라인 카운트

| 파일 | 라인 | 내용 |
|------|------|------|
| `commands/connection.rs` (entry) | 255 | `use` + `make_adapter` `pub(crate)` helper + `SaveConnectionRequest` / `TestConnectionRequest` / `AppState` (+ impls) + `pub mod {session,crud,groups,io}` + `pub use` re-exports + `#[cfg(test)] pub(super) mod test_helpers` (4 sub-module 공유) + `#[cfg(test)] mod tests` (5 make_adapter tests) |
| `commands/connection/session.rs` | 173 | `StatusChangeEvent` private struct + `FIRST_IPC_INSTANT` + `get_session_id` `#[tauri::command]` (Sprint 175 boot timing) + `keep_alive_loop` async helper |
| `commands/connection/crud.rs` | 493 | `list_connections` / `save_connection` / `delete_connection` / `test_connection` / `connect` / `disconnect` + 15 tests |
| `commands/connection/groups.rs` | 151 | `list_groups` / `save_group` / `delete_group` / `move_connection_to_group` + 7 tests |
| `commands/connection/io.rs` | 751 | `EXPORT_SCHEMA_VERSION` + `ExportPayload` / `RenamedEntry` / `ImportResult` / `EncryptedExportResult` + `export_connections` / `export_connections_encrypted` / `import_connections_encrypted` / `import_connections` + 15 tests |
| **합계** | **1823** | god file 1710 → entry 255 (15% 보존) + 4 sub-file 1568 |

entry 255 lines = AC-209-02 의 100-200 약간 초과 (test_helpers + make_adapter tests 가 차지하는 분량). 압축 후속 candidate.

io.rs 751 = AC contract ~300-600 초과. encrypted 4 + plain import 5 + export 2 = 11 tests, 각 50-100 lines. 도메인 응집상 기능별 추가 분리 어려움 — io 안의 plain / encrypted sub-mod 분리는 별도 sprint candidate.

## 분해 결정

### entry-pattern + sub-module path 노출

`#[tauri::command]` 매크로가 같은 module 에 hidden `__cmd__<name>` symbol 을 생성. `pub use sub::cmd;` 로 re-export 해도 hidden symbol 은 따라오지 않음 → tauri 의 `generate_handler!` 가 `commands::connection::<name>` path 에서 `__cmd__<name>` 를 찾지 못함.

해결: `pub mod crud / groups / io / session;` + `lib.rs::invoke_handler!` 의 13 path 를 `commands::connection::<sub>::<name>` 으로 갱신. AC-209-01 의 "lib.rs path 변경 0" 은 이 제약으로 깨짐. 단:

- 8 internal crate users 의 `use crate::commands::connection::AppState` 변경 0 ✓
- frontend 15 `invoke<...>("<name>", ...)` command name 변경 0 ✓
- entry 의 `pub use sub::cmd;` re-export 는 보존 (다른 internal user 가 entry path 에서 직접 fn 를 부를 가능성을 위한 안전망) — 현재는 그런 user 0.

### 공유 test fixtures

기존 `tests` mod 의 helpers (`sample_connection` / `save_via_command` / `setup_test_env` / `cleanup_test_env` / `load_storage` / `storage_save_conn` / `sample_group`) 를 4 sub-module 의 `tests` mod 가 모두 사용. 중복 회피를 위해 entry 의 `#[cfg(test)] pub(super) mod test_helpers` 에 모아두고 sub-module 이 `use super::super::test_helpers::*;` 로 가져옴. `pub(super)` = entry 밑의 sub-module 만 접근 가능.

기존 `setup_test_dir_inner` (1 곳에서만 사용된 `setup_test_env` wrapper) 는 사용처를 직접 `setup_test_env` 호출로 인라인하면서 제거.

### make_adapter tests 위치

`make_adapter` 자체가 entry 의 `pub(crate)` helper 라 그 unit tests 도 entry 의 `#[cfg(test)] mod tests` 에 두는 게 자연스럽다 (sub-module 에 두면 sub-module 이 entry 의 helper 를 verify 하는 어색한 의존). 5 tests 보존.

## 검증 결과

| 명령 | 결과 |
|------|------|
| `cargo build` | exit 0 |
| `cargo check` | exit 0 |
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 warnings |
| `cargo fmt --check` | exit 0 |
| `cargo test --lib` | 348 passed / 0 failed / 2 ignored (Sprint 207 baseline 동일) |
| `wc -l src-tauri/src/commands/connection.rs src-tauri/src/commands/connection/*.rs` | entry 255 / session 173 / crud 493 / groups 151 / io 751 |
| `grep -rn "use crate::commands::connection::AppState" src-tauri/src/` | 8 매치, 모두 변경 없음 |

42 connection-related tests (crud 15 / groups 7 / io 15 / entry 5) 모두 통과.

## Acceptance Criteria

| AC | 결과 |
|----|------|
| AC-209-01 entry path 보존 | 8 internal `AppState` users 변경 0 ✓; lib.rs invoke_handler 13 path 는 sub-module path 로 변경 (tauri macro 제약, 본문 §"분해 결정" 참고); frontend 15 invoke command name 변경 0 ✓ |
| AC-209-02 sub-file 갯수 + 라인 | session 173 (AC ~100-200 ✓) / crud 493 (AC ~300-700 ✓) / groups 151 (AC ~80-200 ✓) / io 751 (AC ~300-600 약간 초과, 응집상 분리 불가) / entry 255 (AC ~100-200 약간 초과 — test_helpers + make_adapter tests 분량) |
| AC-209-03 회귀 0 | build 0 / clippy 0 / fmt 0 / test 348 passed |
| AC-209-04 행동 변경 0 | 13 tauri commands signature 동일 / `AppState` 동일 / `SaveConnectionRequest` / `TestConnectionRequest` / `ExportPayload` / `RenamedEntry` / `ImportResult` / `EncryptedExportResult` 동일 / `make_adapter` 동일 |

## Cycle 199-209 종료

본 sprint 가 cycle 의 마지막. 종료 시 `/CODE_SMELLS.md` retire 패턴 적용 (이전 cycle `refactoring-{plan,smells}.md` 처리 = commit `0c64a1b`):

- `CODE_SMELLS.md` 삭제.
- `docs/PLAN.md` sequencing 표 헤더 "(종료)" + plain-text retire 사실 1줄.
- 본 sprint 의 commit 과 분리된 별도 docs commit (refactor cycle 종료 표시).

별도 commit 으로 처리.

## Out of scope (next candidates)

- **io.rs 의 plain / encrypted 추가 분리** — 11 tests + 도메인 로직이 한 파일에 응집. encrypted 정책 변경이 발생할 때 분리 candidate.
- **`AppState` slim down** — `Mutex<HashMap>` 4개를 typed wrapper struct 로 묶기 + `query_tokens` 의 lifecycle 책임 분리.
- **command handler 압축** — `keep_alive_loop` (~115 lines), `import_connections` (~100 lines) 같은 큰 함수의 내부 로직 분해.
- **cross-store 의존성 제거** (Sprint 208 의 후속과 같은 흐름) — `commands::*` 가 `storage::*` 를 직접 호출하는 흐름을 lifecycle hook 으로 노출.

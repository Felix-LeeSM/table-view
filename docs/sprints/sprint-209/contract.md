# Sprint 209 — Contract

Sprint: `sprint-209` (refactor — `commands/connection.rs` god file 분해).
Date: 2026-05-05.
Type: refactor (행동 변경 0; entry-pattern 답습).

[`docs/PLAN.md`](../../PLAN.md) Sprint 209 row + `/CODE_SMELLS.md` §1-2.

## 배경

`src-tauri/src/commands/connection.rs` (1710 lines, backend god file #2) 가 단일 파일에 5 책임 응집:

1. App 상태/타입 (`SaveConnectionRequest`, `TestConnectionRequest`, `AppState`, `make_adapter` helper, `FIRST_IPC_INSTANT`).
2. 세션/keep-alive (`get_session_id`, `keep_alive_loop`, `StatusChangeEvent`).
3. Connection CRUD (`list_connections` / `save_connection` / `delete_connection` / `test_connection` / `connect` / `disconnect`).
4. Group CRUD (`list_groups` / `save_group` / `delete_group` / `move_connection_to_group`).
5. Import/Export (`ExportPayload` / `RenamedEntry` / `ImportResult` / `EncryptedExportResult` / `export_connections` / `import_connections` / `export_connections_encrypted` / `import_connections_encrypted`).

prod 코드 ~706 lines, tests ~1003 lines. 본 sprint 는 cycle 199-209 의 마지막. postgres.rs (Sprint 202) / SchemaTree (Sprint 199) / DataGridTable (Sprint 200) / QueryTab (Sprint 201) / tabStore (Sprint 208) 의 entry-pattern 답습.

## 패턴 결정

**entry-pattern (보수 4-way split + entry)**:

- entry path 보존 (`src-tauri/src/commands/connection.rs`) — lib.rs `invoke_handler!` 의 13 commands path + 8 internal crate users 의 `crate::commands::connection::AppState` import 변경 0.
- 책임 분리되는 파트만 sub-file 로 발췌 (session / crud / groups / io).
- entry 에서 sub-file 함수 `pub use` re-export — fully-qualified path 보존.

postgres.rs (Sprint 202) 답습: 각 sub-file 에 자체 `mod tests` 포함 (tests 1003 lines 분산).

## Sprint 안에서 끝낼 단위

### 1. `src-tauri/src/commands/connection/session.rs` (신규, ~150 lines)

발췌:
- `StatusChangeEvent` (private struct).
- `FIRST_IPC_INSTANT: OnceLock<Instant>`.
- `get_session_id` `#[tauri::command]`.
- `keep_alive_loop` async helper.
- 관련 tests (있을 시).

### 2. `src-tauri/src/commands/connection/crud.rs` (신규, ~400 lines)

발췌:
- `list_connections` / `save_connection` / `delete_connection`.
- `test_connection`.
- `connect` / `disconnect`.
- 관련 tests (sprint <209 의 다수 unit tests, 약 600+ lines).

### 3. `src-tauri/src/commands/connection/groups.rs` (신규, ~120 lines)

발췌:
- `list_groups` / `save_group` / `delete_group` / `move_connection_to_group`.
- 관련 tests.

### 4. `src-tauri/src/commands/connection/io.rs` (신규, ~400 lines)

발췌:
- `ExportPayload` / `RenamedEntry` / `ImportResult` / `EncryptedExportResult`.
- `export_connections` / `import_connections`.
- `export_connections_encrypted` / `import_connections_encrypted`.
- 관련 tests.

### 5. `src-tauri/src/commands/connection.rs` (entry, ~150 lines)

보존:
- `use ...` 외부 imports.
- `make_adapter` `pub(crate)` helper.
- `SaveConnectionRequest` / `TestConnectionRequest` (외부에서 사용).
- `AppState` + `impl AppState` + `impl Default for AppState`.
- `mod session;` / `mod crud;` / `mod groups;` / `mod io;`.
- `pub use session::{get_session_id};` / `pub use crud::{...};` / `pub use groups::{...};` / `pub use io::{...};` — 13 commands 와 관련 타입 re-export.

8 internal crate users 의 `use crate::commands::connection::AppState` 동일.
lib.rs `invoke_handler!` 의 `commands::connection::<command>` path 동일.

## Acceptance Criteria

### AC-209-01 — entry path 보존

- `grep -rn "commands::connection::" src-tauri/src/` — 8 internal users 의 `AppState` import + lib.rs 의 13 commands path 모두 변경 없음.
- `grep -rn "invoke<.*\(\"\(get_session_id\|list_connections\|...\)\"" src/` — 15 frontend invoke 변경 없음 (command name 보존).

### AC-209-02 — sub-file 갯수 + 라인

- `commands/connection/session.rs` 존재, ~100-200 lines.
- `commands/connection/crud.rs` 존재, ~300-700 lines (tests 포함).
- `commands/connection/groups.rs` 존재, ~80-200 lines.
- `commands/connection/io.rs` 존재, ~300-600 lines.
- `commands/connection.rs` (entry) ~100-200 lines (god file 1710 의 12% 이하).

### AC-209-03 — 회귀 0

- `cd src-tauri && cargo build` exit 0.
- `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- `cd src-tauri && cargo test --lib` baseline (Sprint 207 = pass) 동일.
- `cd src-tauri && cargo fmt --check` exit 0.

### AC-209-04 — 행동 변경 0

- 13 tauri commands 시그니처 동일.
- `AppState` 시그니처 동일 — 8 internal users 영향 없음.
- `SaveConnectionRequest` / `TestConnectionRequest` / `ExportPayload` / `RenamedEntry` / `ImportResult` / `EncryptedExportResult` 시그니처 동일.
- `make_adapter` 시그니처 동일.

## Out of scope

- **command handler 의 분기 압축** — keep_alive_loop 같은 270-line 함수의 내부 로직 분해는 별도 sprint candidate.
- **`AppState` slim down** — `Mutex<HashMap>` 4개를 typed wrapper 로 묶는 작업은 별도 sprint.
- **import/export password 정책 추가 변경** — Sprint 207 + b327227 (auto BIP39 mnemonic) 이 최근. 본 sprint 는 god file 분해만.
- **AppState 의 connection_status / keep_alive_handles 가 commands::connection 외부에서도 잠금된다** — 현 코드 패턴 보존.

## 검증 명령

```sh
cd src-tauri && cargo fmt --check
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings
cd src-tauri && cargo test --lib
wc -l src-tauri/src/commands/connection.rs src-tauri/src/commands/connection/*.rs
grep -rn "commands::connection::" src-tauri/src/ | wc -l
```

기대값: fmt 0 / clippy 0 / cargo test pass / entry + 4 sub-file 모두 존재 / internal user path 변경 없음.

## Cycle 종료 처리

본 sprint 는 cycle 199-209 의 마지막. 종료 후 `/CODE_SMELLS.md` retire (이전 cycle `refactoring-{plan,smells}.md` 처리와 동일 — `0c64a1b` commit 패턴).

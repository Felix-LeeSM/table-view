# Sprint 209 — Handoff

다음 sprint 진입자가 알아야 할 사항.

## 완료 산출물

- `src-tauri/src/commands/connection.rs` (entry, 255 lines).
- `src-tauri/src/commands/connection/session.rs` (173 lines).
- `src-tauri/src/commands/connection/crud.rs` (493 lines).
- `src-tauri/src/commands/connection/groups.rs` (151 lines).
- `src-tauri/src/commands/connection/io.rs` (751 lines).
- `src-tauri/src/lib.rs` invoke_handler 13 path → sub-module path 갱신.
- `docs/sprints/sprint-209/{contract,findings,handoff}.md`.
- `docs/PLAN.md` Sprint 208 commit hash 보강 + Sprint 209 ✓.

## Cycle 199-209 종료

본 sprint = cycle 의 마지막 refactor sprint. 별도 docs commit 으로:

- `CODE_SMELLS.md` 삭제.
- `docs/PLAN.md` sequencing 표 헤더 "(종료)" + plain-text retire 사실 1줄.
- 그 외 cross-link 정리 (CLAUDE.md / memory palace 등에서 `CODE_SMELLS.md` 참조 검색 후 정리).

이전 cycle 의 retire commit `0c64a1b` 패턴 답습 (`refactoring-{plan,smells}.md` 삭제 + 6 곳 cross-link).

## 다음 후속 (cycle 종료 후)

cycle 199-209 가 cycle 의 마지막이므로, 다음 작업은 [`docs/PLAN.md`](../../PLAN.md) 의 feature backlog 진입:

- Phase 13 — PG preview tab parity + multi-window activation 회귀 진단
- Phase 21 — CSV / SQL / JSON Export
- Phase 22 — Row 인라인 편집 RDB + Preview/Commit/Discard 게이트
- Phase 24/25/26 — Index / Constraint / Trigger Write UI

## 주의 사항

### tauri command path 가 sub-module 로 바뀜

`#[tauri::command]` 매크로가 `__cmd__<name>` hidden symbol 을 생성. `pub use` 로는 따라오지 않음 → lib.rs 의 invoke_handler! path 가 다음과 같이 바뀜:

| 이전 | 이후 |
|------|------|
| `commands::connection::list_connections` | `commands::connection::crud::list_connections` |
| `commands::connection::get_session_id` | `commands::connection::session::get_session_id` |
| `commands::connection::list_groups` | `commands::connection::groups::list_groups` |
| `commands::connection::export_connections` | `commands::connection::io::export_connections` |
| (그 외 13 commands 동일 패턴) | |

frontend 의 `invoke<T>("<command_name>", ...)` 는 command name 만 보고 dispatch 하므로 영향 0.

### entry 의 `pub use` re-export 보존

entry 의 `pub use crud::{connect, ...}; pub use groups::{...}; pub use io::{...}; pub use session::get_session_id;` 는 hidden symbol 은 못 따라가지만 일반 fn 은 가져옴. 현재 외부 user 0 이지만 보존 (god file 분해의 의도 노출 + future-proof).

### test_helpers 의 visibility

entry 의 `#[cfg(test)] pub(super) mod test_helpers { ... }` 는 4 sub-module 의 `#[cfg(test)] mod tests` 에서만 접근 가능. `pub(super)` = entry 의 immediate parent (즉 `commands` mod) 에서도 접근 가능 의미. 단 `#[cfg(test)]` 라 prod 코드에는 비공개. 외부 crate 노출 0.

### io.rs 751 lines

AC contract 의 ~300-600 약간 초과. encrypted (4 tests) + plain import (5 tests) + export (2 tests) = 11 tests 가 응집. 추가 분할은 plain / encrypted sub-mod 패턴 candidate, encrypted 정책 변경 시 분리 trigger.

### 사용자 병행 작업과의 격리

본 sprint 작업 중 사용자가 병행 수정한 영역 (commit `b327227` "feat(crypto): export envelope = auto-gen BIP39 mnemonic + Argon2id 강화") 의 `commands/connection.rs` 변경은 본 sprint 시작 시점에 이미 commit 됨. 본 sprint 는 commit 후의 1710 lines 를 분해한 것이라 conflict 없음. unstaged 영역 (launcher.rs / tauri configs / ConnectionGroup&List / memory/ ADR 0021 docs 등) 은 disjoint.

## 검증 명령 (재현)

```sh
cargo check                                                            # exit 0
cargo clippy --all-targets --all-features -- -D warnings               # 0 warnings
cargo fmt --check                                                      # exit 0
cargo test --lib                                                       # 348 passed
wc -l src-tauri/src/commands/connection.rs src-tauri/src/commands/connection/*.rs
                                                                        # entry 255 / session 173 / crud 493 / groups 151 / io 751
grep -rn "use crate::commands::connection::AppState" src-tauri/src/    # 8 매치 동일
```

## 미완 / 후속

- `CODE_SMELLS.md` retire (cycle 종료 별도 docs commit).
- io.rs 의 plain / encrypted 추가 분리 (encrypted 정책 변경 trigger).
- `AppState` typed wrapper.
- cross-store 의존 제거 (commands::* → storage::* 직접 호출 정책).

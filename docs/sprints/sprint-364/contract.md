# Sprint Contract: sprint-364

## Summary

- Goal: Phase 3 Q14 — `ConnectionStatus` Rust enum 확장 (`Connecting` variant + `Connected { active_db }`). serde regression 4-case wire test 통과.
- Audience: state-management-strategy Q14 — backend status truth, multi-window mirror.
- Owner: Generator (sprint-364)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/models/connection.rs:194` — `ConnectionStatus` enum:
  ```rust
  #[derive(Serialize, Deserialize)]
  #[serde(tag = "type", rename_all = "lowercase", rename_all_fields = "camelCase")]
  pub enum ConnectionStatus {
      Connecting,
      Connected { #[serde(skip_serializing_if = "Option::is_none")] active_db: Option<String> },
      Disconnected,
      Error { message: String },
  }
  ```
- `src-tauri/src/state/active_connections.rs` — `Connecting` 진입/탈출 transition (connect IPC 시작 ~ pool ready).
- `src-tauri/tests/connection_status_serde.rs` — 4-case wire regression:
  - `Connecting → {"type":"connecting"}`
  - `Connected{Some("foo")} → {"type":"connected","activeDb":"foo"}`
  - `Connected{None} → {"type":"connected"}` (activeDb 필드 생략)
  - `Error{message:"bad"} → {"type":"error","message":"bad"}`
- `src/types/connection.ts` — TS discriminated union 동일하게:
  ```ts
  type ConnectionStatus =
    | { type: "connecting" }
    | { type: "connected"; activeDb?: string }
    | { type: "disconnected" }
    | { type: "error"; message: string };
  ```
- `src/stores/connectionStore.ts` — `activeStatuses` 타입 갱신, switch exhaustiveness 보장.

## Out of Scope

- Cross-window broadcast of status change (sprint-365 의 receiver table 에서 처리).
- Connection status UI badge 색상 (별 작업).

## Invariants

- 기존 `Connected` (no fields) → `Connected { active_db: None }` 마이그. wire 호환 — 4 case serde regression 으로 보호.
- `Connecting` variant 진입 시점: connect IPC 시작 ~ pool 첫 acquire 성공 (또는 fail) 사이.
- `active_db` 는 PG `USE db` 결과 또는 connection string 의 `dbname`.

## Acceptance Criteria

- `AC-364-01` 4-case serde regression test 모두 PASS. Test: `connection_status_serde.rs`.
- `AC-364-02` `Connected { active_db: None }` → wire 에 `activeDb` 필드 부재 (`skip_serializing_if`). Test: serde_json output 검사.
- `AC-364-03` `Connecting` 진입: `connect` IPC 호출 → pool acquire 전에 `state.active_connections[conn_id] = Connecting`. Pool ready → `Connected { active_db: ... }`. Fail → `Error { message: ... }`. Test: state transition log.
- `AC-364-04` TS exhaustiveness: `switch (status.type)` 의 4 branch 가 모두 type-narrow. 누락 시 TS compile fail. Test: type-check.
- `AC-364-05` `connectionStore.activeStatuses[connId]` 가 새 union 사용. 기존 boolean / string flag 모두 갱신. Test: store unit.

## Design Bar / Quality Bar

- TDD: serde regression 4 case 먼저 (red — enum 확장 전). 구현 → green.
- `#[serde(skip_serializing_if = "Option::is_none")]` 필수 — `activeDb: null` 이 wire 에 나타나면 test fail (codex 3차 #6).
- `Connecting` 상태 long-running connect (5s+) 시 사용자에게 spinner — UI hook 은 별 sprint, 본 sprint 는 enum + state machine 만.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test connection_status_serde`
3. `pnpm vitest run src/stores/connectionStore.test.ts`
4. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- 4 case serde raw 결과.
- State transition trace (connect → Connecting → Connected | Error).
- TS exhaustiveness check (no `never` errors).

## Test Requirements

- Cargo unit: serde regression.
- Vitest: store unit.
- Coverage: `models/connection.rs` 변경 라인 + TS union 100% (exhaustiveness 강제).
- Scenario: (a) Connecting → Connected{Some}, (b) Connecting → Connected{None}, (c) Connecting → Error, (d) wire serde 4-case.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test connection_status_serde`
3. `pnpm vitest run src/stores/connectionStore.test.ts`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. cancel / affinity (sprint-359) 변경 0.
- Merge order: 361 무관 (codex 피드백). 365 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- 4 case serde regression green

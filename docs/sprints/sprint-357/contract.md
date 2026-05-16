# Sprint Contract: sprint-357

## Summary

- Goal: Phase 1 `get_initial_app_state()` snapshot IPC 도입 + Q9 perf (p95 < 50ms, 10 connections 시드).
- Audience: state-management-strategy Q9 — boot 시 atomic snapshot 으로 일관된 hydration.
- Owner: Generator (sprint-357)
- Verification Profile: `mixed` (cargo test + cargo clippy + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/commands/snapshot.rs` — `get_initial_app_state()` IPC.
  - 단일 read transaction 안에서 boot critical store 읽기.
  - 반환 shape 는 **state-management-strategy F.2 (line 911–998) 와 byte-equivalent** — `InitialAppState`:
    ```ts
    {
      schemaVersion: 1,
      snapshotVersion: number,    // monotonic per boot, frontend dedup baseline
      generatedAt: number,        // unix ms
      partial: boolean,           // true if any store hydrate fail
      stores: {
        connections: { items, groups } | { error },
        workspaces:  { byConnectionId } | { error },   // window scope 한정 (launcher → {})
        mru:         { recentConnections, lastUsedConnectionId } | { error },
        theme:       { themeId, mode } | { error },
        safeMode:    { mode } | { error },
      },
      runtime: { activeStatuses: Record<ConnId, ConnectionStatus> }
    }
    ```
  - `favorites` / `queryHistory` / `schemaCache` / `datagrid_prefs` 는 boot critical 아님 — lazy IPC (`get_all_favorites` / `list_history` / `get_datagrid_prefs`) 로 mount 시 fetch. snapshot 에 포함 0.
  - Window scope: command signature 가 `window: tauri::Window` 인자 받아 `window.label()` 사용. Launcher → workspaces 빈 object. Workspace → 그 conn 만 (codex 2차 #8).
- `src/lib/tauri/snapshot.ts` — frontend wrapper.
- 단위 / integration 테스트:
  - `src-tauri/tests/snapshot_shape.rs` — 5 stores (connections / workspaces / mru / theme / safeMode) + runtime.activeStatuses 확인. `favorites` / `queryHistory` / `schemaCache` / `datagrid_prefs` 미포함 (lazy IPC) 확인.
  - `src-tauri/tests/snapshot_perf.rs` — 10 connection + 50 tab + 500 history 시드 후 100회 반복 p95 < 50ms.
  - `src-tauri/tests/snapshot_atomic.rs` — read transaction 동안 다른 write commit → snapshot 일관.

## Out of Scope

- Frontend hydrate 호출 (sprint-365 / sprint-367).
- Listener 등록 순서 검증 (sprint-367).
- 도메인별 dual-write (sprint-358).

## Invariants

- Snapshot 의 read transaction 자체는 atomic — partial in-transaction 상태 노출 0. 단 store 별 hydrate 실패 시 `stores.<name> = { error }` + `partial: true` 반환 가능 (F.2 line 918, 1125 정합) — 즉 client 가 partial 인지 명시적으로 알 수 있음.
- Snapshot 응답 shape 는 wire-frozen — Part F.2 의 boot critical 5 stores + `runtime.activeStatuses` 와 일치.
- `version_per_domain` 단조 증가 — 후속 event 의 dedup 기준.
- p95 < 50ms — 10 connection 시드 환경.

## Acceptance Criteria

- `AC-357-01` IPC shape (F.2 line 911–998 정합): 응답이 `schemaVersion=1` + `snapshotVersion: number` + `generatedAt: number` + `partial: boolean` + `stores: { connections, workspaces, mru, theme, safeMode }` + `runtime.activeStatuses`. Test: `snapshot_shape.rs` 9 키 assert.
- `AC-357-02` Atomic 보장: snapshot 시작 후 다른 thread 가 `connections` insert 해도 snapshot 결과는 시작 시점 상태. Test: `snapshot_atomic.rs`.
- `AC-357-03` Window scope: launcher window 호출 시 `stores.workspaces.byConnectionId === {}`. Workspace window (`workspace-conn-1`) 호출 시 그 conn 의 sub-workspaces 만. Test: window mock + scope assert.
- `AC-357-04` `snapshotVersion` 단조 증가 — 같은 process 내 두 번 호출 시 `s2.snapshotVersion > s1.snapshotVersion`. Frontend 의 event dedup baseline. Test.
- `AC-357-05` Perf p95 < 50ms: 10 connection × 50 tab 시드 → 100회 호출 → p95 측정. Test: `snapshot_perf.rs`.
- `AC-357-06` Empty DB 시: `stores.*` 모두 default ({} / null), `partial: false`, runtime.activeStatuses {}. Test.
- `AC-357-07` Partial: 한 store hydrate 실패 시뮬 → 그 store 만 `{ error }` 반환 + `partial: true`. 다른 store 정상. Test.

## Design Bar / Quality Bar

- TDD: shape test 먼저 (red) → 구현 → perf test (red 가능 — 첫 구현이 N+1 쿼리면 fail) → 최적화.
- 단일 read transaction (`BEGIN IMMEDIATE; SELECT...; COMMIT;` — strategy F.2 line 1122 정합) — sqlx `sqlite::SqlitePool::begin()` + `IMMEDIATE` 옵션.
- N+1 회피: 가능한 한 single SELECT + JSON aggregate (`json_group_array`).
- 테스트 작성 날짜 + 사유 코멘트.
- `cargo clippy --all-targets --all-features -- -D warnings` clean.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test snapshot_shape`
3. `cd src-tauri && cargo test -p table-view-lib --test snapshot_atomic`
4. `cd src-tauri && cargo test -p table-view-lib --test snapshot_perf -- --release`
5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- p95/p99 raw 측정 (100회 호출 표).
- Atomic test 의 concurrent writer race 시퀀스 시각화 (timeline log).
- shape assert 9 key raw.

## Test Requirements

- Cargo integration: 3 test 파일.
- Coverage: `src-tauri/src/commands/snapshot.rs` 70%.
- Scenario: (a) empty, (b) typical 10 conn, (c) max 100 history, (d) atomic vs writer.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test snapshot_shape --test snapshot_atomic`
3. `cd src-tauri && cargo test -p table-view-lib --test snapshot_perf -- --release --nocapture`
4. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope 만.
- Merge order: 355 이후. 358 / 365 가 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 7/7 PASS
- p95 < 50ms 측정 evidence

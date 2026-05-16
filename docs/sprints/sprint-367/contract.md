# Sprint Contract: sprint-367

## Summary

- Goal: Phase 4 snapshot hydration + listener pre-register + boot hydrate < 100ms. `loadAllFromSnapshot()` 호출 → 5 store hydrate. `listen("state-changed")` 가 `get_initial_app_state()` IPC 호출 **이전** 등록 (codex 2차 #12).
- Audience: state-management-strategy Phase 4 — boot 시 atomic snapshot 으로 일관 hydration + listener buffer 가 missed event 막음.
- Owner: Generator (sprint-367)
- Verification Profile: `mixed` (cargo test + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/main.tsx` 또는 `src/lib/boot.ts` — boot sequence:
  1. `listen("state-changed", handler)` 등록 (listener buffer 시작).
  2. `loadAllFromSnapshot()` 호출 → `get_initial_app_state()` IPC.
  3. 응답으로 **boot critical 5 store** hydrate (F.2 의 `stores`): `connections` (+ groups 는 `stores.connections.groups`) / `workspaces` / `mru` / `theme` / `safeMode` + `runtime.activeStatuses` mirror.
  4. 그 사이 누적된 listener buffer event 적용 (`snapshotVersion` 기준 dedup).
  5. `favorites` / `queryHistory` / `schemaCache` / `datagrid_prefs` 는 lazy — mount 시 IPC.
- `src/lib/snapshot/loadAll.ts` — orchestrator.
- 단위 / integration:
  - `src/lib/snapshot/loadAll.timing.test.ts` — hydrate < 100ms (fake IPC 시드).
  - `src/lib/snapshot/loadAll.listener-order.test.ts` — listener 가 IPC 이전 등록 검증.
  - `src-tauri/tests/snapshot_listener_buffer.rs` — backend 가 snapshot handler 안에서 emit_all 시 frontend listener 가 receive 검증.

## Out of Scope

- 9 domain receiver 본문 (sprint-365).
- LS retire — theme/safeMode (sprint-368), datagrid prefs (sprint-369).
- `useCurrentWindowConnectionId` (sprint-366).

## Invariants

- Listener 등록은 IPC 이전 — boot 순서 strict.
- snapshot 적용 후 store 가 consistent — partial hydrate 0.
- < 100ms (fake fast IPC 환경). Real IPC perf 는 sprint-357 의 < 50ms 가 backend baseline.
- 5 store 의 hydrate path 가 await Promise.all — 직렬 hydrate 금지.

## Acceptance Criteria

- `AC-367-01` `loadAllFromSnapshot()` 호출 후 boot critical 5 store hydrate 상태 — `connections (items+groups)` / `workspaces` / `mru` / `theme` / `safeMode` + `runtime.activeStatuses` mirror. `favorites`/`queryHistory`/`datagrid_prefs` 는 hydrate 안 됨 (lazy). Test: `loadAll.timing.test.ts` shape assert.
- `AC-367-02` Hydrate timing < 100ms — fake `get_initial_app_state` 응답 (50ms 시뮬) + store mutate < 50ms total. Test: timing assert.
- `AC-367-03` Listener 등록 순서: 코드 grep 으로 `listen("state-changed"` 줄이 `getInitialAppState(` 호출 줄보다 위. Test: AST inspector 또는 grep.
- `AC-367-04` Listener buffer: snapshot 응답 전에 backend 가 fake `state-changed` emit → snapshot 적용 후 그 event 가 적용됨 (store mutate 1회). Test: `loadAll.listener-order.test.ts` (vitest 또는 cargo integration).
- `AC-367-05` Snapshot 실패 시 (IPC reject) → 빈 store + 사용자에게 error toast + retry button. Listener 는 등록된 채로 유지 (다음 retry 후 적용). Test: failure path.

## Design Bar / Quality Bar

- TDD: `loadAll.timing.test.ts` 의 `expect(duration).toBeLessThan(100)` red → 구현 → green.
- Store hydrate 는 `Promise.all([connections.hydrate(snap.stores.connections), workspaces.hydrate(snap.stores.workspaces), mru.hydrate(snap.stores.mru), theme.hydrate(snap.stores.theme), safeMode.hydrate(snap.stores.safeMode), connectionStore.mirrorRuntime(snap.runtime.activeStatuses)])`. `favorites` / `queryHistory` / `datagrid_prefs` 는 본 hydrate 안 들어감 — mount 시 lazy IPC.
- Listener handler 는 boot 직후 noop (snapshot 미적용 상태) — buffer 에 event 쌓이게 함. Snapshot 적용 후 buffer drain.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/snapshot`
2. `pnpm vitest run` (full)
3. `cd src-tauri && cargo test -p table-view-lib --test snapshot_listener_buffer`
4. `pnpm tsc --noEmit && pnpm lint`

### Required Evidence

- Hydrate timing raw (5 store × p50/p95).
- Listener 등록 line 번호 + IPC 호출 line 번호 (boot.ts 코드).
- Buffer drain test 시퀀스 trace.

## Test Requirements

- Vitest: hydrate + listener order + buffer.
- Cargo integration: backend emit timing.
- Coverage: `src/lib/snapshot/**` 80%.
- Scenario: (a) clean boot, (b) snapshot fail + retry, (c) buffer drain, (d) listener pre-register.

## Test Script / Repro Script

1. `pnpm vitest run src/lib/snapshot/loadAll.timing.test.ts src/lib/snapshot/loadAll.listener-order.test.ts`
2. `cd src-tauri && cargo test -p table-view-lib --test snapshot_listener_buffer`
3. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 도메인 store internals 변경 0.
- Merge order: 357 + 361 + 364 + 365 + 366 이후. 368 / 369 / 370 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 5/5 PASS
- hydrate < 100ms timing evidence

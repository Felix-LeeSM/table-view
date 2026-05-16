# Sprint Contract: sprint-365

## Summary

- Goal: Phase 3 cross-window event delivery — `state-changed` infra (`AppHandle::emit_all` wrapper) + 9 domain routing + version dedup + self-echo skip + version gap refetch + reset op no-refetch + test harness window.
- Audience: state-management-strategy Q4 + F.4 — multi-window 일관성의 핵심 메커니즘.
- Owner: Generator (sprint-365)
- Verification Profile: `mixed` (cargo test + cargo clippy + e2e + pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src-tauri/src/events.rs` — `emit_state_changed(app, payload)` wrapper. Payload shape (F.4 `StateChangedPayload`) 직접 사용. Backend 가 `domain` 별 `version` 갱신 + `originWindow` (caller label).
- `src/lib/events/stateChanged.ts` — frontend listener 등록 helper. `(payload) => switch (domain) → call domain handler`.
- 9 domain receivers:
  - `connection` (create/update/delete/reorder → `get_all_connections` refetch; status → `get_runtime_status` refetch)
  - `group` (create/update/delete/reorder → `get_all_groups`)
  - `mru` (bulk → `get_mru`)
  - `favorite` (create/update/delete/reorder → `get_all_favorites`)
  - `setting` (update → `get_setting`, reset → no refetch + frontend default)
  - `workspace` (update → `parseWorkspaceLabel(getCurrentWindow().label) === entityId` 일 때만 `get_workspace_snapshot` — sprint-361 의 label parser 직접 사용, hook 미사용)
  - `history` (create → mount 중이면 visible page refetch; clear → entries=[] reset)
  - `schemaCache` (invalidate → `schemaStore.clearForConnection` + sidebar mount 중이면 refetch)
  - `datagridColumnPrefs` (update → mount 중이면 `get_datagrid_prefs(decode(entityId))`; reset → field 별 default)
- `src-tauri/src/state/event_version.rs` — `version_per_entity: HashMap<(Domain, EntityId), u64>`. emit 시 increment + payload 에 포함.
- Frontend `lastApplied: Map<(domain, entityId), version>` — 같은 version 재수신 drop, version < lastApplied drop.
- Self-echo skip — `originWindow === currentWindowLabel` 시 mutate skip, `version` 만 갱신.
- Version gap refetch — 수신 `payload.version > lastApplied + 1` 시 그 domain 전체 refetch (소실 event 보호).
- e2e test harness window (`e2e/test-harness-window.html` 등) — fake schemaStore 보유, mutate 경로 검증.
- 테스트:
  - `src-tauri/tests/emit_state_changed_payload.rs`.
  - `src/lib/events/stateChanged.test.ts` — 9 domain × 1+ case.
  - `src/lib/events/dedup.test.ts` — version dedup.
  - `src/lib/events/self-echo.test.ts`.
  - `src/lib/events/version-gap.test.ts`.
  - `e2e/cross-window-event-delivery.e2e.ts` — workspace window A 의 DDL → launcher 가 50ms 안에 event 수신 + harness window mutate 검증.

## Out of Scope

- `useCurrentWindowConnectionId()` hook (sprint-366). 본 sprint 의 workspace receiver 는 hook 안 쓰고 `parseWorkspaceLabel(getCurrentWindow().label)` (sprint-361) 직접 호출 — 순환 의존 회피.
- 도메인별 store 의 실제 IPC fetch (이미 존재).
- ADR-0033 cross-window event ADR 본문 (sprint-374).

## Invariants

- emit_state_changed 는 같은 entity 의 mutate 직렬화 — entity-level mutex (backend) 보장.
- `version` 단조 증가 per (domain, entityId).
- self-echo skip 후 lastApplied version 갱신 — 이후 stale detection 정확.
- reset op 는 refetch 안 함 (codex 6차 #4).
- 9 domain 모두 receiver 등록 사이트 존재 — grep CI.

## Acceptance Criteria

- `AC-365-01` `emit_state_changed(app, payload)` 호출 시 모든 active window listener 가 payload 수신. Test: e2e launcher + 2 workspace 띄움.
- `AC-365-02` Version dedup: 같은 (domain, entityId, version) 두 번 수신 시 두 번째 drop. Test: dedup unit.
- `AC-365-03` Self-echo skip: `originWindow === currentWindowLabel` 시 mutate handler 호출 0회, `lastApplied[(domain, entityId)] = version`. Test: self-echo unit.
- `AC-365-04` Version gap refetch: `lastApplied = 5`, 수신 `version = 7` → domain 전체 refetch IPC 1회 호출. Test: gap unit.
- `AC-365-05` Reset op no-refetch: `domain:"setting", op:"reset", entityId:"theme"` 수신 → `get_setting("theme")` IPC 호출 0회, `themeStore.set(SETTING_DEFAULTS.theme)` 1회. Test.
- `AC-365-06` `datagridColumnPrefs` reset field 별 분기: `field:"widths"` → widths 만 default, hiddenColumns 유지. `field:"hiddenColumns"` → 반대. `field:"all"` → 둘 다. Test 3 케이스.
- `AC-365-07` 9 domain 각각 receiver 등록 사이트 존재 — grep CI: `addEventListener.*state-changed` 또는 `listen("state-changed",` 사용 + domain switch 안 9 case 모두. Test.
- `AC-365-08` Cross-window e2e: workspace A 의 DDL → harness window 가 50ms 안에 `schemaStore.clearForConnection` 호출. Test: `cross-window-event-delivery.e2e.ts`.
- `AC-365-09` History clear event: `{domain:"history", op:"clear", entityId:null}` 수신 → mounted history panel 의 `entries=[]` set + page reset. refetch 0. Test.

## Design Bar / Quality Bar

- TDD: 9 domain receiver test 먼저 (red) — emit_state_changed 등록 전엔 fail. 구현 → green.
- `lastApplied` 는 frontend Map (Window-local). 영속 안 함 — boot 시 빈 상태에서 시작.
- self-echo 식별은 `getCurrentWindow().label` 과 `payload.originWindow` 문자열 비교.
- e2e harness window 는 별 HTML — Vite build 안 들어감, e2e 전용 fixture.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test emit_state_changed_payload`
3. `pnpm vitest run src/lib/events`
4. `pnpm test:e2e:docker -- e2e/cross-window-event-delivery.e2e.ts`
5. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`

### Required Evidence

- 9 domain receiver 각각의 test name + 호출 결과.
- self-echo + dedup + gap 3 보호 mechanism 단위 결과.
- e2e harness mutate 호출 timing log.

## Test Requirements

- Cargo: emit wrapper.
- Vitest: 9 receiver + 3 mechanism + reset field.
- e2e: cross-window delivery.
- Coverage: `src-tauri/src/events.rs` + `src/lib/events/**` 70%.

## Test Script / Repro Script

1. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
2. `cd src-tauri && cargo test -p table-view-lib --test emit_state_changed_payload`
3. `pnpm vitest run src/lib/events`
4. `pnpm test:e2e:docker -- e2e/cross-window-event-delivery.e2e.ts`
5. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 도메인 store 의 read 사이트 (IPC fetch) 변경 0.
- Merge order: 361 + 362 + 363 + 364 이후. 366 과 무관 (label parser 만 사용). 367 / 368 / 369 / 371 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 9/9 PASS
- e2e cross-window delivery < 50ms timing evidence

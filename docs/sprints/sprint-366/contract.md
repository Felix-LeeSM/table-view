# Sprint Contract: sprint-366

## Summary

- Goal: Phase 4 `useCurrentWindowConnectionId()` hook 도입 (Q15). Workspace code path 에서 `connectionStore.focusedConnId` read 0 — workspace caller migration 전용. (sprint-365 cross-window event 는 본 hook 미사용, label parser 직접 사용.)
- Audience: state-management-strategy Q15 + L2 — connection scope 가 window 단위로 derive.
- Owner: Generator (sprint-366)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- `src/hooks/useCurrentWindowConnectionId.ts` — Tauri `getCurrentWindow().label` 에서 `parseWorkspaceLabel(label)` 호출, `connection_id | null` 반환. launcher window 에선 null.
- Workspace code path 변경 사이트:
  - `src/components/layout/Sidebar.tsx:55` — `useConnectionStore(s => s.focusedConnId)` → `useCurrentWindowConnectionId()`.
  - `src/stores/workspaceStore.ts:854` — store action 안 `focusedConnId` read 사이트 → hook 으로 derive (불가능 시 action signature 에 `connId` 인자 추가).
  - 기타 `src/components/datagrid/**`, `src/components/query/**`, `src/components/schema/**`, `src/components/document/**`, `src/components/rdb/**` 의 `focusedConnId` read 사이트.
- `src/test/workspaceStoreTestHelpers.ts` — `focusedConnId` set helper retire. 대신 RTL test 에서 fake `WindowConnectionId` provider (mock `getCurrentWindow`).
- `src/test/fakeWindowConnectionId.tsx` — test provider helper.
- 단위 / RTL 테스트:
  - `src/hooks/useCurrentWindowConnectionId.test.tsx` — launcher null + workspace conn id derive.
  - 기존 RTL 테스트 mock helper 사용으로 갱신 (compile-time check).
- ESLint rule 또는 grep test: workspace path 에서 `focusedConnId` 사용 시 fail.

## Out of Scope

- Launcher 의 `connectionStore.focusedConnId` 자체 (launcher 에서만 mutate/read 허용).
- Cross-window event filtering (sprint-365 — label parser 직접 사용, hook 미사용).
- Window label per-conn migration (sprint-361 — 이미 완료).

## Invariants

- Launcher window 에서 hook 호출 → `null`.
- Workspace window 에서 hook 호출 → 그 window 의 connection id (label parse 결과).
- 기존 launcher 의 `focusedConnId` UI 호환 — read 사이트 그대로.
- Workspace tree 의 `focusedConnId` read 0 — grep CI 강제.
- Test helper retire — 기존 RTL 테스트 mock provider 로 갱신.

## Acceptance Criteria

- `AC-366-01` Launcher 마운트 (label `"launcher"`) 에서 `useCurrentWindowConnectionId()` → `null`. Test: hook unit.
- `AC-366-02` Workspace 마운트 (label `"workspace-conn-1"`) 에서 hook → `"conn-1"`. Test.
- `AC-366-03` Invalid label (e.g. `"some-window"`) → `null`. Test.
- `AC-366-04` Sidebar.tsx 의 connId source 가 hook 으로 변경 — Test: RTL mount + fake provider → sidebar 가 받은 connId 일치.
- `AC-366-05` Workspace tree 의 `focusedConnId` read 0 — grep CI: `rg "connectionStore.*focusedConnId" src/components/layout/Sidebar.tsx src/components/datagrid/ src/components/query/ src/components/schema/ src/components/document/ src/components/rdb/ src/stores/workspaceStore.ts` 결과 0건.
- `AC-366-06` Test helper 마이그 — `workspaceStoreTestHelpers.ts` 의 `focusedConnId` set helper 삭제 또는 launcher-only path 로 분리. 기존 workspace tree RTL 테스트 모두 새 fake provider 사용 → green.
- `AC-366-07` Launcher 의 connection list / group UI 는 `connectionStore.focusedConnId` 유지 (회귀 0). Test: ConnectionList RTL.

## Design Bar / Quality Bar

- TDD: hook 의 launcher null / workspace conn id 단위 테스트 먼저 → 구현 → workspace tree caller 마이그.
- 마이그는 한 컴포넌트씩 — 각 컴포넌트의 기존 RTL 테스트가 fake provider 도입 후에도 green.
- ESLint custom rule (선택) 또는 `scripts/grep-focusedConnId-in-workspace.sh` CI step.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/hooks/useCurrentWindowConnectionId.test.tsx`
2. `pnpm vitest run src/components/layout/Sidebar.test.tsx`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`
5. `bash scripts/grep-focusedConnId-in-workspace.sh` (0 result → success)

### Required Evidence

- Hook unit 3 case raw.
- grep CI raw 결과.
- Workspace tree caller 마이그 인벤토리 (handoff 표).

## Test Requirements

- Vitest: hook + caller 회귀.
- Coverage: `useCurrentWindowConnectionId` 100%.
- Scenario: (a) launcher, (b) workspace, (c) invalid label, (d) caller 회귀.

## Test Script / Repro Script

1. `pnpm vitest run src/hooks/useCurrentWindowConnectionId.test.tsx`
2. `pnpm vitest run src/components/layout/Sidebar.test.tsx`
3. `pnpm vitest run` (full)
4. `pnpm tsc --noEmit && pnpm lint`
5. `bash scripts/grep-focusedConnId-in-workspace.sh`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. launcher path (`src/pages/HomePage.tsx`, `src/components/connection/**`) 의 `focusedConnId` 사이트는 변경 0.
- Merge order: 361 이후. 365 는 본 hook 미사용 (label parser 직접), 365 와 병렬 가능. 367 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 7/7 PASS
- grep CI: focusedConnId in workspace path 0

# Sprint Contract: sprint-134

## Summary

- Goal: Toolbar의 `ConnectionSwitcher`를 완전 제거하고 Home double-click을 단일 connection-swap 경로로 통합. Workspace에 Disconnect 버튼 추가, dirty marker가 active tab이 아닌 실제 dirty tab에 그려지도록 수정.
- Audience: Phase 10 사용자 점검 결과(#1 popover 크기 / #2 swap 안 됨 / #6 disconnect / #9 dirty marker 위치)를 닫는다.
- Owner: Generator (general-purpose)
- Verification Profile: `mixed` (vitest + tsc + lint + cargo + e2e static)

## In Scope

- DELETE `src/components/workspace/ConnectionSwitcher.tsx` + `ConnectionSwitcher.test.tsx`
- MODIFY `src/components/workspace/WorkspaceToolbar.tsx` (+ test) — ConnectionSwitcher import/렌더 제거. Toolbar 좌측이 비게 되면 자연스러운 leading layout 유지.
- MODIFY `src/App.tsx` — Cmd+K useEffect (open-connection-switcher dispatch) 제거. Cmd+, / Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S 보존.
- MODIFY `src/App.test.tsx` — Cmd+K 시나리오를 "no-op (deprecated, no event dispatched)" 어서션으로 갱신.
- MODIFY `src/components/shared/ShortcutCheatsheet.tsx` (+ test) — "Open connection switcher" / "Cmd+K" 항목 제거.
- MODIFY `src/components/connection/ConnectionItem.tsx` 또는 `ConnectionList.tsx` 또는 `src/pages/HomePage.tsx` — double-click이 다른 connection에 했을 때도 active swap을 호출하도록 (현재는 focus만 이동하고 active connection 변경이 안 됨).
- CREATE `src/components/workspace/DisconnectButton.tsx` + `DisconnectButton.test.tsx` — refresh 인접 위치에 mount, click 시 connection disconnect.
- MODIFY `src/components/layout/MainArea.tsx` (또는 refresh 호스트) — DisconnectButton mount.
- MODIFY `src/components/layout/TabBar.tsx` (+ test) — dirty marker가 `dirtyTabIds.has(tab.id)` 기반으로만 그려지도록 보장 + 회귀 가드 vitest test.
- E2E: 변경에 맞춰 `e2e/keyboard-shortcuts.spec.ts`의 "Cmd+K opens connection switcher" 시나리오 제거 또는 deprecated assertion으로 갱신.

## Out of Scope

- SchemaSwitcher 제거 (S135).
- Sidebar single-click preview semantics (S136).
- Mongo switch-DB stale (S137).
- DBMS-aware connection form (S138).
- Paradigm-aware query editor (S139).
- 암호화 export/import (S140).
- 새 keyboard shortcut 추가.

## Invariants

- Cmd+, (Home/Workspace toggle), Cmd+1..9 (tab switch), Cmd+W/T/S (close/new/save tab), Cmd+N (new connection), Cmd+P (Quick Open) 동작 유지.
- DbSwitcher (toolbar의 DB 전환) 동작 유지.
- 기존 Connection list / Group / Drag-drop / Favorites / Quick Look 동작 유지.
- 기존 connectionStore 시그니처 (`setActiveConnection`, `connectToDatabase`, `disconnectFromDatabase`) 유지.
- E2E 기존 스펙(Cmd+, toggle 시나리오 포함) 미파손.

## Acceptance Criteria

- `AC-S134-01` ConnectionSwitcher 컴포넌트 + 테스트 삭제, WorkspaceToolbar 미참조, `pnpm tsc --noEmit` 0 에러.
- `AC-S134-02` Cmd+K 핸들러 제거, App.test.tsx Cmd+K 시나리오 갱신 (no-op).
- `AC-S134-03` ShortcutCheatsheet에서 Cmd+K/connection switcher 항목 제거 + 동봉 테스트 갱신.
- `AC-S134-04` Home에서 다른 connection double-click → activeId/focusedId/screen이 새 connection으로 swap. 신규 vitest test.
- `AC-S134-05` Workspace에 `<DisconnectButton aria-label="Disconnect">` 가 refresh 인접에 mount, click 시 disconnectFromDatabase 호출, disconnected 상태에서 disabled.
- `AC-S134-06` Dirty marker는 `dirtyTabIds.has(tab.id)` 기반으로만 그려진다 — active와 무관. 신규 vitest test 2개 (dirty != active 케이스).
- `AC-S134-07` 회귀 가드: Cmd+1..9 / Cmd+, / Cmd+W / Cmd+T / Cmd+S 기존 테스트 그린, e2e static lint 그린.
- `AC-S134-08` 6 게이트 그린: vitest, tsc, lint, contrast, cargo test, cargo clippy.

## Design Bar / Quality Bar

- DisconnectButton: 다크 모드 + tooltip + disabled 상태 시각 단서 + busy state(loading) 표현.
- `assertNever` 또는 명시적 type narrow 사용 — `any` 금지.
- 신규 컴포넌트 1 file 1 컴포넌트, PascalCase 파일명, props는 interface로 export.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 신규/수정 vitest 포함 그린.
2. `pnpm tsc --noEmit` — 0 에러.
3. `pnpm lint` — 0 에러.
4. `pnpm contrast:check` — 0 새 위반.
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 그린 (이 sprint는 Rust 변경 없음).
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0 경고.
7. e2e static: `pnpm exec eslint e2e/**/*.ts` — 0 에러.

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - 7개 verification command output
  - 8개 AC 각각에 대응하는 vitest test 파일/이름 + grep 결과(예: `grep -r ConnectionSwitcher src/` 0건)
- Evaluator must cite:
  - 각 AC pass/fail 결정에 대한 구체 증거 (테스트 이름, grep 출력, diff hunk)
  - 누락된 증거를 finding으로 기록

## Test Requirements

### Unit Tests (필수)
- AC-S134-04: HomePage / ConnectionList double-click swap test
- AC-S134-05: DisconnectButton.test.tsx (click → disconnect, disabled state, aria-label)
- AC-S134-06: TabBar dirty marker test (dirty != active 2 케이스)
- AC-S134-02: App.test.tsx Cmd+K no-op assertion
- AC-S134-03: ShortcutCheatsheet test 갱신

### Coverage Target
- 신규/수정 파일 라인 70% 이상.

### Scenario Tests (필수)
- [ ] Happy path: Home에서 connectionA active 상태 → connectionB double-click → connectionB로 swap
- [ ] 에러/예외: disconnect 실패 시 toast + 버튼 enabled 복귀
- [ ] 경계 조건: active connection 자기 자신 double-click → no-op (또는 swap to workspace)
- [ ] 기존 기능 회귀 없음: Cmd+, toggle, Cmd+1..9 tab swap

## Test Script / Repro Script

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
7. `pnpm exec eslint e2e/**/*.ts`
8. `grep -rn "ConnectionSwitcher" src/ docs/sprints/sprint-134` — 코드는 0 hits, spec/contract만 hits.

## Ownership

- Generator: general-purpose agent (single attempt scope)
- Write scope: `src/components/workspace/`, `src/components/layout/`, `src/components/connection/`, `src/components/shared/`, `src/pages/`, `src/App.tsx`, `e2e/keyboard-shortcuts.spec.ts`
- Merge order: S134 → S135 → … → S140 (chain)

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes`
- Acceptance criteria evidence linked in `handoff.md`

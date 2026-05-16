# Sprint Contract: sprint-368

## Summary

- Goal: Phase 4 theme/safeMode SOT 전환 (Q12). `setTheme` / `setSafeMode` 액션 → IPC `set_setting` (backend-first) → SQLite write → `emit_all` → 모든 window mutate. theme 만 LS sync (FOUC cache), safeMode LS write 0. Theme 변경 cross-window 50ms 안에 적용.
- Audience: state-management-strategy Q12 — theme + safeMode 의 SQLite SOT 전환, theme FOUC 보호.
- Owner: Generator (sprint-368)
- Verification Profile: `mixed` (cargo test + pnpm vitest + e2e + pnpm tsc + pnpm lint)

## In Scope

- `src/stores/themeStore.ts` — `setTheme(value)` 액션:
  - 1. IPC `set_setting("theme", value)` 호출.
  - 2. 응답 후 store mutate (`state.theme = value`).
  - 3. LS `table-view-theme` sync write (다음 boot FOUC cache).
  - 4. 직접 LS write 호출 0 (action 안에서만, optimistic 직접 LS 0).
- `src/stores/safeModeStore.ts` — `setSafeMode(value)` 액션:
  - 1. IPC `set_setting("safe_mode", value)` 호출.
  - 2. 응답 후 store mutate.
  - 3. LS write 0 (`view-table.safeMode` 사용 안 함).
- `src/lib/themeBoot.ts:10` — `THEME_STORAGE_KEY` 가 boot FOUC cache 의 read 사이트로 그대로 유지. write 사이트 0 (action 만 write).
- Event listener (sprint-365 기반) — `domain:"setting", op:"update", entityId:"theme"` 수신 시 `get_setting("theme")` refetch + store mutate + LS sync. `entityId:"safe_mode"` 수신 시 IPC refetch + store mutate (LS 미접촉).
- 단위 / RTL / e2e:
  - `src/stores/themeStore.setTheme.test.ts`
  - `src/stores/safeModeStore.setSafeMode.test.ts`
  - `src/stores/themeStore.cross-window-event.test.ts` — event 수신 시 mutate + LS sync.
  - `e2e/theme-cross-window-50ms.e2e.ts` — workspace A 에서 theme 변경 → launcher + workspace B 가 50ms 안에 적용.
  - `e2e/safe-mode-cross-window.e2e.ts`.
  - `src/lib/themeBoot.test.ts` — FOUC 0 시뮬 (SQLite 의 theme 값이 LS 와 다를 때 첫 paint 는 LS 값, 그 후 silent 갱신).

## Out of Scope

- LS retire 의 다른 도메인 (datagrid prefs / non-store — sprint-369).
- W2 dual-read 전체 도메인 gate (sprint-370).
- `set_setting` IPC backend (이미 sprint-358 에서 settings dual-write 와 함께 도입). 본 sprint 는 frontend action + event listener.

## Invariants

- `setTheme` / `setSafeMode` 호출 → IPC 1회 + (theme 만) LS write 1회. 직접 LS write 0.
- `view-table.safeMode` LS key 의 write 사이트 0 (grep CI).
- theme LS `table-view-theme` 의 read 사이트는 `themeBoot.ts` 1곳만 (grep CI).
- Event 수신 시 mutate + LS sync — self-echo skip 은 sprint-365 의 mechanism 사용.
- 기존 theme/safeMode 의 UI 회귀 0.

## Acceptance Criteria

- `AC-368-01` `setTheme({themeId:"default", mode:"dark"})` 호출 → `set_setting("theme", {themeId:"default", mode:"dark"})` IPC 1회 + `themeStore.state` 의 `themeId === "default"` + `mode === "dark"` + LS `table-view-theme` 값이 JSON `{"themeId":"default","mode":"dark"}` (strategy F.2 line 961, F.4 line 1162 정합). Test: action unit.
- `AC-368-02` `setSafeMode("strict")` 호출 → IPC 1회 + `safeModeStore.state.value === "strict"` + LS `view-table.safeMode` write 0회. Test.
- `AC-368-03` Event 수신 (`domain:"setting", entityId:"theme", op:"update"`) → `get_setting("theme")` IPC 1회 + store mutate + LS write 1회. Self-echo 시 mutate 0, lastApplied version 갱신만. Test.
- `AC-368-04` Cross-window 50ms: workspace A 에서 setTheme → launcher + workspace B 의 `theme` 50ms 안에 변경. Test: e2e timing.
- `AC-368-05` FOUC 0: 디스크 SQLite 의 theme `{themeId:"default", mode:"dark"}` + LS `table-view-theme` `{themeId:"default", mode:"light"}` 상태에서 boot → 첫 paint `mode:"light"` (LS cache), 그 후 silent 갱신 `mode:"dark"`. Visible jump 0 (transition class). Test: `themeBoot.test.ts` jsdom simulation.
- `AC-368-06` SafeMode LS write 0 (grep CI): `rg "localStorage.setItem.*view-table.safeMode" src/` 결과 0건. Test.
- `AC-368-07` Theme LS read 사이트 1 (grep CI): `rg "localStorage.getItem.*table-view-theme" src/` 결과 `src/lib/themeBoot.ts:N` 1건만. Test.

## Design Bar / Quality Bar

- TDD: action unit (`setTheme` IPC 1회 + LS 1회) 먼저 → 구현 → cross-window e2e.
- LS sync 는 action 안에서만 — useEffect, persist middleware 의 LS 미사용 (직접 setItem).
- `themeBoot.ts` 는 boot 첫 paint 전에 sync 실행 — async IPC 안 기다림.
- 테스트 작성 날짜 + 사유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/stores/themeStore src/stores/safeModeStore src/lib/themeBoot`
2. `pnpm test:e2e:docker -- e2e/theme-cross-window-50ms.e2e.ts e2e/safe-mode-cross-window.e2e.ts`
3. `pnpm tsc --noEmit && pnpm lint && pnpm vitest run`
4. grep: `! rg -q 'localStorage\.setItem.*view-table.safeMode' src/` && `rg -c 'localStorage\.getItem.*table-view-theme' src/ | grep -q '^src/lib/themeBoot.ts:1$'`

### Required Evidence

- 7 AC test name + raw 결과.
- Cross-window timing log (e2e).
- FOUC test jsdom timeline.
- grep CI raw.

## Test Requirements

- Vitest: action + listener + FOUC.
- e2e: 2 cross-window 시나리오.
- Coverage: themeStore / safeModeStore 액션 + themeBoot 70%.

## Test Script / Repro Script

1. `pnpm vitest run src/stores/themeStore src/stores/safeModeStore src/lib/themeBoot`
2. `pnpm test:e2e:docker -- e2e/theme-cross-window-50ms.e2e.ts`
3. `pnpm tsc --noEmit && pnpm lint`

## Ownership

- Generator: general-purpose Agent.
- Write scope: In Scope. 다른 store 변경 0.
- Merge order: 358 + 365 + 367 이후. 369 와 병렬 가능. 370 본 sprint 의존.

## Exit Criteria

- Open P1/P2: 0
- AC 7/7 PASS
- Cross-window 50ms timing evidence
- grep CI: safeMode LS write 0, theme LS read 1

# Sprint Contract: sprint-133

## Summary

- **Goal**: Phase finale 마무리. 단축키 3종 추가 (Cmd+, → Home/Workspace toggle, Cmd+1..9 → workspace tab switch, Cmd+K → connection switcher 키보드 오픈) + ShortcutCheatsheet 갱신 + 신규 e2e spec 2종 (DB switcher PG+Mongo, raw-query DB-change 감지). 기존 e2e 회귀 0.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e 정적)

## Background (이미 잡힌 사실)

- `App.tsx`가 글로벌 keydown 리스너를 효과별로 분리해 보유. Cmd+W (close tab), Cmd+T (new tab), Cmd+. (cancel query), Cmd+P (quick open), Cmd+N (new connection), Cmd+S (commit), Cmd+, (현재 `open-settings` 이벤트 dispatch — 소비자 0, dead code), Cmd+R / F5 (refresh), Cmd+I (format), Cmd+Shift+T (reopen closed), Cmd+Shift+F (toggle favorites), Cmd+Shift+C (toggle global query log), Cmd+Shift+I (uglify) 등이 이미 wired.
- `appShellStore.ts`: `screen: 'home' | 'workspace'` + `setScreen(screen)`. `useAppShellStore` 훅 노출.
- `ShortcutCheatsheet.tsx` (`src/components/shared/ShortcutCheatsheet.tsx`): SHORTCUT_GROUPS array 상단 정의. Cmd+, 라벨 = "Settings" (현재 dead binding). Cmd+1..9 / Cmd+K 비등록.
- `ConnectionSwitcher` (`src/components/workspace/ConnectionSwitcher.tsx`): popover 트리거 — 키보드 오픈 hook 없음.
- e2e: `e2e/keyboard-shortcuts.spec.ts`, `e2e/paradigm-and-shortcuts.spec.ts`, `e2e/home-workspace-swap.spec.ts` 등 9개 spec 파일 (1311 LOC). DB switcher / raw-query 감지 spec 부재.
- `tauri-driver` + WDIO + Mocha 환경. spec 파일은 wdio.conf.ts의 spec glob에 포함.
- Cmd+, 의 기존 `open-settings` event는 unit test 외 소비자 0 — repurpose 안전.

## In Scope

### 단축키 3종

#### Cmd+, → Home/Workspace toggle

- `App.tsx`의 Cmd+, 분기를 `open-settings` event에서 `appShellStore.setScreen` 토글로 교체:
  - 현재 screen이 `workspace`이면 `setScreen("home")`.
  - 현재 screen이 `home`이면 `setScreen("workspace")`.
- `isEditableTarget` 가드 유지.
- `App.test.tsx:193-201`의 `"Cmd+, dispatches open-settings event"` 테스트 — Home/Workspace toggle 동작 검증으로 갱신. 더 이상 `open-settings` event 필요 없음.

#### Cmd+1..9 → workspace tab switch

- 새 useEffect — `metaKey || ctrlKey`이고 key가 1~9 (string "1".."9") 일 때:
  - `isEditableTarget` 가드.
  - `useAppShellStore`의 `screen !== "workspace"`이면 무시 (Home에서는 동작 안 함).
  - `useTabStore.getState().tabs[index]` (index = digit - 1)이 존재하면 `setActiveTabId(tab.id)`.
  - 존재하지 않으면 no-op.
  - `event.preventDefault()`.

#### Cmd+K → connection switcher open

- 새 글로벌 이벤트 `"open-connection-switcher"` dispatch from App.tsx.
- `ConnectionSwitcher.tsx`가 `useEffect`에서 `window.addEventListener("open-connection-switcher", ...)` listen → 내부 popover state `setOpen(true)`.
- `screen !== "workspace"`인 경우 dispatch 안 함 (Home에는 ConnectionSwitcher가 없음).
- `isEditableTarget` 가드.

### ShortcutCheatsheet 갱신

- `SHORTCUT_GROUPS` 갱신:
  - "Panels" group의 `{ label: "Settings", keys: ["Cmd+,"] }` → `{ label: "Toggle Home/Workspace", keys: ["Cmd+,"] }`.
  - "Tabs" group에 `{ label: "Switch to tab 1–9", keys: ["Cmd+1", "…", "Cmd+9"] }` 추가.
  - "Navigation" group에 `{ label: "Open connection switcher", keys: ["Cmd+K"] }` 추가.
- 기존 그룹 순서 유지.
- ShortcutCheatsheet 단위 테스트 (`src/components/shared/__tests__/ShortcutCheatsheet.test.tsx`) 갱신:
  - 신규 라벨 3개 텍스트 노출 검증.

### 신규 e2e spec 2종

#### `e2e/db-switcher.spec.ts`

- describe "DB switcher (Sprint 133)":
  - PG connection 테스트 (Sprint 124-125의 기존 fixture 재사용 — 예: `localhost:55432`):
    1. `pressCtrl("k")` 으로 ConnectionSwitcher 오픈 → PG connection 선택.
    2. workspace 진입 후 toolbar의 DB switcher trigger 클릭 → popover 표시.
    3. `[aria-label="Filter databases"]` (또는 popover 안의 db row) 검증.
    4. 다른 DB 선택 → trigger label 갱신 검증.
  - Mongo는 environment에 Mongo container 부재 시 `it.skip(...)` — 단 spec 컴파일은 성공해야 함. Sprint 125의 기존 fixture가 있다면 사용; 없으면 PG만 검증.
  - Required: spec 파일이 `pnpm exec wdio run wdio.conf.ts --spec='nonexistent'` 컴파일 단계에서 0 TS 에러.

#### `e2e/raw-query-db-change.spec.ts`

- describe "Raw-query DB-change detection (Sprint 133)":
  - PG fixture 가정. PG container 부재 시 `before` 훅에서 `this.skip()`.
  - 시나리오:
    1. PG 연결 + workspace 진입.
    2. New query tab → `\c admin` 입력 → 실행.
    3. backend round-trip 후 사이드바 schema 자동 재로딩 확인 (e.g. SchemaTree text가 변경).
    4. DB switcher trigger label "admin" 노출.
  - Headless 환경에서 PG fixture 없으면 `before(() => this.skip())`. spec 컴파일은 성공.

### 기존 e2e 회귀 가드

- `e2e/keyboard-shortcuts.spec.ts`의 Cmd+N / Cmd+P 시나리오 — 보존.
- `e2e/paradigm-and-shortcuts.spec.ts`, `e2e/home-workspace-swap.spec.ts`, `e2e/data-grid.spec.ts` 등 — 변경 없음. spec 컴파일 무회귀.
- 신규 시나리오는 기존 SHORTCUT_GROUPS를 깨뜨리지 않음.

## Out of Scope

- 다른 단축키 추가 / 재배치 (Cmd+1..9 외).
- 기존 e2e spec body 리팩터.
- WDIO 설정 / driver 변경.
- ConnectionSwitcher의 popover UX 재설계 — 키보드 오픈 hook만.
- HomePage 자체의 단축키 추가 (Home → Cmd+1..9 등).
- 백엔드 변경 (이번 sprint는 프런트 + e2e 만).
- mock fixture 추가 (e2e가 실 PG 없이 통과하는 시뮬레이터).

## Invariants

- 기존 vitest + cargo test 회귀 0.
- 기존 e2e 정적 컴파일 회귀 0 — wdio.conf.ts의 spec glob에 신규 파일이 자동 포함되어도 컴파일 성공해야 함.
- 사용자 시야 회귀 0:
  - PG / Mongo 워크스페이스 핵심 동작 보존.
  - 기존 단축키 보존 (Cmd+, repurpose 외).
- `appShellStore.setScreen` API 변경 0.
- `ConnectionSwitcher` 외부 props 시그니처 변경 0.
- ShortcutCheatsheet의 그룹 순서 보존.

## Acceptance Criteria

- `AC-01` `App.tsx`의 Cmd+, 분기가 `open-settings` event dispatch에서 `appShellStore.setScreen` toggle로 교체. `isEditableTarget` 가드 유지.
- `AC-02` `App.tsx`에 신규 useEffect — Cmd+1..9 → workspace tab switch. `screen !== "workspace"`면 no-op. tab index out-of-range no-op. preventDefault.
- `AC-03` `App.tsx`에 신규 useEffect — Cmd+K → `window.dispatchEvent(new CustomEvent("open-connection-switcher"))`. `screen !== "workspace"`면 no-op. preventDefault. isEditableTarget 가드.
- `AC-04` `ConnectionSwitcher.tsx`가 `"open-connection-switcher"` event listener 추가 → 내부 popover open state mutate. cleanup on unmount.
- `AC-05` `ShortcutCheatsheet.tsx`의 SHORTCUT_GROUPS 갱신 — Settings → Toggle Home/Workspace, "Switch to tab 1–9" / "Open connection switcher" 추가.
- `AC-06` `App.test.tsx:193-201`의 `open-settings` 테스트 갱신 → Home/Workspace toggle 동작 검증 (`appShellStore.setScreen` mock).
- `AC-07` `App.test.tsx`에 신규 시나리오:
  - Cmd+1 → tabs[0] 활성화.
  - Cmd+5 with only 3 tabs → no-op.
  - Cmd+, in workspace → screen="home"; Cmd+, in home → screen="workspace".
  - Cmd+K → "open-connection-switcher" event dispatched.
- `AC-08` `ConnectionSwitcher.test.tsx`에 신규 시나리오 — `"open-connection-switcher"` event 발생 시 popover open.
- `AC-09` `ShortcutCheatsheet.test.tsx`에 신규 라벨 3개 노출 검증.
- `AC-10` 신규 e2e spec 2종 (`e2e/db-switcher.spec.ts`, `e2e/raw-query-db-change.spec.ts`) 컴파일 0 에러. 실 PG 부재 시 `this.skip()` 호출로 안전한 스킵.
- `AC-11` 검증 명령 모두 그린:
  - `pnpm vitest run` (2027+ baseline)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  - e2e 정적 컴파일 회귀 0 (신규 spec 포함).
- `AC-12` 사용자 시야 회귀 0: 기존 단축키, 사이드바, DB switcher, raw-query 감지 (S132) 모두 동일하게 동작.

## Design Bar / Quality Bar

- Cmd+1..9는 "1", "2", ..., "9" string key 비교 — 숫자 키패드 (`Numpad1` 등)는 본 sprint에서 제외 (key === "1" 매치).
- isEditableTarget 가드는 모든 글로벌 단축키에 일관 적용.
- `open-connection-switcher` event는 CustomEvent (`detail` 비어 있음) — 단순한 트리거 신호.
- ShortcutCheatsheet의 keys 배열 다중 항목은 기존 패턴(`["Cmd+R", "F5"]`) 답습.
- e2e spec은 Mocha `before(() => { /* skip if no fixture */ })` 패턴 — 컴파일 무관 / runtime skip.
- 신규 e2e 파일 이름은 kebab-case + `.spec.ts` (기존 컨벤션).
- `setActiveTabId` 호출 전 tab id가 유효한지 확인.

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 2027+ 그린.
2. `pnpm tsc --noEmit` — 0.
3. `pnpm lint` — 0.
4. `pnpm contrast:check` — 0 새 위반.
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail.
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0.
7. e2e 정적 컴파일 회귀 0 (신규 + 기존 spec 모두).

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 7개 검증 명령 outcome
  - AC-01..AC-12 매핑(file:line / test:line)
  - Cmd+1..9 hook 코드 인용
  - Cmd+, repurpose 코드 인용
  - ConnectionSwitcher 이벤트 listener 코드 인용
  - ShortcutCheatsheet SHORTCUT_GROUPS 갱신 인용
  - 신규 e2e spec 컴파일 그린 증거 (TS 0 에러)
- Evaluator must cite:
  - 각 AC pass/fail 구체 evidence
  - 기존 단축키 회귀 0 (App.test.tsx 기존 시나리오 보존)
  - e2e 신규 spec 2종 TS 컴파일 그린

## Test Requirements

### Unit Tests (필수)
- `App.test.tsx`:
  - Cmd+, in workspace → setScreen("home")
  - Cmd+, in home → setScreen("workspace")
  - Cmd+, with focus in editable → no-op
  - Cmd+1 → tabs[0] activated
  - Cmd+5 with only 3 tabs → no-op
  - Cmd+1 in home → no-op
  - Cmd+K in workspace → event dispatched
  - Cmd+K in home → no event
  - 기존 Cmd+N/Cmd+P 회귀 그린
- `ConnectionSwitcher.test.tsx`:
  - "open-connection-switcher" event → popover opened
- `ShortcutCheatsheet.test.tsx`:
  - "Toggle Home/Workspace" 라벨 노출
  - "Switch to tab 1–9" 라벨 노출
  - "Open connection switcher" 라벨 노출

### Coverage Target
- 신규 코드 (App keydown effects, ConnectionSwitcher listener, SHORTCUT_GROUPS): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: Cmd+, → Home swap; 다시 Cmd+, → Workspace swap.
- [ ] Cmd+1..9: 활성 탭 전환.
- [ ] Cmd+K: ConnectionSwitcher 오픈.
- [ ] 회귀: Cmd+N (new connection), Cmd+P (quick open), Cmd+T (new tab) 전부 그린.
- [ ] e2e 컴파일: `pnpm exec wdio run wdio.conf.ts --spec='nonexistent-probe.ts'` → "spec not found" runtime error (TS 0).

## Test Script / Repro Script

1. `pnpm install`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
8. e2e static compile probe.

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src/App.tsx` (Cmd+, repurpose, Cmd+1..9 useEffect, Cmd+K useEffect)
  - `src/App.test.tsx`
  - `src/components/workspace/ConnectionSwitcher.tsx` (event listener)
  - `src/components/workspace/ConnectionSwitcher.test.tsx`
  - `src/components/shared/ShortcutCheatsheet.tsx` (SHORTCUT_GROUPS)
  - `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx`
  - `e2e/db-switcher.spec.ts` (NEW)
  - `e2e/raw-query-db-change.spec.ts` (NEW)
  - **금지**: 백엔드, WDIO 설정, 다른 단축키 재배치, mock fixture
- Merge order: 단일 commit `feat(shortcuts): home toggle + tab digits + connection switcher key + e2e (sprint 133)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest + cargo test + e2e 정적 컴파일 회귀 0

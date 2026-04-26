# Sprint Execution Brief: sprint-133

## Objective

Phase finale 마무리. 단축키 3종 추가:
1. Cmd+, 를 dead `open-settings` event dispatch에서 `appShellStore.setScreen` Home/Workspace 토글로 repurpose.
2. Cmd+1..9 → workspace 활성 탭 전환 (`useTabStore.tabs[index]` → `setActiveTabId`).
3. Cmd+K → `window.dispatchEvent(new CustomEvent("open-connection-switcher"))` → `ConnectionSwitcher`가 listen해 popover 오픈.

ShortcutCheatsheet `SHORTCUT_GROUPS`에 라벨 갱신 + 신규 라벨 2개 추가. 신규 e2e spec 2종 (`db-switcher.spec.ts`, `raw-query-db-change.spec.ts`) — 실제 PG/Mongo fixture 부재 시 `before(() => this.skip())` runtime skip하되 TS 컴파일은 무회귀.

## Task Why

S130 (PG sub-pool LRU + DbSwitcher)와 S131 (Mongo in-connection switch), S132 (raw-query DB-change 감지)이 백엔드/UI 면에서 모두 그린. 사용자가 마우스로만 접근 가능한 기능들 — Home/Workspace 전환, 워크스페이스 탭 직접 점프, 다른 connection으로의 빠른 이동 — 을 단축키로 묶어 power-user UX를 완성. 동시에 새 핵심 워크플로우 (DB 전환, raw-query DB-change)를 e2e 회귀 가드로 잠그기 위해 spec 2종 추가. 실 PG/Mongo container가 없는 CI에서도 안전히 skip하면서, 컴파일은 항상 보호.

## Scope Boundary

- **백엔드 변경 금지**. 본 sprint는 프런트 + e2e 만.
- WDIO 설정 / driver / spec glob 변경 금지.
- 다른 단축키 추가 / 재배치 (Cmd+1..9, Cmd+K, Cmd+, 외) 금지.
- ConnectionSwitcher의 popover UX 재설계 금지 — 키보드 오픈 hook만.
- HomePage 자체의 단축키 추가 금지.
- mock fixture / e2e 시뮬레이터 추가 금지.
- 기존 e2e spec body 리팩터 금지.

## Invariants

- vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0 — 신규 spec 포함, wdio.conf.ts spec glob에 자동 포함되어도 컴파일 성공.
- 사용자 시야 회귀 0:
  - 기존 단축키 (Cmd+N/T/W/S/P/R/I/F5/Cmd+. / Cmd+Shift+T/F/C/I) 보존.
  - PG / Mongo 워크스페이스 핵심 동작 (S130-S132) 보존.
  - DB switcher / raw-query 감지 동일 동작.
- `appShellStore.setScreen` API 변경 0.
- `ConnectionSwitcher` 외부 props 시그니처 변경 0.
- `ShortcutCheatsheet`의 그룹 순서 보존.
- aria-label 가이드 준수.
- credentials 재입력 없음.

## Done Criteria

1. **Cmd+, repurpose**: `App.tsx`의 Cmd+, 분기가 `open-settings` event dispatch → `appShellStore.setScreen` 토글로 교체. workspace ↔ home 양방향 토글. `isEditableTarget` 가드 유지.
2. **Cmd+1..9 useEffect**: 새 keydown handler — `screen === "workspace"` && key in `"1".."9"` → `useTabStore.tabs[digit-1]` 존재 시 `setActiveTabId(tab.id)`. out-of-range no-op. preventDefault. isEditableTarget 가드.
3. **Cmd+K useEffect**: 새 keydown handler — `screen === "workspace"` && key === "k" → `window.dispatchEvent(new CustomEvent("open-connection-switcher"))`. preventDefault. isEditableTarget 가드.
4. **ConnectionSwitcher listener**: `useEffect`에서 `"open-connection-switcher"` 이벤트 listen → 내부 popover open state mutate. cleanup on unmount.
5. **ShortcutCheatsheet update**: `SHORTCUT_GROUPS` —
   - "Panels" 그룹의 `{ label: "Settings", keys: ["Cmd+,"] }` → `{ label: "Toggle Home/Workspace", keys: ["Cmd+,"] }`.
   - "Tabs" 그룹에 `{ label: "Switch to tab 1–9", keys: ["Cmd+1", "…", "Cmd+9"] }` 추가.
   - "Navigation" 그룹에 `{ label: "Open connection switcher", keys: ["Cmd+K"] }` 추가.
6. **단위 테스트** (`App.test.tsx`, `ConnectionSwitcher.test.tsx`, `ShortcutCheatsheet.test.tsx`):
   - App: Cmd+, in workspace/home toggle, isEditableTarget no-op, Cmd+1 active, Cmd+5 with 3 tabs no-op, Cmd+1 in home no-op, Cmd+K dispatch, Cmd+K in home no event, 기존 Cmd+N/Cmd+P 회귀.
   - ConnectionSwitcher: event 발생 시 popover open.
   - ShortcutCheatsheet: 신규 라벨 3개 노출.
7. **신규 e2e spec 2종**:
   - `e2e/db-switcher.spec.ts` — DB switcher 테스트 (PG fixture 가정, 부재 시 skip).
   - `e2e/raw-query-db-change.spec.ts` — `\c admin` 실행 → 사이드바 + DB switcher trigger label 갱신 (PG fixture 가정, 부재 시 skip).
   - 두 spec 모두 `before(() => this.skip())` 패턴으로 runtime skip; TS 컴파일은 항상 그린.
8. **검증 명령 7종 그린**: vitest 2027+, tsc 0, lint 0, contrast 0, cargo test 0 fail, clippy 0 warn, e2e 정적 컴파일 회귀 0.

## Verification Plan

- **Profile**: `mixed`
- **Required checks**:
  1. `pnpm vitest run` — 2027+ 그린.
  2. `pnpm tsc --noEmit` — 0.
  3. `pnpm lint` — 0.
  4. `pnpm contrast:check` — 0 새 위반.
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib` — 0 fail.
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` — 0.
  7. e2e 정적 컴파일 회귀 0 (신규 spec 포함). probe: `pnpm exec wdio run wdio.conf.ts --spec='__nonexistent__.ts'` → "spec not found" runtime error 가능, 단 TS 컴파일 단계 0 에러.
- **Required evidence**:
  - 변경 파일 + 의도 한 줄 매핑.
  - 7개 검증 명령 outcome.
  - AC-01..AC-12 매핑 (file:line / test:line).
  - Cmd+1..9, Cmd+K, Cmd+, repurpose 코드 인용.
  - ConnectionSwitcher 이벤트 listener 코드 인용.
  - SHORTCUT_GROUPS 갱신 diff 인용.
  - 신규 e2e spec 컴파일 그린 증거.

## Evidence To Return

- Changed files + purpose 한 줄.
- 7개 검증 명령 outcome.
- AC-01..AC-12 매핑.
- 가정 (e.g. "Mongo container 부재 시 db-switcher.spec.ts의 Mongo describe도 it.skip", "Numpad1 등은 본 sprint 제외").
- 잔여 위험.

## References

- Contract: `docs/sprints/sprint-133/contract.md`
- Master spec: `docs/sprints/sprint-125/spec.md` (S133 항목)
- 직전 sprint findings: `docs/sprints/sprint-132/findings.md`
- Relevant files:
  - `src/App.tsx` (기존 keydown effects 패턴)
  - `src/App.test.tsx:193-201` (Cmd+, open-settings 기존 테스트)
  - `src/stores/appShellStore.ts` (`setScreen`, `screen`)
  - `src/stores/tabStore.ts` (`tabs`, `setActiveTabId`)
  - `src/components/workspace/ConnectionSwitcher.tsx` (popover trigger)
  - `src/components/shared/ShortcutCheatsheet.tsx` (SHORTCUT_GROUPS)
  - `src/components/shared/__tests__/ShortcutCheatsheet.test.tsx`
  - `e2e/keyboard-shortcuts.spec.ts` (`pressCtrl` 헬퍼 패턴)
  - `e2e/paradigm-and-shortcuts.spec.ts` (skip 패턴 참고)
  - `wdio.conf.ts` (spec glob 확인)

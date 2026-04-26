# Sprint Execution Brief: sprint-134

## Objective

Toolbar `ConnectionSwitcher`를 완전 제거하고 Home에서 다른 connection을 더블클릭했을 때 active connection이 실제로 swap 되도록 고친다. Workspace에 Disconnect 버튼을 추가하고, dirty marker가 active tab이 아닌 실제 dirty tab에 그려지도록 수정한다.

## Task Why

Sprint 127–133에서 toolbar에 ConnectionSwitcher를 도입했지만 실제 사용자 점검(2026-04-27)에서 (a) popover가 과하게 큼 (b) 선택해도 swap이 일어나지 않음이 드러났다. 사용자는 Home으로 가서 다른 connection을 double-click 하는 경로로 통일하길 원한다. 동시에 Disconnect 컨트롤이 빠져 있고, dirty marker가 활성 탭에만 그려지는 별개 버그가 있다. 이 4가지(#1+#2+#6+#9)는 모두 toolbar/tabbar layer에서 한 번에 해결 가능하므로 하나의 sprint로 묶는다.

## Scope Boundary

- 변경 가능: `src/components/workspace/`, `src/components/layout/`, `src/components/connection/`, `src/components/shared/`, `src/pages/HomePage.tsx`, `src/App.tsx`, `src/App.test.tsx`, `e2e/keyboard-shortcuts.spec.ts`.
- 변경 금지: SchemaSwitcher, DbSwitcher 동작, Mongo sidebar, sidebar single/double-click semantics(S136에서 변경), connection form (S138), query editor(S139), import/export(S140).
- 백엔드(Rust) 변경 없음.

## Invariants

- Cmd+, / Cmd+1..9 / Cmd+W / Cmd+T / Cmd+S / Cmd+N / Cmd+P 동작 유지.
- DbSwitcher (toolbar의 DB 전환) 동작 유지.
- Connection list / Group / Drag-drop / Favorites / Quick Look 동작 유지.
- `connectionStore` 시그니처 유지.
- 기존 e2e 스펙 (Cmd+, toggle 시나리오 포함) 미파손.

## Done Criteria

1. `ConnectionSwitcher.tsx` + `ConnectionSwitcher.test.tsx` 삭제, WorkspaceToolbar에서 미참조.
2. `App.tsx`의 Cmd+K useEffect 제거, App.test.tsx Cmd+K 시나리오를 deprecated/no-op로 갱신.
3. ShortcutCheatsheet에서 "Open connection switcher" / "Cmd+K" 항목 제거 + 테스트 갱신.
4. Home에서 다른 connection double-click → connectionStore.activeConnectionId가 새 connection으로 swap, screen='workspace'로 전이. 신규 vitest test 동반.
5. `<DisconnectButton aria-label="Disconnect">` 가 refresh 인접에 mount, click 시 `disconnectFromDatabase` 호출, disconnected 상태에서 disabled. test 동반.
6. TabBar dirty marker가 `dirtyTabIds.has(tab.id)` 기반으로만 그려지며 active와 무관. 신규 vitest test 2 케이스.
7. e2e 변경: `e2e/keyboard-shortcuts.spec.ts`의 "Cmd+K opens connection switcher" 시나리오를 제거 또는 deprecated로 갱신.
8. 6 게이트 + e2e static lint 그린.

## Verification Plan

- Profile: mixed
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
  4. `pnpm contrast:check`
  5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  7. `pnpm exec eslint e2e/**/*.ts`
- Required evidence:
  - 7개 명령 출력 (last 30 lines 이상 또는 PASS 라인 발췌)
  - `grep -rn "ConnectionSwitcher" src/` 결과 0 hits
  - `grep -rn "open-connection-switcher" src/` 결과 0 hits
  - 신규 vitest test 이름 + 통과 표시
  - 변경된 파일 목록 + 각 파일의 한 줄 purpose

## Evidence To Return

- 변경 파일 목록 (path + purpose 한 줄)
- 7개 verification command 출력
- 각 AC(AC-S134-01 ~ AC-S134-08) 별 증거 라인
- grep 결과 (ConnectionSwitcher / open-connection-switcher 0 hits 확인)
- 가정/리스크 (예: e2e 시나리오 변경 시 기존 PASS spec 영향 여부)

## References

- Contract: `docs/sprints/sprint-134/contract.md`
- Master spec: `docs/sprints/sprint-134/spec.md`
- Lesson trigger: `memory/lessons/2026-04-27-workspace-toolbar-ux-gaps/memory.md`
- Phase 9 baseline: `docs/sprints/sprint-133/handoff.md`
- Relevant files (read first):
  - `src/components/workspace/ConnectionSwitcher.tsx`
  - `src/components/workspace/WorkspaceToolbar.tsx`
  - `src/App.tsx`, `src/App.test.tsx`
  - `src/components/shared/ShortcutCheatsheet.tsx` + test
  - `src/components/layout/TabBar.tsx` + test
  - `src/components/layout/MainArea.tsx`
  - `src/pages/HomePage.tsx`, `src/components/connection/ConnectionItem.tsx`, `src/components/connection/ConnectionList.tsx`
  - `src/stores/connectionStore.ts`, `src/stores/tabStore.ts`, `src/stores/appShellStore.ts`
  - `e2e/keyboard-shortcuts.spec.ts`

# Sprint 148 Contract — Connection SoT cleanup + Disconnect (AC-142-*)

## Pre-sprint discovery

현재 single-window 아키텍처에서 Sprint 149 분리 윈도우는 미구현. Sprint 148은
"launcher" = `HomePage`, "workspace" = `WorkspacePage` 으로 매핑된다.

이미 구현된 부분 (Sprint 134/이전):
- Cmd+K connection picker → 제거됨. `App.tsx:168-172` Cmd+K 핸들러 비할당.
- 별도 connection switcher UI → 제거됨. `WorkspaceToolbar.tsx`에는 `DbSwitcher`(같은 connection 내 DB 전환)만 존재.
- `DisconnectButton` (`src/components/workspace/DisconnectButton.tsx`) → `aria-label="Disconnect"` 포함, 클릭 시 `disconnectFromDatabase` → home 복귀까지 흐름 완비.
- 재연결 흐름: `connectionStore.connectToDatabase` (라인 194-240) — pool eviction 후 재호출 시 정상 재연결.

Sprint 148이 신규 구현해야 할 갭:
- **connection swap 시 이전 connection의 탭 정리** — 현재 `HomePage.handleActivate`는 `setScreen("workspace")`만 하고 `tabStore`를 손대지 않아, 다른 connection으로 전환해도 이전 connection의 탭이 그대로 남는다 (cross-connection tab leakage).

## In Scope

1. **AC-142-1 회귀 잠금** — 새 테스트 파일에서 다음을 단언:
   - `WorkspacePage` 안에 connection picker / connection switcher 역할의 UI(role=combobox로 connection 목록을 노출하는 select, 또는 "Switch connection" 라벨)가 존재하지 않는다.
   - `App.tsx` 글로벌 keydown 핸들러가 Cmd/Ctrl+K로 connection picker 모달을 열지 않는다 (mod+K 후 dialog/role=listbox 없음).

2. **AC-142-2 — connection swap 시 탭 클로즈** *(코드 변경 필요)*
   - `tabStore`에 `clearTabsForConnection(connectionId: string)` 액션 추가 (또는 그에 준하는 selector 삭제 패턴).
   - `connectionStore.connectToDatabase`(또는 그 호출 사이트인 `HomePage.handleActivate`)에서 **이전에 활성이었던 connection이 있고 새 connection이 다르면** 이전 connection 탭들을 모두 close.
   - 정책: **clean close** (graceful migrate는 cross-DBMS 호환성 문제로 후속 sprint로 이월).
   - 테스트: 두 connection A, B를 store에 채우고 A 활성화 + 탭 2개 열기 → B 활성화 → A 탭 0개, B 탭 0개(B는 새로 시작).

3. **AC-142-3 회귀 잠금** — `DisconnectButton`이 `[aria-label="Disconnect"]`이고, 클릭 시 `disconnectFromDatabase`가 호출되며 최종적으로 home 화면으로 복귀하는 흐름 단언 (이미 구현됨; 회귀 방지용 명시 테스트가 부재).

4. **AC-142-4 회귀 잠금** — disconnect 후 같은 connection을 다시 `connectToDatabase` 하면 `connectToDatabaseCommand`(Tauri) 가 다시 호출되고 활성 status로 진입하는지 store-level 단언.

## Out of Scope

- Cross-DBMS graceful tab migration (예: PG SELECT 탭을 MySQL로 옮기기). spec이 "close 또는 graceful migrate" 두 옵션 모두 허용하므로 close 쪽 채택.
- Workspace의 별도 connection picker 신설 (spec이 명시적으로 제거 요구).
- Sprint 149 launcher/workspace 윈도우 분리.
- `DisconnectButton` UI 카피·스타일 변경.

## Invariants

- `pnpm vitest run` 2233 → 신규 테스트 추가 후 모두 green.
- `pnpm tsc --noEmit` 0, `pnpm lint` 0.
- `DisconnectButton` aria-label은 정확히 `"Disconnect"` 유지.
- 기존 connection 활성 상태에서 동일한 connection을 다시 활성화하면 탭이 남아있어야 한다 (정책: 같은 id면 swap이 아니므로 close 안 함).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run`
  2. `pnpm tsc --noEmit`
  3. `pnpm lint`
- Required evidence:
  - File-change manifest with purpose.
  - Per-AC test name table.
  - Command outputs.

## Done Criteria

1. `connection-sot.test.tsx` (또는 등가 신규 파일) 가 AC-142-1~4 4개 `it()` 블록을 포함하고 모두 통과.
2. `tabStore`에 `clearTabsForConnection` 추가, swap 시 호출되어 cross-connection tab leakage 가 제거됨 (테스트로 단언).
3. 3개 명령(vitest/tsc/lint) 모두 exit 0.

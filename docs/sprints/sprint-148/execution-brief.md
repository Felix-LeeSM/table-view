# Sprint 148 — Execution Brief

## Objective

AC-142-* 잠금: (1) Workspace 안에 connection switcher / Cmd+K picker 가
없음을 회귀 테스트로 잠그고, (2) **다른 connection 활성화 시 이전 connection
탭이 자동 close** 되도록 `tabStore` + activation 흐름을 보강한다. (3)
`DisconnectButton` 동작과 (4) disconnect 후 재연결 흐름을 명시 테스트로 잠근다.

## Task Why

Sprint 134에서 connection switcher / Cmd+K picker는 제거되었지만 회귀를
잡는 테스트가 없어 "Q2=B (Connection 전환 SoT는 Launcher만)" 결정이
silently 깨질 수 있다. 또한 현재 `HomePage.handleActivate`는 다른
connection으로 전환할 때 `tabStore`를 손대지 않아 이전 connection의 탭이
새 workspace에 그대로 남는 버그가 있다 — spec AC-142-2가 명시적으로 close
또는 graceful migrate 를 요구한다.

## Scope Boundary

- 새 connection picker UI를 만들지 않는다.
- `DisconnectButton` 카피/스타일 손대지 않는다.
- Tab graceful migration (탭 SQL 텍스트 보존 후 새 connection으로 옮김)은
  out of scope — clean close 만 채택.
- Sprint 149의 윈도우 분리 작업과 섞지 않는다.

## Invariants

- 2233 기존 테스트 + 신규 테스트가 모두 green.
- `aria-label="Disconnect"` 문자열 그대로 유지.
- 같은 connection을 다시 활성화(double-click) 했을 때는 탭이 보존된다
  (id 비교로 swap 여부 판정).

## Done Criteria

1. 신규 테스트 파일이 AC-142-1 / -2 / -3 / -4 각각에 1개 이상의 `it()`
   매핑을 가지고 모두 통과.
2. `tabStore.clearTabsForConnection(connectionId)` (또는 동등 액션) 가
   존재하고, connection 활성화 흐름에서 이전 active connection의 탭을
   close 한다.
3. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.
- Required evidence: 변경 파일 manifest, AC↔테스트 매핑 표, 명령 출력.

## Evidence To Return

- 변경 파일 + 목적 (manifest).
- 실행 명령 출력 (3종 모두 0).
- AC-142-1~4 각각이 어느 `it()`로 잠겼는지 표.
- 가정/리스크/이월: graceful tab migration 보류 사유, swap 정책의 edge case
  (같은 id 재활성화는 close 안 함) 명시.

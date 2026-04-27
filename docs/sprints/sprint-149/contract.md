# Sprint 149 Contract — Launcher/Workspace lifecycle invariants (AC-141-*) — single-window stub

## Pre-sprint discovery

Sprint 149의 spec(AC-141-1~5)은 별도 Tauri 윈도우 두 개(launcher 720×560
fixed / workspace 1280×800 resizable)로 lifecycle을 분리하기를 요구한다.
현실적 제약:

- 현재 single-window 코드의 모든 zustand store는 두 webview 간 공유되지 않는다.
- 두 윈도우 분리는 connection/tab/appShell/mru/theme/favorites 5개 store에
  IPC 동기화 layer 도입 + tauri.conf.json 윈도우 재정의 + Rust 측 launcher
  module 신설을 동시에 요구한다 — 한 sprint 작업 단위를 초과한다.
- 기존 2233개 테스트 + e2e 전 시나리오 회귀 위험이 매우 큼.

따라서 Sprint 149는 **single-window stub**로 진행한다: AC-141-1~5의 사용자
관측 가능한 lifecycle 동작(home/workspace screen toggle을 launcher/workspace
의 logical equivalent로 매핑)을 명시 회귀 테스트로 잠그고, **실제 윈도우
분리는 phase 12로 이월**한다. 이월 결정은 ADR + RISKS.md + `it.todo()` 4중
강제 메커니즘으로 잠근다.

## In Scope

1. **AC-141-1 logical equivalent** — 앱 boot 시 `appShellStore.screen === "home"`
   (launcher equivalent).
2. **AC-141-2 logical equivalent** — connection 더블클릭 → workspace screen
   진입. (Sprint 148에서 swap-tab 정리는 잠금 완료; 여기서는 lifecycle 진입
   자체를 명시.)
3. **AC-141-3 logical equivalent** — workspace의 "Back to connections" 버튼
   클릭 → home 복귀하면서 **백엔드 connection pool은 유지**
   (`activeStatuses[id].type === "connected"` 그대로). pool 유지가 spec의
   핵심 동작이며 single-window 모델에서도 의미 있음.
4. **AC-141-4 logical equivalent** — Disconnect 버튼은 pool eviction까지
   수행하므로 Back과 다른 최종 상태 (`type: "disconnected"`)를 가짐. 두
   경로의 차이를 명시 테스트로 잠금.
5. **AC-141-5 lifecycle integration test** — boot → activate → back →
   reactivate → disconnect 5단계가 의도한 screen+pool 상태를 거치는지
   하나의 테스트로 검증.
6. **Real-window invariants를 `it.todo()`로 명시** — 별도 `describe.skip`
   블록 안에 phase 12의 실제 윈도우 lifecycle 단언을 todo 로 박아 vitest
   리포트에 매 실행마다 노출.

## Forcing Mechanisms (이월 강제 4중 잠금)

1. **ADR 0011** — `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`.
   본문 동결 — single-window stub 채택 결정 + 재개 트리거.
2. **RISK-025 deferred** — `docs/RISKS.md`에 등록. status=deferred,
   재개 트리거 + 재개 시 영향 면적 명시.
3. **`it.todo()` block** — Sprint 149 테스트 파일에 phase 12 invariants를
   todo로 명시. 매 vitest 실행 시 카운트 노출 → 무시 불가.
4. **Sprint 149 findings.md "Deferred Work"** — phase 12 진입 트리거,
   영향 받을 5개 store 리스트, 예상 신규 파일 manifest.

## Out of Scope

- 실제 두 Tauri 윈도우 생성 / `tauri.conf.json.windows` 변경 / `lib.rs`
  launcher module 신설.
- Cross-window store sync layer (zustand IPC bridge).
- 새 e2e 시나리오 추가 (real-window lifecycle은 phase 12 spec 합의 후).

## Invariants

- `pnpm vitest run` 2239 → 신규 테스트 추가 후 모두 green.
- `pnpm tsc --noEmit` 0, `pnpm lint` 0.
- WorkspacePage "Back to connections" 버튼 동작 변경 없음
  (`disconnectFromDatabase` 호출 안 함, `setScreen("home")`만).
- DisconnectButton 동작 변경 없음 (Sprint 148에서 잠금된 그대로).

## Done Criteria

1. `window-lifecycle.ac141.test.tsx` 가 AC-141-1/2/3/4/5에 1:1 매핑되는
   `it()` 블록을 가지고 모두 통과.
2. `it.todo()`로 phase 12 real-window invariants 5개가 명시됨.
3. ADR 0011 + ADR 인덱스 업데이트.
4. RISKS.md에 RISK-025 추가, summary 카운트 갱신.
5. `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint` 모두 exit 0.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`, `pnpm lint`.
- Required evidence: 변경 파일 manifest, AC↔테스트 매핑, todo 카운트, ADR 링크.

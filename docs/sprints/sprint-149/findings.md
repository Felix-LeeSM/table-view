# Sprint 149 — Findings

## Outcome

**PASS** — AC-141-* 5개 sub-clause가 single-window stub 위에서 회귀 테스트로
잠겼고, 실제 두 윈도우 분리는 phase 12로 이월됐다. 이월 결정은 ADR 0011 +
RISK-025 + `it.todo()` 5개 + 본 findings의 Deferred Work 4중 강제 메커니즘으로
잠겼다.

## Verification

- `pnpm vitest run` — 148 files / **2244 tests + 5 todo** (이전 2239 → +5 active).
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.

## Changed Files

| File | Purpose |
|---|---|
| `src/__tests__/window-lifecycle.ac141.test.tsx` | 신규. AC-141-1~5에 1:1 매핑되는 5개 `it()` + phase 12 real-window invariants 5개 `it.todo()` (`describe.skip` 안). |
| `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md` | 신규 ADR. single-window stub 채택 + phase 12 이월 결정 동결. |
| `memory/decisions/memory.md` | 인덱스에 ADR 0011 행 추가, `updated: 2026-04-27`. |
| `docs/RISKS.md` | RISK-025 (deferred) 추가, summary Active 14→15 / Deferred 1→2 / Total 23→25 갱신. (Active 카운트는 기존 표 기준 실측치로 정정 포함.) |
| `docs/sprints/sprint-149/{contract,execution-brief,findings}.md` | Sprint 산출물. |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-141-1 (boot 시 launcher) | ✅ stub | `it("AC-141-1: app boot lands on the launcher equivalent ...")` — `useAppShellStore.getState().screen === "home"`. |
| AC-141-2 (활성화 → workspace 진입) | ✅ stub | `it("AC-141-2: double-clicking a connection ... activates the workspace screen")` — HomePage 더블클릭 후 `screen === "workspace"`, `focusedConnId === "c1"`. |
| AC-141-3 (Back 시 launcher 복귀하면서 pool 유지) | ✅ stub | `it("AC-141-3: 'Back to connections' returns to launcher AND preserves the backend connection pool")` — `screen === "home"` 동시에 `activeStatuses["c1"].type === "connected"`, `disconnectMock` 호출 0회. |
| AC-141-4 (Disconnect는 pool eviction) | ✅ stub | `it("AC-141-4: Disconnect (unlike Back) DOES evict the pool ...")` — store 액션 직접 호출 후 `disconnectMock` 호출 + `activeStatuses["c1"].type === "disconnected"`. |
| AC-141-5 (전체 lifecycle 통합) | ✅ stub | `it("AC-141-5: full lifecycle — boot → activate → back (pool kept) → reactivate (no reconnect cost) → disconnect (pool gone)")` — 5단계 시나리오 단일 테스트. |

| AC (real-window phase 12) | Status | Evidence |
|---|---|---|
| AC-141-1 real | ⏳ deferred | `it.todo("AC-141-1 (real): launcher window mounted at 720×560, fixed (no resize/maximize), centered")` |
| AC-141-2 real | ⏳ deferred | `it.todo("AC-141-2 (real): launcher.connect success emits 'workspace:open'; workspace.show()+focus(), launcher.hide()")` |
| AC-141-3 real | ⏳ deferred | `it.todo("AC-141-3 (real): workspace 'Back' emits 'launcher:show'; workspace.hide(), launcher.show(); pool intact")` |
| AC-141-4 real | ⏳ deferred | `it.todo("AC-141-4 (real): launcher.close → app exit; workspace.close → launcher recovery (same as Back)")` |
| AC-141-5 real | ⏳ deferred | `it.todo("AC-141-5 (real): WebviewWindow mock-based 4-stage visibility integration test")` |

## Forcing Mechanisms (이월 강제 4중 잠금 — 위치 인용)

1. **ADR 0011** — `memory/decisions/0011-single-window-stub-for-launcher-workspace/memory.md`.
   본문 동결. CLAUDE.md "ADR 본문은 작성 순간 동결" 규칙으로 결정 보존.
2. **RISK-025 deferred** — `docs/RISKS.md` 50번째 행.
3. **`it.todo()` 5개** — `src/__tests__/window-lifecycle.ac141.test.tsx`
   의 `describe.skip("AC-141-* real-window invariants (DEFERRED to phase 12 — see ADR 0011)")`
   블록. 매 `pnpm vitest run` 실행 시 "5 todo" 카운트로 노출됨.
4. **Sprint 149 findings.md "Deferred Work"** — 본 섹션 하단.

## Deferred Work (phase 12 진입 트리거 + 영향 면적)

### 진입 트리거

phase 12 spec 합의가 다음 중 하나라도 도래하면 본 이월 작업을 활성화한다:

- 사용자 피드백에서 "launcher 윈도우가 따로 있어야 한다" 명시 요청.
- TablePlus 워크플로우 비교 분석에서 단일 윈도우의 한계가 quantified로 증명됨
  (예: 다중 connection 동시 작업 시 화면 전환 비용 측정).
- macOS 멀티 윈도우 단축키(⌘ 1, ⌘ 2)로 launcher/workspace 토글 요구.

### 영향 받을 5개 store (cross-window IPC sync 필요)

- `connectionStore` — connections / activeStatuses / focusedConnId 모두 두 윈도우에서 일관 조회.
- `tabStore` — workspace 윈도우 전용이지만 connection swap 신호는 launcher에서 전파.
- `appShellStore` — `screen` 필드는 폐기 또는 윈도우별로 분리.
- `mruStore` — launcher가 MRU 노출, workspace의 활성 변경이 MRU 갱신.
- `themeStore` / `favoritesStore` — 두 윈도우 모두 동일 테마/즐겨찾기 적용.

### 예상 신규 파일 manifest

- `src-tauri/tauri.conf.json` — `windows[]` 항목 두 개 (launcher / workspace) + initial visibility.
- `src-tauri/src/launcher.rs` (신규 module) — launcher 윈도우 spawn + `tauri.show/hide/focus` 명령 래퍼.
- `src/lib/zustand-ipc-bridge.ts` (신규) — store 변경분을 `tauri.emit/listen`으로 두 webview에 broadcast.
- `src/pages/LauncherPage.tsx` (신규) — HomePage를 launcher 윈도우 본체로 옮긴 분리 페이지.
- `e2e/window-lifecycle.spec.ts` (신규) — WebviewWindow 가시성 통합 e2e.
- 새 ADR (0011을 superseding) + RISK-025 status `deferred` → `resolved`.

## Assumptions

- single-window stub의 `appShellStore.screen` 토글이 phase 12 real-window
  show/hide의 사용자 관측 동등물이라는 매핑은 사용자가 spec discovery에서
  명시 합의함 (Option B 채택).
- `it.todo()` 카운트가 0으로 떨어지는 것은 phase 12 완료의 **필요조건이지
  충분조건이 아님** — real-window 통합 e2e도 함께 ship되어야 함.

## Risks / Deferred

- **WebviewWindow lifecycle stub 부재**: `tauri.show/hide/focus` 호출 회귀는
  본 sprint에서 잠기지 않음 — phase 12에서 별도 mock harness 필요.
- **2-윈도우 cross-store sync 미구현**: phase 12 진입 시 IPC bridge가 모든
  store에 적용되어야 하며, 적용 누락 시 두 윈도우 상태가 분기될 수 있음.
- **e2e 시나리오 미갱신**: 현재 e2e는 single-window 가정. phase 12 진입 시
  전 시나리오 review 필요.

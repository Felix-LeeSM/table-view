# Sprint 148 — Findings

## Outcome

**PASS** — AC-142-* 4개 sub-clause가 명시 테스트로 잠겼고, 실제 누락이었던
"connection swap 시 stale 탭 leak" 갭이 메워졌다. Sprint 134/이전에 이미
구현되어 있던 부분(Cmd+K 제거, DisconnectButton)도 회귀 테스트로 고정됨.

## Verification

- `pnpm vitest run` — 147 files / **2239 tests** (+6).
- `pnpm tsc --noEmit` — exit 0.
- `pnpm lint` — exit 0.

## Changed Files

| File | Purpose |
|---|---|
| `src/stores/tabStore.ts` | `clearTabsForConnection(connectionId)` 액션 추가. 해당 connection의 모든 탭을 제거하고 `activeTabId` / `dirtyTabIds`를 정합성 있게 갱신. 정체성 stable (변동 없으면 state 그대로 반환). |
| `src/pages/HomePage.tsx` | `handleActivate`에서 활성화 대상과 다른 connection 소유 탭들을 `clearTabsForConnection`으로 모두 close. 같은 id 재활성화는 그대로(idempotent). |
| `src/__tests__/connection-sot.ac142.test.tsx` | 신규. AC-142-1/2/3/4 6개 `it()` (AC-142-1 두 개, AC-142-2 두 개, AC-142-3, AC-142-4). |
| `docs/sprints/sprint-148/{contract,execution-brief,findings}.md` | Sprint 산출물. |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-142-1 (Workspace에 connection picker / Cmd+K 없음) | ✅ | `it("AC-142-1: HomePage exposes only ...")` + `it("AC-142-1: WorkspaceToolbar contains DbSwitcher + Disconnect only ...")` 두 개. role/name 매칭으로 picker UI 부재 단언. |
| AC-142-2 (다른 connection 활성화 시 swap + 이전 탭 정리) | ✅ | `it("AC-142-2: activating a different connection ... clean-close swap")` — c1에 두 탭 + c2 더블클릭 → tabs.length=0, activeTabId=null. `it("AC-142-2: re-activating the same connection preserves its tabs")` — 동일 id 재활성화는 탭 유지. |
| AC-142-3 (Disconnect 버튼) | ✅ | `it("AC-142-3: ... aria-label='Disconnect' ...")` — aria-label 단언 + `disconnectFromDatabase` 호출 + activeStatuses → `disconnected`. |
| AC-142-4 (Disconnect 후 재연결) | ✅ | `it("AC-142-4: after disconnect, reactivating ... lands in 'connected'")` — store-level 직접 호출로 disconnect → connect 라운드트립 검증. |

## Assumptions

- "launcher / workspace 분리 윈도우" (Sprint 149)는 미구현이므로 Sprint 148의
  "launcher" 더블클릭 흐름은 현재 single-window의 `HomePage` 더블클릭으로 대체.
  Sprint 149 구현 시 동일 흐름을 새 launcher 윈도우로 옮기면 tabs swap 테스트는
  그대로 유효해야 한다 (HomePage가 launcher의 본체로 이동).
- swap 정책: **clean close**. spec이 "close 또는 graceful migrate" 둘 다
  허용하지만 cross-DBMS migration은 호환성 이슈가 크고 (PG SELECT를 MySQL
  탭으로 옮기는 의미 없는 케이스 등) close가 사용자 멘탈 모델에 더 가깝다.

## Risks / Deferred

- **Tab graceful migration**: query 탭의 SQL 텍스트 보존(같은 paradigm일 때만)은
  이월. 사용자가 같은 paradigm 간 swap을 자주 한다면 future sprint에서 추가.
- **Same-paradigm 자동 close vs 명시 confirm**: 현재는 silent close. 다수 탭이
  열린 상태에서 swap 시 "X tabs will close" 확인 다이얼로그는 미구현. 사용자
  피드백이 들어오면 추가.
- **closedTabHistory 미반영**: swap 시 닫는 탭은 reopen-last-closed에 들어가지
  않는다 (의도). user reopen 의미가 다른 connection으로 옮겨감을 시사하기 때문.

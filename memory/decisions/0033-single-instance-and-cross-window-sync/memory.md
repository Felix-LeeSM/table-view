---
id: 0033
title: Single-instance + in-process cross-window sync (Q3/Q4)
status: Accepted
date: 2026-05-17
supersedes: null
superseded_by: null
---

**결정**: 앱은 `tauri-plugin-single-instance` 로 single-process 강제, 모든
cross-window 상태 동기화는 같은 process 안의 `AppHandle::emit_all
("state-changed", payload)` in-process event 만 사용한다.

1. **Single-instance plugin** — 2번째 launch 시도는 가로채서 기존
   instance 의 launcher window focus. CLI args 전달 가능 (예: connection
   ID hint).
2. **Launcher window 영속** — connection 열고 workspace window 떴어도
   launcher 는 hide 만 (close 안 함). 사용자 메뉴에서 "Show Launcher"
   로 복원 가능.
3. **In-process event 만** — `emit_all` broadcast 는 같은 process 의
   모든 window 가 즉시 receive. ~~File watcher~~ / ~~events table~~ /
   ~~L3 cross-process model~~ 전부 폐기 (Q4.a / Q4.b 폐기).
4. **9 domain wire** — `domain` ∈ `connection | group | workspace | mru
   | favorite | history | setting | schemaCache | datagridColumnPrefs`,
   `op` ∈ `create | update | delete | reorder | bulk | status |
   invalidate | reset | clear` (F.4).
5. **수신자 refetch** — payload 는 metadata (`entityId`, `version`,
   `snapshotVersion`, `originWindow`) 만, 실제 값은 수신 window 가
   single-source IPC refetch. `op:"reset"` 만 예외 — `SETTING_DEFAULTS`
   frontend 상수 즉시 적용 (codex 6차 #4).
6. **Self-echo skip** — `originWindow === currentWindowLabel` 이면
   mutate skip + version 만 갱신. 원인 window 는 IPC 응답에서 이미
   optimistic mutate.
7. **Listener 선등록 + version gap 감지** — `listen()` → `getInitialAppState
   ()` 순서 강제 (boot 중 buffered event 보호). `version > lastApplied + 1`
   이면 domain refetch (gap recovery).

**이유**:

1. **Single-instance 가 cross-process 인프라를 제거** — Q3 lock 이전엔
   multi-process 가정으로 file watcher + events table + cross-process
   broadcast 가 검토됐으나, 사용자가 같은 머신에서 동시에 두 instance
   를 띄울 사용자 가치 (A2) 가 낮고, single-process 가정이 코드를
   극단적으로 단순화 (Q4 의 in-process event 만으로 모든 동기화).
2. **`emit_all` 신뢰성** — Tauri 의 in-process event 는 transport-level
   loss 없음 (같은 process). Retry 불필요. 단 listener 등록 전 발생한
   event 는 miss 가능 → boot-order (listener 선등록) + version gap
   감지로 보호 (F.4 §Retry).
3. **Single-source refetch 원칙** — payload 에 value 넣으면 두 source
   (event payload vs IPC refetch) drift 가능. 한 가지 source (IPC) 만
   남기는 게 일관성 자동. Reset 만 예외 — row 가 사라져 refetch 가
   null 이라 무의미.
4. **Self-echo skip** — 원인 window 는 IPC 응답에서 이미 store mutate
   완료. 같은 event 재처리하면 (a) version 충돌 (자기 mutate 가 self-echo
   에 의해 다시 적용), (b) 사용자 보이는 UI 의 추가 jump 발생.

**트레이드오프**:

- **+** Cross-process 인프라 (file watcher, events table, broadcast
  layer) 코드 0 — Q3 lock 의 가장 큰 이득.
- **+** 단일 EventEmitter = single point of debugging. payload 의 9
  domain × 9 op 매트릭스만 test 하면 모든 sync path 검증.
- **+** Listener 선등록 + version gap 으로 missed event recovery 강건.
- **+** Self-echo skip + version 갱신으로 stale detection 정확.
- **−** 사용자 가 같은 머신에서 한 앱의 두 instance 가 필요한 시나리오
  (예: 별도 user-data) 불가능 — 우회는 별 OS 계정 / 별 머신.
- **−** Launcher hide-on-workspace-open 의 UX 학습 곡선 — 사용자가
  "닫혔다" 고 인식하면 OS 메뉴 / dock 에서 다시 클릭. 단 single-instance
  덕에 새 process spawn 안 하고 기존 instance 복원.
- **−** 9 domain × 9 op = 81 매트릭스의 receiver 테스트 부담 — mount/
  unmount × originWindow self/other 까지 cross 검증 (F.4 §Phase 3 AC).

**관련**:

- state-management-strategy-2026-05-15.md §Q3 line 406 (single-instance 강제)
- state-management-strategy-2026-05-15.md §Q4 line 407 (in-process event only)
- state-management-strategy-2026-05-15.md §Q4.a/Q4.b line 408–409 (폐기)
- state-management-strategy-2026-05-15.md §F.4 line 1293–1471 (cross-window event
  wire / domain 처리표 / self-echo / version gap)
- state-management-strategy-2026-05-15.md §Phase 3 line 768–774 (single-instance plugin
  + emit_all)
- ADR 0012 — Multi-window launcher/workspace (per-window WebviewWindow)
- ADR 0013 — Cross-window focus hydration hook
- ADR 0032 — Snapshot bootstrap (in-process event 가 snapshot 의 listener
  선등록 의존)
- ADR 0038 — Theme/SafeMode SOT (event domain="setting" 의 첫 사용자)
- ADR 0039 — Workspace window per-connection (single-instance 위 N
  workspace window)
- ADR 0041 — SchemaCache invalidation (event domain="schemaCache"
  invalidate 의존)

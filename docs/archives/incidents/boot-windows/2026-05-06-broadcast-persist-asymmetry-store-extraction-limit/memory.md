---
title: webview-distributed state — broadcast/persist 비대칭으로 store side-effect 추출 한계
type: lesson
date: 2026-05-06
domain: boot-windows
sprint: 224 (P10 step 3a) / 225+ deferred (step 3b/4)
---

# 상황

`connectionStore` 의 P10 cycle (Sprint 219/223/224) 진행 중 step 3b
(`persistFocusedConnId` / `persistActiveStatuses` 3 site 추출) + step 4
(`attachZustandIpcBridge` 분리) 이 narrow extraction 불가능으로 deferred.
read-only `hydrateFromSession` (step 3a) 는 안전하게 추출됐지만 write
경로는 비대칭 invariant 때문에 같은 패턴 적용 못함.

# 원인

Tauri 2 multi-window = 단일 Rust process + 2 WebviewWindow (각자 V8
isolate). state 동기화 = `attachZustandIpcBridge` 가 store subscriber 로
SYNCED_KEYS (4) 를 양방향 broadcast.

비대칭:

- **broadcast** = store `set()` → IPC bridge subscriber 자동 fan-out → 모든
  window. 호출자는 broadcast 의도 의식 안 함.
- **persist** = `persistFocusedConnId(id)` / `persistActiveStatuses(...)` 만
  origin window 의 sessionStorage 작성. **이 호출이 broadcast 직후가 아니라
  origin action body 안에 있는 게 의도**. 다른 window 가 broadcast 받아 store
  update 시 그 window 는 persist 안 함 (origin 만 owner).

이를 use-case hook 으로 추출하면 origin 식별 (`who is calling? boot vs
focus vs broadcast subscriber?`) 책임이 hook caller 또는 hook 자체에 떠넘
겨짐. Sprint 219/223/224 의 narrow extraction 은 이 식별 책임이 없는 read-
only or local-only side effect 였음.

추가로 e2e suite 가 `lefthook.yml:61-86` 에 `skip: true` (since 2026-05-01,
vite v6 build OOM in 4GB container) 로 사실상 dead — cross-window invariant
검증은 `src/__tests__/cross-window-*.test.tsx` 의 vitest simulation 만 남
음. invariant 변동을 동반하는 step 3b/4 추출 시 검증 surface 가 vitest
simulation 한 겹뿐 — risk 가용 검증력에 비해 큼.

# 재발 방지

- store side-effect 추출 sprint 진입 전 **side-effect 의 origin
  ownership 분류** 먼저 — broadcast (모든 window 자동) vs persist (origin
  only) vs API call (idempotent? cross-window race?) 3 카테고리.
- read-only hydration / origin-local mutation toast 는 narrow 추출 안전.
  origin 식별 필요한 persist / IPC bridge attach 는 invariant 변경 동반
  이므로 별도 architectural sprint (Phase 28 후보 — Rust=server 또는
  storage event spike) 로 분리.
- e2e 복구 (vite v6 build OOM 해결 + docker rebuild + 12+ commit drift
  catch-up) 가 invariant 변동 sprint 의 prerequisite. vitest simulation 만
  으로는 cross-window race / IPC ordering / boot timing 회귀 못 잡음.
- PLAN sequencing 표 deferred row 는 "사용자 hooks/lib 작업 안정 후 진입"
  같은 모호 trigger 보다 **prerequisite (e2e 복구) + architectural decision
  (Phase 28 spike)** 명시.

# 검토된 architectural alternatives (모두 deferred / rejected)

비대칭 자체를 없애려면 state model 을 webview-distributed 가 아닌 single
source 로 바꿔야 함. 4 옵션 검토:

1. **SharedWorker** — REJECTED. macOS WKWebView 에서 Apple 이 deprecated
   취급. Chromium 계열만 stable. Tauri 2 macOS = WKWebView 강제이므로
   non-starter.
2. **localStorage + storage event broadcast** — DEFERRED. WKWebView storage
   event 발사 안정성 (cross-tab 간 실시간 fan-out 보장) 미검증. spike
   필요. e2e 복구 후 진입 가능.
3. **Rust=server (Phase 28 후보)** — DEFERRED. Tauri 2 first-class 패턴.
   Rust 가 store SoT, webview 는 read-only mirror. broadcast/persist 비
   대칭 자체가 사라짐. 단점 = vitest mockability 손실 (밑 lesson 참조)
   + e2e 가 유일 invariant 검증 surface 인데 dead.
4. **session-key only Rust + 상태는 webview** — REJECTED. broadcast/persist
   비대칭 그대로 + Rust 에 새 책임 추가 (key 발급/만료/rotation) 라
   복잡도만 증가.

선택 트리: e2e 살리기 → option 2 spike 또는 option 3 진입. e2e 죽은 상태
유지 → 어느 option 도 진입 못함.

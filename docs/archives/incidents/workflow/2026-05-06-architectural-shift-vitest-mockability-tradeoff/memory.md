---
title: architectural shift (Rust=server) 의 vitest mockability 트레이드오프 — e2e 복구가 prerequisite
type: lesson
date: 2026-05-06
domain: workflow
sprint: 224 (검토 시점) / Phase 28 후보 deferred
---

# 상황

P10 step 3b/4 (broadcast/persist 비대칭 해소) 의 architectural alternative
로 **Rust=server 패턴** (Tauri 2 first-class — Rust 가 store SoT, webview
는 read-only mirror) 검토. 비대칭 자체가 사라지는 깔끔한 해법이지만 검토
중 vitest mockability 손실이 발견되어 deferred.

# 원인

현재 webview-distributed model 에서 vitest 가 검증할 수 있는 surface:

- store mutation → vitest 가 `useConnectionStore.setState({...})` 직접 조작
- session-storage → `vi.mock("@lib/session-storage", ...)` 로 fake 삽입
- Tauri call → `vi.mock("@lib/tauri", ...)` 로 fake 삽입
- IPC bridge subscriber → `attachZustandIpcBridge` 자체를 mock 가능

Rust=server 패턴으로 전환 시:

- store SoT 가 Rust process. webview 의 useStore 는 IPC subscribe 결과
  mirror.
- vitest 가 Rust process 를 띄울 수 없음 → store state 자체가 mock target
  이 됨 (`vi.mock("@stores/connectionStore", ...)`).
- **store state 가 mock 이면 store 의 transition / invariant 검증 못함**.
  현재 `cross-window-connection-sync.test.tsx` 같은 vitest simulation 이
  검증하는 SYNCED_KEYS broadcast 순서 / persist origin ownership / hydrate
  timing 은 store 가 real 일 때만 의미 있음.
- 결국 검증 surface 가 vitest → **e2e (real Rust process + real
  WKWebView)** 로 이동.

따라서 Rust=server 진입 = e2e 가 작동하는 상태 가 prerequisite. 그런데
e2e 는 dead (lesson `e2e/2026-05-06-vite-oom-host-prereq-cross-window-
invariant/`). 진입 trigger 못 만족.

# 재발 방지

- architectural shift sprint (Rust=server / SharedWorker / storage event)
  검토 시 **현재 검증 surface 와 shift 후 검증 surface 비교** 를 contract
  의 invariant 섹션에 명시. shift 후 검증 surface 가 죽어 있으면 진입
  보류.
- "저자가 vitest mock 으로 잡고 있던 invariant 가 shift 후 어디서 잡히
  는가?" 를 sprint planning 시 explicit 답변. 답이 "e2e" 이면 e2e 상태
  점검 → dead 면 prerequisite sprint 분리.
- vitest mockability 는 architectural decision 의 한 축이지 단순 테스트
  편의 문제가 아님. mockability 손실 = 회귀 가드 손실 (대체 가드 없으면
  감지 불가능한 회귀 영역 생성).
- Rust=server / SharedWorker / storage event 같은 shift option 은
  **e2e 가 살아 있고 12+ commit drift 가 정리된 후** 진입 가능. 그 전
  까지는 narrow extraction (read-only / origin-local) 만 진행.

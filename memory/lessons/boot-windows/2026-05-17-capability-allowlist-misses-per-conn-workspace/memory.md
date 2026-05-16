---
title: Tauri 2 capability allowlist 가 sprint-361 의 per-conn workspace 라벨을 미반영해 cross-window event 가 silent deny
type: lesson
date: 2026-05-17
---

**상황**: 사용자 반복 보고 — "친구 테마가 창 단위로 적용된다", "여전히 창들 사이에서 동기화가 안돼". `persist_setting` 의 backend emit 추가 (회귀 7 fix d296601) + frontend optimistic mutate (4d68a9e) 후에도 cross-window sync silent fail. 진짜 root cause 는 한 layer 깊은 곳 — `src-tauri/capabilities/default.json` 의 `windows` allowlist 가 `["launcher", "workspace"]` 만 포함하고 sprint-361 의 `workspace-{conn_id}` 패턴 미반영.

**원인**: sprint-361 (Phase 3, Q13) 이 workspace 창을 per-connection 으로 분리하면서 라벨 scheme 을 `"workspace"` → `"workspace-{conn_id}"` 로 바꿨지만 capability 의 windows allowlist 동기화 변경 누락. Tauri 2 는 capability 매칭 안 되는 window 에서 `core:event:allow-listen` / `core:event:allow-emit` 호출을 silent deny — frontend bridge (`theme-sync`) 와 backend `state-changed` 두 path 모두 차단. 모든 cargo test / vitest 가 GREEN 으로 떨어졌다 (test 가 jsdom mock / MockRuntime 안에서 capability 매칭을 모방 안 함).

**재발 방지**: capability JSON 의 windows allowlist 가 known label 패턴 (sprint-150 launcher, sprint-361 `workspace-*` glob) 을 cover 하는지 build-time integration test 로 lock (`tests/capability_allowlist_workspace_pattern.rs`). 새 sprint 가 window label scheme 을 바꾸면 `capabilities/default.json` 의 windows + 본 test 를 동시에 update 하는 게 PR scope. cross-window 회귀가 silent — 보이는 layer (store, DOM, emit fn) 가 멀쩡해 보여도 capability layer 에서 차단되면 같은 증상.

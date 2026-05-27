---
title: sprint-365 emit_state_changed 함수는 만들었으나 sprint-368 persist_setting 이 호출 안 해 cross-window 테마 sync silent fail
type: lesson
date: 2026-05-17
---

**상황**: 사용자 보고 (Wave 9.5 회귀 7) — "친구 테마가 창 단위로 적용되는 것 같아. 모든 창이 공유해야 하는데". `emit_state_changed` grep 시 backend 호출 site 0개 — sprint-365 가 함수만 만들고 sprint-368 의 `persist_setting` 이 호출 안 함. backend-driven cross-window 알림 path 가 통째로 끊겨 있었으나 unit test (sprint-365 의 `emit_state_changed_payload`, sprint-368 의 AC-368-03 dispatch) 는 모두 GREEN — 두 test 가 각각 "함수가 emit 한다" / "dispatcher 가 받으면 mutate" 만 lock 하고 가운데 wiring 은 누구도 안 lock.

**원인**: sprint-365 가 emit 인프라 sprint, sprint-368 가 receiver sprint 로 쪼개졌지만 emit 호출 site (caller wiring) 는 어느 sprint 의 scope 에도 명시되지 않은 채로 한 sprint 가 다음에 넘기는 식이 됐다. 검증 surface 는 (a) emit fn 의 wire shape, (b) receiver 의 dispatch, 두 끝점뿐 — 사용자 journey 의 중간 wiring (`persist_setting` 의 emit 호출) 이 두 단언 사이의 dark zone 으로 떨어짐. backend test 가 unit-scope 라 cross-cutting "함수가 어디서 호출되는지" 검증 못 함.

**재발 방지**: cross-window emit infrastructure 를 만드는 sprint 는 caller wiring 까지 sprint scope 에 포함 (또는 즉시 next sprint 가 wiring 만 단독으로 다룸). emit 함수가 새로 생기면 user-journey integration test 두 짝 lock — (1) frontend bridge inbound → store + DOM + LS (jsdom + in-memory bus mock), (2) Rust MockRuntime 으로 caller (예: `persist_setting_with_emit`) → state-changed payload 단언. 두 짝의 wire shape 가 동일해야 backend ↔ frontend contract drift 자동 노출.

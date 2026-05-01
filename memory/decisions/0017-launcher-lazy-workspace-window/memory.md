---
id: "0017"
title: Sprint 175 — workspace WebviewWindow를 lazy 생성으로 전환
status: Accepted
date: 2026-04-30
supersedes: null
superseded_by: null
---

**결정**: workspace `WebviewWindow`를 `tauri.conf.json` `app.windows[]`에서 제거하고, `launcher::build_workspace_window`의 hardcoded defaults(1280×800, min 960×600, resizable, maximizable, centered, born hidden)로 첫 `workspace_show`/`workspace_ensure` 호출 시 lazy 생성한다.
**이유**: Sprint 175 Sprint 2 iteration 1.5 sub-instrumentation(`setup` + per-window `on_page_load` 추가)이 release-mode 5-trial 측정으로 (a) launcher와 workspace의 `page-load:Started`가 0.1ms 이내 동시 발화함 → `workspace.visible: false`임에도 boot 시 두 WKWebView가 동시 spawn됨을 입증, (b) `rust:entry → rust:setup-done`이 1124ms median = segment의 75%를 차지함을 입증. AC-175-02-02 "profile-backed claims only" 룰이 가장 큰 profile-attributed sub-segment를 타깃으로 강제.
**트레이드오프**: + 첫 cold boot에서 workspace WKWebView spawn cost가 사라짐 (`rust:entry → rust:first-ipc` 5.8% 감소: 1490 → 1404ms; 메모리 footprint 1 webview 분 감소). - 첫 user activation에서 workspace 빌드 latency(~700ms) 노출, 단 사용자가 connection을 명시 클릭한 직후라 latency expectation 존재. - workspace 윈도우 shape이 `tauri.conf.json`과 분리됨 — 변경 시 Rust default(`build_workspace_window`)와 동기 갱신 필요. - e2e 테스트가 boot 시 workspace를 가정하면 깨질 수 있음 (`workspace_ensure` retry 패턴이 production path는 보존).
**측정 결과**: pre-sprint-2 median 1490.04ms / p95 1623.88ms → post-sprint-2 median 1403.85ms / p95 1492.46ms = **5.8% wall-clock 감소**. AC-175-02-04 ≥30% 목표는 **미달성** — workspace 단독 제거는 OS-level parallel spawn 때문에 expected 50% savings를 내지 못함. 잔여 ~1067ms는 launcher 단독 WebKit cold start로 application-layer 외부.

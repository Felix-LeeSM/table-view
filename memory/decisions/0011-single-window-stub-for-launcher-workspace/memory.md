---
id: 0011
title: Sprint 149 — single-window stub으로 launcher/workspace lifecycle invariants 잠금, 실제 윈도우 분리는 phase 12 이월
status: Accepted
date: 2026-04-27
supersedes: null
superseded_by: null
---

**결정**: AC-141-* (launcher 720×560 fixed / workspace 1280×800 resizable 분리 윈도우)을 Sprint 149에서 single-window screen toggle stub으로 잠그고, 실제 두 Tauri 윈도우 분리는 phase 12로 이월한다. 이월은 ADR + RISK-025 + `it.todo()` 5개 + findings의 4중 강제 메커니즘으로 잠근다.

**이유**: 별도 윈도우 분리는 connection/tab/appShell/mru/theme 5개 store에 IPC 동기화 layer + tauri.conf.json 윈도우 재정의 + Rust launcher module 신설 + 기존 2239개 테스트와 e2e 전 시나리오 회귀 위험을 한 sprint에 묶는 작업으로 단일 sprint 작업 단위를 초과한다. 사용자 관측 가능한 lifecycle invariants(boot→home, 활성화→workspace, Back→home하면서 pool 유지, Disconnect는 pool eviction)는 single-window screen toggle 위에서도 의미가 보존되므로 회귀 테스트로 우선 잠근다.

**트레이드오프**: + 즉시 출시 가능 + 회귀 테스트는 phase 12에서 그대로 재활용 가능 + 4중 강제 메커니즘으로 이월 작업 망각 방지 / - stub은 실제 WebviewWindow lifecycle(show/hide/focus/close 이벤트)을 검증하지 못함 - phase 12 진입 시 이 ADR을 superseding하는 새 ADR + 5개 store IPC bridge가 별도 추가되어야 함.

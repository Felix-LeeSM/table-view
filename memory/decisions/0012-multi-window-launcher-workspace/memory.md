---
id: 0012
title: Phase 12 — launcher/workspace 별도 WebviewWindow + cross-window IPC sync 완성
status: Accepted
date: 2026-04-27
supersedes: 0011
superseded_by: null
---

**결정**: launcher(720×560 fixed)와 workspace(1280×800 resizable)를 `tauri.conf.json`에 별도 `WebviewWindow`로 선언하고, AppRouter가 boot 시점 `getCurrentWindowLabel()`로 분기, `@lib/window-controls` seam(show/hide/focus/exit + close-requested)으로 5개 lifecycle 전환(Activate / Back / Disconnect / LauncherClose / WorkspaceClose)을 wired한다. connection / tab / mru / theme / favorites 5개 store에 `attachZustandIpcBridge`로 cross-window IPC sync를 부착해 두 창이 공유 상태를 관찰한다. ADR 0011의 single-window stub은 이로써 supersede.

**이유**: Sprint 149의 single-window stub은 사용자 관측 invariants만 회귀로 잠갔을 뿐 실제 WebviewWindow lifecycle을 검증하지 못했다. Sprint 150–154가 (1) Tauri command surface, (2) cross-window IPC bridge, (3) per-store sync wiring, (4) 실제 lifecycle 라우팅을 단계적으로 추가했으므로 Phase 12에서 ADR 0011을 superseding하는 새 결정으로 동결한다.

**트레이드오프**: + 실제 두 창 lifecycle wired + 5개 store cross-window propagation 일관성 + jsdom 단위 테스트는 seam mock으로 ordering까지 잠금 / - jsdom 환경에서 실제 `WebviewWindow.show/hide/setFocus`는 직접 검증 불가 (seam mock 의존, 통합 검증은 e2e/수동 QA 영역) - 5개 store IPC sync는 origin echo / allowlist 등 추가 표면을 영구히 유지해야 함.

---
id: "0014"
title: E2E multi-window 대응을 위한 browser.switchWindow 도입
status: Accepted
date: 2026-04-29
supersedes: null
superseded_by: null
---

**결정**: tauri-driver는 단일 창에만 연결되므로, launcher↔workspace 전환 시마다 browser.switchWindow()로 WebDriver 컨텍스트를 명시 전환.
**이유**: Phase 12(sprint 150)에서 launcher + workspace 두 Tauri 창으로 분리했으나, tauri-driver는 초기 창(launcher)에만 붙어 workspace DOM 접근 불가.
**트레이드오프**: + 모든 spec이 정상 동작 / - 각 전환 지점에 switchWindow 호출을 수동으로 추가해야 함, macOS 미지원.

---
title: Tauri 2 다중 WKWebView spawn은 OS-level parallel — 한 윈도우 lazy화로는 wall-clock을 크게 못 줄인다
type: lesson
date: 2026-04-30
---

**상황**: Sprint 175 Sprint 2에서 launcher + workspace 두 윈도우의 cold-boot `page-load:Started`가 모든 trial에서 0.1ms 이내로 동시 발화하는 것을 instrumentation으로 확인. workspace를 `tauri.conf.json`에서 제거하고 lazy로 전환하면 `setup-done`(1124ms / 75% of segment)이 ~50% 줄어들 것으로 가설했으나 실측은 5.1%(56ms)에 그침. 전체 cold-boot 5.8% 감소 → AC-175-02-04 ≥30% 미달성.
**원인**: Tauri 2는 `app.windows[]`의 모든 윈도우를 boot 시 생성하고, 각 WKWebView spawn은 OS가 web/GPU/network helper 프로세스를 별도 fork — 두 윈도우의 spawn은 wall-clock으로 거의 완전 overlap한다. "두 윈도우 = 두 배 시간" 모델은 macOS WebKit에서 거짓. 한 윈도우를 빼도 다른 윈도우의 spawn 시간이 그대로 남는다.
**재발 방지**: cold-boot 측정에서 application-layer 변경을 검토할 때, OS-level parallelism 가정을 *명시* 검증한다. `setup-done` 같은 단일 marker가 다중 윈도우 환경에서 동일 시각에 도달하면 직렬-가정 모델 폐기. Cold-boot ≥1초 영역은 OS process spawn(WebKit web+GPU+network helpers)이 지배하는 floor — Rust 단에선 닿지 않는다. 추가 절감은 (a) Sprint 3-style splash UI로 *perceived* TTI 우회 또는 (b) Tauri/WebKit upstream 최적화에 의존.

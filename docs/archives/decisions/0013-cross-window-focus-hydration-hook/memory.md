---
id: 0013
title: 크로스 윈도우 상태 동기화: IPC bridge + session localStorage + useWindowFocusHydration 훅
status: Accepted
date: 2026-04-29
supersedes: null
superseded_by: null
---

**결정**: launcher/workspace 양쪽 모두 `useWindowFocusHydration` 훅을 사용해 mount 및 window focus 시 `hydrateFromSession()`을 호출하여 IPC bridge 이벤트 유실을 복구한다.
**이유**: Tauri hidden webview가 IPC 이벤트를 놓치는 경우가 있어, session localStorage를 window focus 시점에 재읽기하는 것이 유일한 신뢰 가능한 폴백이다. 인라인 useEffect를 각 페이지에 복사하는 대신 공유 훅으로 중앙화했다.
**트레이드오프**: + 양쪽 윈도우에서 동일한 동기화 로직 보장, 유지보수 한 곳 / - focus 이벤트마다 localStorage 읽기 + JSON parse 비용 (경미함) / - IPC bridge + session storage 두 경로가 존재해 복잡도 증가.

---
title: Tauri hidden workspace의 boot-time hydration은 빈 데이터를 읽는다 — window focus에서 re-hydrate 해야 한다
type: lesson
date: 2026-04-29
---

**상황**: workspace window가 app 시작 시 hidden으로 생성되어 boot-time `hydrateFromSession()`이 빈 데이터를 읽고, launcher에서 연결 후에도 store가 비어 있어 sidebar가 "Select a connection"을 렌더링한다. IPC bridge `listen`은 async라 emit 타이밍과 race할 수 있다.
**원인**: workspace의 `main.tsx`가 app 시작 시 한 번만 실행되고, 그 시점에는 session storage에 아무것도 없다. IPC bridge의 `listen` Promise가 launcher emit보다 늦게 resolve되면 이벤트가 유실된다.
**재발 방지**: hidden window에서는 mount + `window focus` 이벤트마다 `hydrateFromSession()`을 재호출하여 launcher가 쓴 최신 session data를 읽어온다. IPC bridge는 보조 수단이고 session localStorage가 primary source of truth.

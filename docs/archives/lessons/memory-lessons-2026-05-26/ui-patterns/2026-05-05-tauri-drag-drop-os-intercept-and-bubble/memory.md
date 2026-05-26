---
title: 2026-05-05 · Tauri 2 drag-drop은 두 게이트를 동시에 통과해야 — OS handler 비활성 + 이벤트 버블링 차단
type: lesson
date: 2026-05-05
---

## 상황

connections 사이드바의 connection을 다른 group으로 drag-and-drop 이동이 동작하지 않음.
사용자 관찰: "그룹에서 나가지는 됨, 그룹에 들어가지지는 않음."
unit test 140개 통과, 백엔드 command 등록 정상, store 액션도 정상.

## 원인 (두 단계 걸쳐서)

**1. Tauri 2 OS-level drag-drop intercept (1차 게이트).** `dragDropEnabled` 기본값
`true` — wry가 OS file-drop 핸들러를 등록해서 webview의 `drop` 이벤트를 가로챔.
launcher와 동적 생성된 workspace 둘 다 disable 필요. JSON config는 `"dragDropEnabled":
false`, Rust builder는 `.disable_drag_drop_handler()`. unit test (jsdom)는 Tauri 런타임이
없어서 못 잡음.

**2. 중첩 drop target의 이벤트 버블링 (2차 게이트).** `ConnectionGroup`의 drop
handler가 헤더 div에만 달려 있고 `e.stopPropagation()` 없음. 부모 `ConnectionList`도
drop handler를 가짐 (ungroup용). 사용자가 group에 drop → ConnectionGroup.onDrop → bubble
→ ConnectionList.onDrop. 두 번째가 첫 번째를 덮어써서 net 결과는 ungroup. "exit OK,
entry NG" 증상의 정확한 매커니즘.

## 재발 방지

- **Tauri 2 + HTML5 dnd**: 새 window 생성 시 (config든 `WebviewWindowBuilder`든) drag-drop
  flag를 명시적으로 결정. 기본값에 의존하지 않는다. drag-drop 사용처는 e2e 또는 dev-mode
  manual 검증 필수 (jsdom unit test로는 이 게이트를 못 잡음).
- **중첩 drop target**: 부모/자식 둘 다 drop을 처리하면 자식은 무조건 `e.stopPropagation()`.
  추가로 자식의 drop 영역을 visual extent와 일치시켜 "어디든 떨어뜨려도 자연스럽게
  해석"되도록 wrapper로 감싼다 (positional sophistication).
- **회귀 테스트**: `<div onDrop={parentDrop}><Child/></div>` 형태로 부모-자식 drop
  격리 테스트를 단위 레벨에서 lock — propagation 회귀를 jsdom에서도 잡을 수 있다.

## 관련

- `src-tauri/tauri.conf.json` — `dragDropEnabled: false`
- `src-tauri/tauri.e2e.conf.json` — 동일 (e2e용 양쪽 윈도우 모두)
- `src-tauri/src/launcher.rs::build_launcher_window` / `build_workspace_window` —
  `.disable_drag_drop_handler()`
- `src/components/connection/ConnectionGroup.tsx` — wrapper div + `stopPropagation`
- `src/components/connection/ConnectionGroup.test.tsx` — 부모-자식 drop 격리 회귀 테스트
- 진단 플랜: `/Users/felix/.claude/plans/magical-enchanting-hejlsberg.md`

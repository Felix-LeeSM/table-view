---
id: 0007
title: ThemePicker hover preview는 Zustand store 거치지 않고 DOM-only로 적용
status: Accepted
date: 2026-04-24
supersedes: null
superseded_by: null
---

**결정**: ThemePicker에서 카드 hover 시 테마 미리보기는 `useThemeStore`를 건드리지 않고 `applyTheme(previewId, mode)`로 `document.documentElement` 속성만 바꾼다.
**이유**: 프리뷰는 localStorage/store에 영속될 필요가 없고, store에 preview slot을 추가하면 모든 selector·hydration 경로·구독자에 영향을 주므로 DOM-only가 변경 경계를 가장 좁게 유지한다.
**트레이드오프**: + store/localStorage 오염 없음, 구독자 무변경, 로직이 picker 내부에 격리됨 / - 언마운트 시점에 DOM을 store의 영속 테마로 되돌리는 전용 cleanup `useEffect`가 필요함.

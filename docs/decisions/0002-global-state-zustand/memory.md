---
id: 0002
title: Zustand로 상태 관리
status: Accepted
date: 2026-01-01
---

**결정**: 전역 상태는 Zustand, 지역 상태는 useState/useReducer.
**이유**: Redux/Context 대비 보일러플레이트 최소. persist middleware로 localStorage 연동 간단. 작은 selector 단위로 리렌더 최적화 쉬움.
**트레이드오프**: + 코드 단순, 타입 최소 / - Redux DevTools 연결은 수동, 복잡 비동기 흐름은 middleware 직접 작성 필요.

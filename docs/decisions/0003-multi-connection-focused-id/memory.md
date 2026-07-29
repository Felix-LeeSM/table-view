---
id: 0003
title: 다중 connection + focusedConnId store 승격
status: Accepted
date: 2026-04-20
---

**결정**: 백엔드 다중 active 유지, 프론트는 `focusedConnId`를 Sidebar 로컬 state → connectionStore 전역 state로 승격. 한 번 클릭 = focus + schema tree 전환, 더블클릭 = disconnected → connect.
**이유**: Sidebar 로컬 state로는 TabBar·MainArea·헤더가 "현재 보고 있는 connection"을 읽을 수 없어 UX 일관성 깨짐.
**트레이드오프**: + 전역 일관성, tab stripe color 자동 유도 가능 / - store 복잡도 증가, disconnect/remove 시 fallback 로직 필요.

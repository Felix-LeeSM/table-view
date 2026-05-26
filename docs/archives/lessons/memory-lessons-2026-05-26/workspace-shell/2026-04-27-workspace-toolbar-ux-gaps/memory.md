---
title: workspace toolbar UX 갭 3건 (sprint 127-133 사용자 점검)
type: lesson
date: 2026-04-27
---

**상황**: Sprint 127-133 toolbar 활성화 후 사용자 점검에서 (1) ConnectionSwitcher popover와 DbSwitcher popover 크기가 동일해 ConnectionSwitcher가 과하게 큼 (2) ConnectionSwitcher에서 새 connection 선택해도 활성 connection으로 반영 안 됨 — workspace toolbar의 connection 선택과 sidebar의 connection 선택이 SoT 1개로 묶이지 않음 (3) MongoDB paradigm query tab에서 query editor 자동완성이 여전히 SQL 사전 사용.
**원인**: toolbar 컴포넌트가 공용 Popover/Select 기본 크기를 그대로 쓰고, ConnectionSwitcher의 onValueChange가 active tab 라우팅만 하고 connectionStore.setActiveConnection을 호출하지 않으며, query editor의 completion provider가 paradigm 분기 없이 SQL keyword만 등록.
**재발 방지**: workspace toolbar / query editor 컴포넌트 추가·수정 시 (a) popover 크기를 컴포넌트별 min-width 명시, (b) 같은 의미를 가진 control은 어떤 store가 SoT인지 contract에 명시, (c) paradigm-aware 동작은 paradigm enum 전 케이스가 분기되는지 assertNever로 확정 — 3축 체크리스트로 점검.

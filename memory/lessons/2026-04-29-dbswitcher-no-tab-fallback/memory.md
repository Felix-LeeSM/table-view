---
title: DbSwitcher는 active tab이 없을 때 focusedConnId 기반으로 activeDb를 표시해야 한다
type: lesson
date: 2026-04-29
---

**상황**: workspace 열자마자 DbSwitcher가 "—"를 표시하고, 테이블을 클릭해 탭이 열린 후에야 database 이름이 나타난다. WorkspaceSidebar는 focusedConnId fallback이 있지만 DbSwitcher는 없었다.
**원인**: DbSwitcher가 `activeTab`이 null이면 무조건 "—" em dash를 반환하도록 hard-coded되어 있었다. `focusedConnId`를 전혀 참조하지 않았다.
**재발 방지**: toolbar 컴포넌트의 "driving connection" 해석 로직은 sidebar와 동일하게 active-tab → focusedConnId 순으로 폴백해야 한다. 새 toolbar 컴포넌트를 추가할 때 WorkspaceSidebar의 해석 패턴을 따르도록 설계한다.

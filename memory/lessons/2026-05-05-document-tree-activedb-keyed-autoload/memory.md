---
title: DocumentDatabaseTree auto-load guard는 (connectionId, activeDb)로 keying해야 한다 — DbSwitcher swap이 cache를 비울 때 tree가 재-fetch되지 않으면 stale collection이 노출된다
type: lesson
date: 2026-05-05
---

**상황**: 2026-04-27 sprint 137에서 DbSwitcher로 active database를 바꾸면 sidebar tree가 비거나 직전 DB의 collection 목록을 그대로 보여주는 회귀가 보고됐다.
**원인**: DbSwitcher는 `switch_active_db` dispatch 후 documentStore의 connection 캐시를 `clearConnection(id)`로 비우지만, `DocumentDatabaseTree`의 auto-load `useEffect` guard ref가 `connectionId`만 watch했다. connection이 동일하면 guard가 단락(short-circuit)해 `loadDatabases`를 다시 부르지 않아 tree가 빈 store를 그대로 렌더했다.
**재발 방지**: DocumentDatabaseTree(및 동일 contract를 따르는 paradigm tree)의 auto-load guard key는 `${connectionId}::${activeDb ?? ""}` 형태로 active DB까지 포함해야 한다. `useDocumentDatabaseTreeData`의 `autoLoadedRef`가 캐노니컬 — 새 paradigm tree를 만들 땐 동일 패턴(active selector + composite guard)을 따른다.

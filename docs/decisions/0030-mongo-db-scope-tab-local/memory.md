---
id: 0030
title: Mongo DB-scope — toolbar chip 제거, tab-local chip + sidebar 우클릭 entry-point
status: Accepted
date: 2026-05-15
---

**결정**: Mongo (document) paradigm 의 "현재 DB" 표시는 DataGrip 패턴으로
영구 정착한다.

1. **Toolbar global `DbSwitcher`** 는 Mongo paradigm 에서 *렌더되지
   않는다*. RDB (PostgreSQL/MySQL) paradigm 에서는 그대로 유지.
2. **Query tab 좌상단**에 `TabDbChip` (tab-local display) 가 mount 된다.
   chip 은 *읽기 전용* — 클릭하면 popover 가 열리고 사용자를 sidebar
   entry-point 로 안내한다 (`right-click a database in the sidebar →
   New query here`).
3. **Sidebar `DocumentDatabaseTree`** 의 database row 우클릭 →
   "New query here" 가 유일한 mutation entry-point. 클릭한 row 의
   database 로 prefilled mongosh query tab 을 spawn (`addQueryTab(connId,
   dbName, { paradigm: "document", database: dbName })`).

**이유**:

1. **Mongo database ≈ PG schema** — Mongo 는 한 connection 안에서
   cross-DB query 가 자유이며, `db.getSiblingDB` / `use` 의 mental model
   은 PG schema 의 그것 (cross-namespace 자유 + 같은 catalog) 에 가깝다.
   PG database 의 강 격리 (connection-level isolation, 별도 sub-pool 필요)
   는 Mongo 에 적용되지 않는다. 따라서 toolbar 의 *connection-level
   active DB* chip 은 RDB 에는 맞지만 Mongo 에는 semantic mismatch.
2. **Sidebar tree 와 toolbar 의 redundancy** — Mongo 는 sidebar 가 이미
   database → collection 트리를 보여준다. 같은 정보를 toolbar 가 글로벌
   state 로 또 노출하면 (a) 두 surface 가 동기화되지 않을 때 사용자가
   혼란스럽고, (b) sidebar 클릭이 toolbar global state 를 흔드는
   MySQL Workbench 식 안티패턴이 들어오기 쉽다. 사용자가 "Mongo 에서
   database 가 두 군데 보이는 게 redundant" 라고 제기 (2026-05-15).
3. **Backend wrapper signature 와의 정합성** — Mongo Tauri command 들
   (`find_documents`, `bulk_write_documents`, `list_mongo_collections`,
   ...) 은 모두 `(connection_id, database, collection, ...)` 인자를
   받는다. connection-level mutable state 가 IPC 호출에 영향을 주지
   않으므로 frontend 측의 connection-level state 는 *시각적 grouping*
   외에 사용되지 않는다. tab-level scope 로 옮기는 게 backend 와 1:1.
4. **Compass / DataGrip 검증** — 다른 GUI 도구 5개 (MongoDB Compass,
   Studio 3T, DataGrip, DBeaver, MySQL Workbench, TablePlus) 비교 결과
   DataGrip 패턴 (tab-local scope + sidebar 비동기화 + 명시적 entry-point)
   이 (a) Mongo + RDB 모두 처리, (b) backend stateless wrapper 와 1:1
   정합, (c) "한 view = 한 state" 원칙을 만족하는 유일한 패턴.
   비교: `docs/explorations/mongo-db-scope-patterns.html`.

**트레이드오프**:

- **+** Mongo paradigm 의 toolbar 가 한 chip 만큼 단순. redundancy 해소.
- **+** tab 단위 scope 라 한 connection 에 여러 DB 의 tab 이 자연스럽게
  공존 (e.g. `app.users` tab + `staging.events` tab 동시 작업).
- **+** 향후 Mongo backend wrapper 추가 (Sprint 332+ 의 `list_indexes`,
  `collStats`, `explain` 등) 시 모든 호출이 tab.database 를 IPC 인자로
  넘기는 통일된 패턴.
- **−** 처음 Mongo connection 연결 직후 toolbar 가 "비어 보임" — 사용자가
  "active DB" 가 어디 표시되는지 학습 필요. 단, query tab 을 만드는 순간
  TabDbChip 이 즉시 가시화되므로 학습 곡선 짧음.
- **−** `MongoAdapter::switch_active_db` / `current_active_db` /
  `active_db` 필드는 frontend 호출 경로가 사라졌지만 *backend 측에서는
  살아있다* — `resolved_db_name` 이 `default_db` fallback 처리에 이
  필드를 여전히 읽는다 (connection 의 first list_collections 호출 시).
  따라서 backend dead code 제거는 본 ADR 의 범위가 아님. 후속에서
  더 큰 refactor 로 묶일 수 있다.

**관련**:

- Sprint 328 — toolbar DbSwitcher Mongo hide.
- Sprint 329 — `TabDbChip` (tab-local display + sidebar 안내 popover).
- Sprint 330 — sidebar `DocumentDatabaseTree` database row 우클릭
  "New query here" entry-point.
- Sprint 331 — 본 ADR (closure).
- Exploration: `docs/explorations/mongo-db-scope-patterns.html` (5개 도구
  비교 + DataGrip 패턴 정착 근거).
- ADR 0010 (paradigm-aware UI) — RDB vs Document 분기는 컴포넌트 단위
  로 한다는 상위 원칙과 정합.
- ADR 0027 (per-workspace state store) — workspace 가 `(connId, db)` 로
  key 되어 있으므로 tab-level scope 가 store 의 grain 과 1:1.

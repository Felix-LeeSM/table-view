# Sprint 143 — Handoff (다음 sprint 144 으로)

## 결과

- **Status**: PASS — 3/4 AC 충족, AC-148-3 의도적 deferred. vitest /
  tsc / lint 모두 green.
- **다음 sprint baseline**: 모든 RDB row-count 셀이 항상 DOM 에
  존재한다 (`[data-row-count="true"]`). 값은 `~N` / `?` 두 형태로
  통일됐고, helper (`rowCountText`, `rowCountLabel`) 가 단일 진실로
  텍스트 + a11y 카피를 결정한다. 따라서 후속 lazy-fetch sprint 가
  cache hit 시 셀 콘텐츠를 교체하기 위해 추가 mount/unmount 분기를
  도입할 필요가 없다.

## sprint-144 가 의지하는 베이스라인

- `tableview:activeDb:{id}` 키가 localStorage 네임스페이스로 등록됨.
  Mongo 외 다른 paradigm 도 같은 키를 공유 (RDB connection 이 DB switch
  를 시작하면 자동으로 같은 메커니즘으로 영속화됨).
- `loadPersistedActiveDb(id)` / `persistActiveDb(id, db)` /
  `clearPersistedActiveDb(id)` 헬퍼는 connectionStore 모듈 사적
  스코프 — sprint-144 가 노출 필요 시 export 추가만으로 가능.
- `rowCountText(dbType, value)` 의 시그니처가 모든 호출 사이트에
  동일하게 적용 — 후속 sprint 가 exact-fetch cache 를 추가하면
  `rowCountText(dbType, value, cachedExact)` 로 시그니처 확장 후 한
  곳에서만 조건 분기 추가하면 된다.

## sprint-144 시작 전 체크 (Sidebar schema unified view + Functions filter)

- spec.md AC-145-* 매핑 확인. 본 sprint chain 에서 sprint-141 dir =
  AC-146-*, sprint-142 dir = AC-147-*, sprint-143 dir = AC-148-* 로
  진행되어왔다. sprint-144 dir = **AC-145-*** (Sidebar 단일 schema view +
  Functions filter).
- 관련 핵심 파일: `src/components/sidebar/Sidebar.tsx`,
  `src/components/schema/SchemaTree.tsx` (treeShape 분기 / Functions
  카테고리 렌더). topbar schema selector 제거 위치도 확인 필요
  (`workspace/WorkspaceToolbar` 등).
- AC-145-3 (Functions 노드 클릭이 sidebar width 를 변형하지 않는다) 는
  layout regression 테스트 후보 — `getBoundingClientRect()` 차이 ≤ 1px.

## 미결 / 다음에 얹을 것

- **AC-148-3 (lazy exact-count fetch)** — 별도 sprint 에서 진행:
  1) Rust trait method `RdbAdapter::count_rows_exact(schema, table) -> i64`
     + PG/MySQL/SQLite 구현 (`SELECT COUNT(*)`).
  2) Mongo 는 `db.collection.countDocuments({})` — 별도 dispatch
     혹은 paradigm-agnostic 인터페이스.
  3) Tauri command `count_rows_exact(connection_id, schema, table)` 추가.
  4) 프론트: `src/lib/rowCount/cache.ts` (Map<connId, Map<key, number>>),
     `SchemaTree` 셀에 hover/focus 200ms debounce → invoke → cache write
     → `rowCountText` 가 cache hit 시 `~N` / `?` 대신 `N` 출력.
- 본 sprint 가 추가한 `?` 케이스(`row_count: null`) 가 PG 사용자에게도
  표시된다. ANALYZE 직후에는 `?` → `~N` 으로 자연 전환되는데, 신규 빈
  테이블에서 `?` 가 영구 표시될 수 있음 (사용자가 ANALYZE 하기 전).
  AC-148-3 lazy fetch 가 이 케이스도 즉시 정확값으로 채워준다.
- `removeConnection` 호출 경로에서 `tableview:activeDb:{id}` 키를
  cleanup 하는지 확인 필요. 현재는 `disconnectFromDatabase` 만
  cleanup 하므로 connection 을 삭제 (remove) 했지만 disconnect 안 한
  케이스에서 stale 키가 남을 수 있다. 후속 sprint 에서 점검 가능.

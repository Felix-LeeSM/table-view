# Sprint 142 — Handoff (다음 sprint 143 으로)

## 결과

- **Status**: PASS — 4/4 AC 충족, vitest/tsc/lint 모두 green.
- **다음 sprint baseline**: tab swap 이 React 측에서 unmount 를 강제하므로 모든 tab-bound 로컬 상태(useState/useRef)가 자동으로 격리됨. 향후 sprint 가 tab-scoped 캐시(예: row count cache) 를 추가할 때 이 invariant 위에서 작업할 수 있다.

## sprint-143 가 의지하는 베이스라인

- `data-preview="true"` 속성이 DOM 에 노출되므로 e2e 테스트(`feedback-2026-04-27.spec.ts` 의 #8 시나리오) 가 attribute selector 로 preview 탭을 찾을 수 있다. sprint-143 (Row count UX + Mongo persistence) 은 동일 attribute 스타일(`data-row-count-cell`, `data-active-db` 등) 을 따라가면 일관성이 유지된다.
- `MainArea` 의 `key={activeTab.id}` invariant 가 들어왔다 — sprint-143 이 row count cache 를 introduce 할 때, cache 자체는 connection-scoped 글로벌 store 에 둬야 한다 (탭별 hook 인스턴스에 두면 unmount 시 사라짐).

## sprint-143 시작 전 체크

- `e2e/feedback-2026-04-27.spec.ts` 의 #10 (row count tilde + lazy exact) / #12 (Mongo DB 영속화) 시나리오가 sprint-143 의 첫 red 테스트 후보.
- 백엔드 신규 command `count_rows_exact(connection_id, schema, table)` 가 필요. PG 는 즉시 `SELECT COUNT(*)`, MySQL/SQLite 도 같은 SQL, Mongo 는 `countDocuments({})`. `src-tauri/src/commands/schema.rs` 에 추가.
- 추정치 source: PG `pg_stat_user_tables.n_live_tup`, MySQL `information_schema.TABLES.TABLE_ROWS`, SQLite 는 `?` (메타 부재). 이미 일부 PG 경로에 `n_live_tup` 가 들어있을 가능성이 있음 — 먼저 grep 으로 점검 후 통합/추가 결정.

## 미결 / 다음에 얹을 것

- Query 탭의 dirty marker 는 본 sprint 범위 밖. SQL/MQL 텍스트 변경을 dirty 로 표시하려면 별도 tabStore 액션 + `QueryEditor` 의 `onSqlChange` 핸들러에서 dirty publish 가 필요하다 — 후속 sprint 에서 다룬다(필요 시 spec 갱신).
- `useDataGridEdit` 의 pendingEdits 영속화는 본 sprint 의 의도된 trade-off. 만약 사용자 피드백이 또 들어와 "탭 전환 후 편집 유지" 요구가 명확해지면, pendingEdits 를 `useEditDraftStore` (Map<tabId, EditDraft>) 형태로 zustand 에 끌어올리는 후속 sprint 가 필요하다.

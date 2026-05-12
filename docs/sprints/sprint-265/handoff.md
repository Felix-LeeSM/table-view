# Sprint 265 Handoff — documentStore `(connId, db)` nested cache

## Status

Complete. `documentStore` 의 4 캐시 차원이 flat colon-key 에서 nested
`(connId, db, collection)` 맵으로 lifting. 회귀 0, neue cross-connection
isolation 가드 2 케이스.

## Acceptance Criteria — verification

| AC | 결과 |
|---|---|
| AC-265-01 `documentStore` 자료구조 | ✅ `src/stores/documentStore.ts` — `ByConn<ByDb<...>>` 으로 lift, aggregate 별도 axis (`aggregateResults`) 분리, `clearConnection` 은 axis 당 `delete state[connId]` 한 줄 |
| AC-265-02 callsite migration | ✅ 5 production callsite 모두 nested lookup 으로 — DocumentDataGrid / AddDocumentModal / useDocumentGridData / QueryTab / useDocumentDatabaseTreeData |
| AC-265-03 `DocumentDatabaseTree` collections lookup | ✅ hook 외부 인터페이스 단순화 — `collectionsByDb` 가 `Record<dbName, ...>` 로 (이미 hook 이 connection-scoped) → consumer 도 `[db.name]` 로 단순 조회 |
| AC-265-04 회귀 가드 | ✅ `pnpm vitest run --no-file-parallelism` 258 files / 3195 tests passed (+2 vs 3193 baseline), `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0 |

## 주요 production 변경

| 파일 | 변경 |
|---|---|
| `src/stores/documentStore.ts` | 4 캐시 차원 → nested 맵 + `setNested2/3/4` immutable setter + 모듈 스코프 `requestCounters` (flat string keys 유지) + `clearConnection` axis-당 1-line delete + `__resetDocumentStoreForTests` |
| `src/components/document/DocumentDataGrid.tsx` | `s.fieldsCache[connId]?.[db]?.[col]` |
| `src/components/document/AddDocumentModal.tsx` | 동일 — 단, 3 prop 이 모두 있을 때만 |
| `src/components/document/DocumentDataGrid/useDocumentGridData.ts` | `s.queryResults[connId]?.[db]?.[col]` |
| `src/components/query/QueryTab.tsx` | mongoFieldNames memo 가 `fieldsCache[connId]?.[db]?.[coll]` |
| `src/components/schema/DocumentDatabaseTree/useDocumentDatabaseTreeData.ts` | `collectionsByDb` 외부 시그니처를 `Record<dbName, CollectionInfo[]>` 로 단순화 (이미 hook 이 conn-scoped 이므로 더 깔끔) + `EMPTY_COLLECTIONS_BY_DB` 안정 참조 |
| `src/components/schema/DocumentDatabaseTree.tsx` | consumer 도 `collectionsByDb[db.name]` 로 단순 조회 |

## 테스트 변경

- `src/stores/documentStore.test.ts` — 전부 nested assertion 으로 재작성 +
  Sprint 265 cross-connection isolation 가드 2 케이스 (AC-265-01 의미적 핵심):
  1. **conn-A / conn-B 가 cache slot 을 공유하지 않음** — 두 connection 이
     같은 db 이름이어도 collection 리스트가 분리 (실수로 `[db]` 만으로 좁히면
     마지막-쓰기-승 발생).
  2. **`clearConnection("conn-A")` 가 conn-B 의 cache 를 보존** — flat key
     prefix sweep 시절의 회귀 가드 (`startsWith("conn-A:")` 가 `"conn-A:..."` 와
     `"conn-A-foo:..."` 를 헷갈리는 시나리오는 nested 에서 구조적으로 차단됨).
- `src/components/schema/DocumentDatabaseTree.test.tsx` — `collections[key]`
  3 assertion 을 nested path 로.
- `src/components/document/DocumentDataGrid.test.tsx` — `queryResults[key]`
  1 assertion 을 nested path 로.
- `src/components/document/AddDocumentModal.test.tsx` — fieldsCache seed +
  assertion 모두 nested.
- `src/components/query/QueryTab.dialect.test.tsx` — fieldsCache seed 2 곳
  (document tab 케이스 + RDB-isolation 케이스) nested 로.
- `src/components/workspace/DbSwitcher.test.tsx` — Mongo paradigm 의 cache
  wipe 테스트 seed/assertion nested 로.

## Out of Scope (Sprint 266+ 후보)

spec.md §Out of Scope 와 동일:

1. **Mongo workspace 의 collection-level 분리** — workspaceStore 의
   per-collection state 분리 (Sprint 262 FU #1 의 reasonable deferral).
2. **request counter 의 nested 화** — internal 식별자, 변경 가치 없음
   (counter key 는 flat string 유지).
3. **`databases` 의 nested 화** — 이미 connection-level 자료, 더 분해할
   차원 없음.

또한 Sprint 263 OoS 의 잔여 항목:

- **schema cache TTL / 무효화** (Sprint 263 OoS #2 — "C") — long-running
  session 에서 stale schema 가 표시될 위험. Cache invalidation 정책 필요.
- **backend `database` 파라미터 명시화** (Sprint 263 OoS #3 — "D") —
  pool selection 의 정합성을 위한 type-level enforcement.

## Lessons

- **ADR 0027 의 패턴을 mechanical 하게 적용 가능** — schemaStore (Sprint 263)
  → documentStore (Sprint 265) 의 lift 가 동일 구조. `setNested2/3/4` helper
  set 도 재사용 가능했으나 store 별로 wide 차원 수가 다르고 (RDB: `(connId,
  db, schema, table)` 4 차원, Document: `(connId, db, collection)` 3 차원)
  helper inlining 이 가독성에 더 유리.
- **Hook 외부 인터페이스 단순화 기회** — `useDocumentDatabaseTreeData` 가
  이미 `connectionId` 를 받고 있으면 외부에 노출하는 `collectionsByDb` 의
  key 에 또 conn prefix 를 붙일 이유 없음. nested 화 sprint 는 callsite 의
  prefix-prefixing 패턴을 정리할 좋은 기회.
- **`EMPTY_COLLECTIONS_BY_DB` stable reference** — Zustand selector 에서
  `s.collections[connectionId] ?? {}` 는 매 호출마다 새 `{}` 를 반환해
  consumer 의 useMemo 가 매 render reset 됨. 모듈 스코프 freeze 된 빈
  객체 reference 로 대체.
- **Aggregate cache 분리** — find 와 aggregate 가 같은 `DocumentQueryResult`
  wire type 을 공유하므로 같은 axis 에 cache 하면 type-level 로 결코 잡히지
  않는 cross-contamination 위험. 별 axis 가 zero-cost (`aggregateResults`)
  이고 callsite 도 영향 없음 — type safety 향상.

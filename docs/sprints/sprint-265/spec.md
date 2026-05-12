# Sprint 265 Spec — documentStore (connId, db) nested cache

## Feature Description

`documentStore` 의 4 캐시 차원을 flat colon-key 에서 nested 로 lifting.
RDB schemaStore 의 Sprint 263 작업과 동일 패턴.

| 차원 | 현재 (flat colon-key) | 목표 (nested) |
|---|---|---|
| `databases` | `Record<connId, DatabaseInfo[]>` | 그대로 (connection-level) |
| `collections` | `Record<"connId:db", CollectionInfo[]>` | `Record<connId, Record<db, CollectionInfo[]>>` |
| `fieldsCache` | `Record<"connId:db:col", ColumnInfo[]>` | `Record<connId, Record<db, Record<col, ColumnInfo[]>>>` |
| `queryResults` | `Record<"connId:db:col", DocumentQueryResult>` <br> + `Record<"agg:connId:db:col:json", DocumentQueryResult>` | `Record<connId, Record<db, Record<col, DocumentQueryResult>>>` <br> + aggregate 분기 별도 |

## 배경 — 현재 한계

- Mongo connection 이름이나 db / collection 이름에 `:` 가 포함되면
  cache key parser 가 깨질 수 있음. 현실에선 드물지만 ADR 0027 의
  "separator 충돌 회피" 원칙에 어긋남.
- `clearConnection` 은 `startsWith(prefix)` 로 모든 entry 를 순회하며
  filter — O(n) cleanup. nested 면 `delete state[connId]` 한 줄.
- workspaceStore (Sprint 262) / schemaStore (Sprint 263) 가 모두 nested
  `(connId, db)` 패턴으로 통합되었고, documentStore 만 colon-key 잔존
  — 일관성 어긋남.

## ADR 0027 와의 관계

새 ADR 추가 안 함. ADR 0027 의 결정을 documentStore 에 적용하는
mechanical consequence. 본문 동결 규칙 그대로.

## Sprint Breakdown

3 slice:

1. **Slice A**: `documentStore.ts` 의 4 캐시 차원 nested 전환 + action
   시그니처 변경 없음 (이미 explicit `(connectionId, database,
   collection)` 받음) + TDD 트레이서.
2. **Slice B**: 4 callsite (production) atomic migration.
3. **Slice C**: 회귀 가드 + handoff.

## Acceptance Criteria

### AC-265-01 — `documentStore` 자료구조

```ts
interface DocumentState {
  databases: Record<string /*connId*/, DatabaseInfo[]>;
  collections: Record<string /*connId*/, Record<string /*db*/, CollectionInfo[]>>;
  fieldsCache: Record<string /*connId*/, Record<string /*db*/, Record<string /*col*/, ColumnInfo[]>>>;
  queryResults: Record<string /*connId*/, Record<string /*db*/, Record<string /*col*/, DocumentQueryResult>>>;
  aggregateResults: Record<string /*connId*/, Record<string /*db*/, Record<string /*col*/, Record<string /*pipelineHash*/, DocumentQueryResult>>>;
  loading: boolean;
  error: string | null;
}
```

- `queryResults` 와 aggregate 결과를 별개 자리로 분리 — 기존엔 같은
  `queryResults` 안에 `agg:` 접두 분기였으나 nested 에선 더 깔끔하게
  타입 분리.
- Action 시그니처 변경 없음.
- `clearConnection(connId)` 은 `delete state[connId]` 한 줄로 단축.
- request counter (stale-guard) 의 키는 flat string 유지 — 카운터는
  internal 식별자라 nested 변환 무의미.

### AC-265-02 — 4 callsite migration

- `src/components/document/DocumentDataGrid.tsx` — fieldsCache 조회.
- `src/components/document/AddDocumentModal.tsx` — fieldsCache 조회.
- `src/components/document/DocumentDataGrid/useDocumentGridData.ts` —
  queryResults 조회.
- `src/components/query/QueryTab.tsx` — fieldsCache 조회.

각각 `s.fieldsCache[connId]?.[db]?.[col]` 형태로.

### AC-265-03 — `DocumentDatabaseTree` collections lookup

`useDocumentDatabaseTreeData.ts` 의 `collectionsByDb` 가 어떻게 사용
되는지 확인 후 nested shape 에 맞춰 변환. 가능하면 같은 lift 패턴.

### AC-265-04 — 회귀 가드

- `pnpm vitest run` 통과 (3193 baseline 유지).
- `pnpm tsc --noEmit`, `pnpm lint` 통과.
- `cargo clippy --all-targets --all-features -- -D warnings`, `cargo
  test` 회귀 0 (백엔드 변경 없음).

## Out of Scope

- **Mongo workspace 의 collection-level 분리** — 본 sprint 는 cache 만.
  workspace state 의 per-collection 분리는 별도 (Sprint 262 FU #1 의
  reasonable 결정).
- **request counter 의 nested 화** — internal 식별자, 변경 가치 없음.
- **`databases` 의 nested 화** — 이미 connection-level 자료, 더 분해할
  차원 없음.

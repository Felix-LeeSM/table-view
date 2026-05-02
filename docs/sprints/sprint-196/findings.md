# Sprint 196 — Findings

Sprint: `sprint-196` (FB-5b — query history `source` field + 발사점 확장).
Date: 2026-05-02.
Status: closed.

## 1. Query history audit — 8 누락 발사점 발견

### 발견

Sprint 195 가 `tabStore.recordHistory` 를 만들면서 QueryTab 의 raw
execution 7 사이트는 history 에 들어왔지만, 그 외 사용자 의도 발사점은
한 곳도 history 를 안 남기고 있었다. 9 발사점 audit:

| 발사점 | 분류 |
|--------|------|
| `QueryTab.handleExecute` (find / aggregate / SQL) | `raw` (이미 recorded) |
| `useDataGridPreviewCommit.runRdbBatch` | `grid-edit` (누락) |
| `useDataGridPreviewCommit.handleExecuteCommit` (Mongo) | `grid-edit` (누락) |
| `EditableQueryResultGrid.runBatch` (raw-edit) | `grid-edit` (누락) |
| `ColumnsEditor.runAlter` | `ddl-structure` (누락) |
| `IndexesEditor.runPendingExecute` | `ddl-structure` (누락) |
| `ConstraintsEditor.runPendingExecute` | `ddl-structure` (누락) |
| `SchemaTree.handleDropTable` | `ddl-structure` (누락) |
| `DocumentDataGrid.handleAddSubmit` | `mongo-op` (누락) |

### 결정

`QueryHistorySource` union 1 개로 묶어 4 분류 (`raw` / `grid-edit` /
`ddl-structure` / `mongo-op`) 로 surface. raw 만 default 로 현 callsite
호환성을 유지 (Sprint 84 paradigm/queryMode 와 같은 pattern).

### 트레이드오프

- **statement-level breakdown 안 함** (V1 OOS) — multi-stmt grid commit
  이 한 entry 로만 들어오지만, V1 은 사용자가 commit 단위로 history 를
  소비한다는 가정. statement 별 source 가 필요해지면 별 sprint.
- **DDL helpers 가 미리 sql 을 반환하지 않는 경우** — `dropTable` /
  `insertDocument` 는 backend 에서 sql 을 만들고 client 에는 노출하지
  않으므로 client 에서 user-readable 문자열을 합성 (`DROP TABLE
  "schema"."table"` / `db.<col>.insertOne(...)`). preview 가 있는 사이트
  (`runAlter` / `runPendingExecute` / RDB/Mongo grid commit) 는 preview
  문자열을 그대로 사용.

## 2. ConstraintsEditor 신규 selector 추가 — 5 컴포넌트 동일 패턴

### 발견

`useQueryHistoryStore.getState().addHistoryEntry({...})` 를 component /
hook event handler 안에 직접 박아 넣으면 B-2 (event handler 내 read 는
허용) 위에 있어 syntactically valid 하지만 — codebase 의 다른 history
consumer (`QueryLog`, `GlobalQueryLogPanel`, `QueryTab`) 모두 selector
구독 (`const x = useQueryHistoryStore((s) => s.x);`) 으로 통일돼 있어
패턴 가시성을 깨뜨린다. 또 cross-store 결합은 hook level 에서만 (B-6).

### 결정

5 신규 사이트 모두 component / hook 최상단에서
`const addHistoryEntry = useQueryHistoryStore((s) => s.addHistoryEntry);`
selector 로 구독하고 closure 로 참조. event handler 안에서는 store
인스턴스를 절대 다시 lookup 하지 않는다.

useCallback deps 에는 `addHistoryEntry` 를 명시 추가 (selector
구독으로 얻은 reference 는 store identity 와 동일하지만, react-hooks
exhaustive-deps 룰 일관성을 위해).

### 영향

- `useDataGridPreviewCommit.ts` — `addHistoryEntry` 1 selector + 4
  callsite (RDB success/error, Mongo success/error). `handleExecuteCommit`
  deps array 에 `addHistoryEntry`, `connectionId`, `schema`, `table` 추가.
- `EditableQueryResultGrid.tsx` — selector + 2 callsite + `runBatch`
  deps 에 `addHistoryEntry`.
- `ColumnsEditor.tsx` / `IndexesEditor.tsx` / `ConstraintsEditor.tsx` —
  각 selector + 2 callsite. ConstraintsEditor 는 누락된 `import` 도 추가.
- `SchemaTree.tsx` — selector + 2 callsite (`handleDropTable` 의
  success / error 분기). 합성 sql `DROP TABLE "schema"."table"`.
- `DocumentDataGrid.tsx` — selector + 2 callsite (success / error).
  합성 sql `db.<collection>.insertOne(<JSON>)`.

## 3. UI badge — `raw` 만 surface 안 함

### 발견

contract 에 `raw` 는 배지 미표시 (visual quiet). 그 외 3 source 만
배지로. legacy entry (Sprint 196 이전 persisted, source 필드 없는 것)
도 normalised 후 `"raw"` 가 되므로 자동으로 quiet — 별도 분기 불필요.

### 결정

`@components/shared/QueryHistorySourceBadge.tsx` 1 파일 신설. `source`
가 `undefined` 또는 `"raw"` 일 때 `null` return, 그 외 3 source 는 색깔
별 배지 (GRID/DDL/MQL) + `title` (hover tooltip) + `data-source`
attribute. design token `text-3xs` (10px) 사용 — 임의 픽셀 (`text-[10px]`)
은 lint 가 차단.

`QueryLog.tsx` 와 `GlobalQueryLogPanel.tsx` 의 row markup 양쪽에서
`<QueryHistorySourceBadge source={entry.source} />` 1 줄 삽입.

## 4. 검증 결과

- `pnpm tsc --noEmit` — 0 errors
- `pnpm lint` — 0 errors (1 lint 위반 자동 수정: 임의 픽셀
  `text-[10px]` → `text-3xs` design token)
- `pnpm vitest run` — 187 files / 2719 tests 통과
  (baseline 186 / 2706 → +1 file `QueryHistorySourceBadge.test.tsx`,
   +13 tests AC-196-01 × 3 / AC-196-02 × 2 / AC-196-03 × 1 / AC-196-04 × 1
   / AC-196-05 × 1 / AC-196-06 × 5)
- Rust: 변경 없음.

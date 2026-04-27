# Sprint 143 — Findings (Row count UX + Mongo activeDb persistence)

## AC 커버리지

- **AC-148-1** PASS — `SchemaTree.tsx` 의 모든 row-count 셀 (3개 렌더
  사이트: 평탄 RDB list, MySQL/SQLite-style 2단 트리, PG-style 3단
  nested 트리) 이 새 `rowCountText(dbType, value)` helper 를 호출하여
  PG/MySQL non-null `row_count` 를 `~12,345` 로 출력. 검증:
  - `SchemaTree.rowcount.test.tsx`: "AC-S137-03: PG row-count cell carries
    the pg_class.reltuples aria-label and title" → `cell.textContent === "~12,345"`
  - `SchemaTree.rowcount.test.tsx`: "AC-S137-03: MySQL row-count cell labels
    the source as information_schema" → `cell.textContent === "~9,876"`
  - `SchemaTree.test.tsx`: "displays row_count with the sprint-143 tilde
    estimate prefix" → `screen.getByText("~12,345")`
  - `SchemaTree.test.tsx`: "displays '~0' for row_count of 0" → `~0` (0
    역시 estimate 출처에서 온 값이므로 tilde 동일).

- **AC-148-2** PASS — SQLite 와 `null` row_count 케이스 모두 `?` 렌더 +
  aria-label/title `"Exact row count not yet fetched"` 로 통일.
  - `SchemaTree.rowcount.test.tsx`: "AC-148-2: SQLite row-count cell
    renders `?` (no estimate metadata)" → `?`
  - `SchemaTree.rowcount.test.tsx`: "AC-148-2: PG row-count cell renders
    `?` when the schema fetch returned no estimate" → `?` (was: hidden
    cell pre-S143)
  - `SchemaTree.test.tsx`: "renders `?` for the row_count cell when the
    value is null (sprint 143)" → `?` 셀은 여전히 존재하되 값은 `?`.

- **AC-148-4** PASS — `connectionStore.ts` 에 `tableview:activeDb:{id}`
  localStorage 키 read/write/clear 헬퍼 도입. `setActiveDb` 가 connected
  branch 에서 persist, `connectToDatabase` 가 persisted 값을
  `connection.database` 보다 우선 적용, `disconnectFromDatabase` 가 키
  제거. 검증:
  - "setActiveDb persists the selection to localStorage under
    tableview:activeDb:{id} (AC-148-4)"
  - "setActiveDb does NOT persist when the connection is not in
    connected state (AC-148-4)"
  - "connectToDatabase restores activeDb from localStorage when a
    persisted value exists (AC-148-4)"
  - "connectToDatabase falls back to connection.database when no
    persisted value exists (AC-148-4)"
  - "disconnectFromDatabase clears the persisted activeDb entry
    (AC-148-4)"

- **AC-148-3** DEFERRED — 본 sprint 의 contract 에 명시된 대로 별도
  sprint 에서 다룬다 (Rust trait method `count_rows_exact` + 3
  adapter 구현 + connection-scoped TS cache + 200ms hover debounce). 본
  sprint 가 visible baseline (`~N` / `?`) 을 만들었기 때문에 후속
  sprint 는 단순히 셀 텍스트만 mutate 하면 된다.

## Verification (Verification Plan: command)

```
pnpm vitest run     → Test Files 139 passed (139), Tests 2156 passed (2156)
pnpm tsc --noEmit   → exit 0
pnpm lint           → exit 0
```

## 변경 파일 (purpose)

| 파일 | 목적 |
|---|---|
| `src/components/schema/SchemaTree.tsx` | `rowCountLabel(dbType, value)` 시그니처 확장 + `rowCountText(dbType, value)` 신규 헬퍼. 3 렌더 사이트가 동일하게 helper 호출 → tilde / `?` 일관 출력 |
| `src/components/schema/SchemaTree.rowcount.test.tsx` | AC-148-1 (PG/MySQL `~N`), AC-148-2 (SQLite `?`, null `?`) 단언으로 갱신 |
| `src/components/schema/SchemaTree.test.tsx` | row_count 관련 3개 기존 케이스 (12345, null, 0) 를 sprint-143 contract 에 맞춰 갱신 |
| `src/stores/connectionStore.ts` | `tableview:activeDb:{id}` 키 헬퍼(persist/load/clear), `setActiveDb` persist, `connectToDatabase` restore, `disconnectFromDatabase` clear |
| `src/stores/connectionStore.test.ts` | `beforeEach` 에서 `tableview:activeDb:` 키 wipe + AC-148-4 5 testcase 추가 |

## 가정 / 위험 / 미해결

- AC-148-3 (lazy exact-count fetch + cache) 미구현. 사용자가 셀 hover 해도
  현재는 `?` 또는 `~N` 그대로. 별도 sprint 에서 backend `count_rows_exact`
  추가 후 진입 — 본 sprint 의 visible baseline 위에 cache hit 시 텍스트만
  swap 하면 충분하다.
- SQLite 백엔드는 여전히 `list_tables` 응답에 `row_count` 를 포함할 수
  있다 (현행 어댑터 동작 미변경). 프론트엔드가 dbType=sqlite 인 경우 값
  무시하고 `?` 렌더 — 별도 sprint 에서 backend 정리 가능.
- `connection.database` 가 빈 문자열인 케이스 (`""`) 는 본 sprint 변경
  전과 동일하게 `activeDb=undefined` 로 처리. 새 코드는
  `conn.database.length > 0` 검사를 명시적으로 추가했지만 동작 동일.
- Mongo persistence 는 connection id 기반 — connection 삭제 시 키도
  삭제되도록 향후 `removeConnection` 에 cleanup 추가 가능 (현재는
  `disconnectFromDatabase` 호출 시점에만 cleanup; remove 가 disconnect 를
  호출하지 않는 경로가 있으면 stale 키 남을 수 있음).

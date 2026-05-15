# Sprint 319 Contract — Slice E.1 (Document Schema Accumulator Hook)

## Scope

Mongo collection 은 schemaless — 같은 collection 의 documents 가
서로 다른 field set 을 가질 수 있다. 페이지를 넘기거나 filter 가
바뀌면 backend 의 `find_documents` 가 보낸 `result.columns` 도 변동.
UI 가 fetch 마다 column 이 다르면 사용자 혼란.

이 sprint 는 client-side 누적 schema 를 책임지는 hook
(`useDocumentSchemaAccumulator`) 를 단독으로 만든다. DocumentDataGrid
와의 wire-up 은 Sprint 320 (E.2) 의 책임.

## Done Criteria

1. `useDocumentSchemaAccumulator()` 호출 시 빈 상태.
2. `merge(columns)` 가 새 field 를 추가, 기존은 보존.
3. 반환 컬럼 정렬: `_id` 가 항상 first, 그 외는 alphabetical (case-insensitive).
4. 동일 field name 의 type 충돌 처리: 최초 발견 type 유지 (`first-wins`),
   subsequent type 은 무시 (heuristic — type 흔들림 막음).
5. `reset()` 으로 전체 wipe (collection 전환 시 호출 의도).
6. `(connId, db, collection)` triple 변경 시 자동 reset.
7. ≥ 6 unit case (vitest + renderHook).

## Out of Scope

- DocumentDataGrid 와의 wire-up (Sprint 320 E.2).
- backend schema metadata 캐시 변경.
- "mixed" type 표기 (사용자 expose 안 함; type 흔들림은 first-wins
  로 단순화).
- persist (sessionStorage / IndexedDB) — 현재 sprint 는 in-memory only.

## Invariants

- `useColumnWidths` / `useHiddenColumns` 의 hook 모양 유지 (callback
  return + stable identity).
- 기존 `DocumentColumn` shape 호환.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run src/hooks/useDocumentSchemaAccumulator.test.ts`,
  `pnpm tsc --noEmit`, `pnpm lint`.
- Required evidence: hook file + test file + decisions D-43..D-??

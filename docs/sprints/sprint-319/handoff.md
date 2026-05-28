# Sprint 319 Handoff — Slice E.1 (Document Schema Accumulator Hook)

## Status: PASS

## Scope completed

Mongo document grid 의 schemaless column 흔들림을 흡수하는 client-side
누적 schema 훅 도입. wire-up 은 후속 sprint 320 (E.2) 의 책임.

- `useDocumentSchemaAccumulator(key?)` — `{connId, db, collection}`
  triple 단위로 격리.
- `merge(columns)` 가 union 누적 + first-wins type policy.
- 정렬: `_id` first + 그 외 case-insensitive 알파벳.
- triple 변경시 auto-reset.

## Files changed

| 파일 | 종류 | 변경 |
|------|------|------|
| `src/hooks/useDocumentSchemaAccumulator.ts` | NEW | hook 본체 |
| `src/hooks/useDocumentSchemaAccumulator.test.ts` | NEW | 7 case |
| `docs/archives/phases/retired/phase-28-decision-log.md` | edit | D-43..D-46 append |
| `docs/sprints/sprint-319/contract.md` | NEW | sprint contract |
| `docs/sprints/sprint-319/execution-brief.md` | NEW | execution brief |
| `docs/sprints/sprint-319/handoff.md` | NEW | 본 문서 |

## Per-Done-Criterion evidence

1. 빈 시작 — test "starts empty".
2. union merge — "merges incoming columns into the accumulator" +
   "preserves existing fields when subsequent merges introduce new ones".
3. 정렬 — "orders `_id` first, then case-insensitive alphabetical".
4. type first-wins — "keeps the first-seen type for a given field".
5. reset — "reset() wipes the accumulator back to empty".
6. triple 변경시 auto-reset — "auto-resets when the (connId, db,
   collection) triple changes".
7. ≥ 6 unit case — 7 신규.

## Checks run

- `pnpm vitest run src/hooks/useDocumentSchemaAccumulator.test.ts` →
  7/7 pass.
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.

## Autonomous decisions (recorded in `docs/archives/phases/retired/phase-28-decision-log.md`)

- **D-43**: 누적 단위 = `(connId, db, collection)` triple.
- **D-44**: 정렬 = `_id` first + case-insensitive 알파벳.
- **D-45**: type 충돌 = first-wins.
- **D-46**: in-memory only (persist 미적용).

## Out of scope (deferred)

- DocumentDataGrid 와의 wire-up (Sprint 320 E.2).
- "mixed" type 표기 (Slice G BSON editor 와 함께 재검토).
- sessionStorage / IndexedDB persist.

## Residual risk

- 빈 collection (rows 0) 의 첫 fetch 가 columns 0 일 수 있음 — merge
  no-op, 사용자는 빈 grid 를 봄. 누적할 거리가 없으니 자연스러움.
- type first-wins 가 잘못된 첫 inference 에 lock 될 수 있음 (e.g. 첫
  페이지의 단일 document 가 null 값 → "unknown" 으로 fix). 사용자
  reload 또는 navigation 으로 reset 가능. 후속 슬라이스에서 explain
  pane 또는 mixed-type 표기로 보강 검토.

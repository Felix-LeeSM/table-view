# Sprint 320 Handoff — Slice E.2 (DocumentDataGrid Schema Accumulator Wire-up)

## Status: PASS

## Scope completed

Sprint 319 의 `useDocumentSchemaAccumulator` 훅을 DocumentDataGrid 에
연결. 페이지 / filter / sort 가 바뀌어도 grid column 이 흔들리지
않고, 새 field 가 등장하면 누적된다. 누락된 field 의 cell 은 기존
NULL chip 으로 표시.

## Files changed

| 파일 | 종류 | 변경 |
|------|------|------|
| `src/components/document/DocumentDataGrid.tsx` | edit | accumulator hook 호출, queryResult.columns merge useEffect, accumulator-driven `data` memo (backend → accumulator index map + null-fill) |
| `src/components/document/DocumentDataGrid.schema.test.tsx` | NEW | 5 RTL case |
| `docs/phases/phase-28-decisions.md` | edit | D-47..D-50 append |
| `docs/sprints/sprint-320/contract.md` | NEW | sprint contract |
| `docs/sprints/sprint-320/execution-brief.md` | NEW | execution brief |
| `docs/sprints/sprint-320/handoff.md` | NEW | 본 문서 |

## Per-Done-Criterion evidence

1. **accumulator 호출 + merge** — `DocumentDataGrid.tsx` 의
   `useDocumentSchemaAccumulator({connId, db, collection})` 호출 +
   `useEffect([queryResult?.columns])` merge.
2. **grid columns = accumulator** — `data` memo 가 `effectiveColumns`
   = `schemaAccumulator.columns` 기반. test "renders the columns
   from the first fetch alphabetically (with _id pinned)" + "accumulates
   new fields across pages and never drops earlier ones".
3. **missing field cell = null** — test "renders 'null' chips for
   accumulated fields missing in the current page" 가 `screen.getAllByText("null")`
   ≥ 1 단언.
4. **collection 변경 시 reset** — sprint 319 의 hook 내부 auto-reset
   활용. test "resets the accumulator when the collection changes".
5. **first-wins type 유지** — test "keeps the first-seen type for a
   field even when a later page disagrees".
6. **회귀 0** — 기존 DocumentDataGrid 12 file 92 case 전부 통과
   (이번 sweep 에 영향 없음).

## Checks run

- `pnpm vitest run src/components/document/DocumentDataGrid.schema.test.tsx` → 5/5 pass.
- `pnpm vitest run src/components/document` → 12 file 97 case pass
  (기존 92 + 신규 5).
- `pnpm vitest run` → **299 files, 3680 pass / 10 skip / 0 fail**
  (baseline 3668 → +12 case: schema accumulator hook 7 + grid wire
  5; 정합).
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm build` → exit 0.

## Autonomous decisions (recorded in `docs/phases/phase-28-decisions.md`)

- **D-47**: accumulator merge 트리거 = `queryResult?.columns` useEffect.
- **D-48**: accumulator 빈 상태일 때 backend columns fallback —
  flicker 방지.
- **D-49**: row 의 missing field cell = null (기존 NULL chip 재사용).
- **D-50**: backend → accumulator column index map = O(1) cell lookup.

## Out of scope (deferred)

- "mixed" type 표기 (Slice G BSON editor 가 더 정교한 표기 결정 필요).
- accumulator 결과 persist (in-memory only).
- RDB grid 의 schema 누적 (RDB 는 backend authoritative).
- Slice F (Nested editing).

## Residual risk

- accumulator 가 첫 fetch 의 type 에 lock — 첫 sample 이 null / undefined
  로 inferred 되면 column 이 "unknown" 으로 남을 가능성. 사용자가
  collection navigate / reload 로 reset 가능.
- backend 가 매번 다른 column order 를 보내도 grid order 는 alphabetical
  로 안정. 그러나 사용자가 backend BFS order 를 선호하는 use case 면
  toggle 옵션이 필요할 수 있음. 후속 슬라이스 (Slice H projection)
  에서 column order 사용자 제어 도입 시 재검토.

# Sprint 320 Contract — Slice E.2 (DocumentDataGrid Schema Accumulator Wire-up)

## Scope

Sprint 319 의 `useDocumentSchemaAccumulator` 훅을 DocumentDataGrid 에
연결. 페이지 / filter / sort 가 바뀌어도 grid column 이 흔들리지 않고,
새 field 가 등장하면 누적된다.

## Done Criteria

1. DocumentDataGrid 가 `useDocumentSchemaAccumulator({connId, db, coll})`
   를 호출하고, 매 fetch 결과의 `queryResult.columns` 를 merge.
2. Grid header / row cell map 이 누적된 schema (`accumulator.columns`)
   기준으로 렌더 — `_id` first + 알파벳 정렬.
3. accumulator 에는 있지만 현재 페이지 backend `data.columns` 에는
   없는 field 는 cell 이 `null` 로 표시 (기존 NULL chip 로직 재사용).
4. accumulator 가 빈 상태 (첫 fetch 전) 일 때는 backend columns
   fallback — flicker 방지.
5. 다른 collection 으로 navigate 시 accumulator auto-reset (sprint 319
   훅 의 auto-reset behaviour 활용).
6. ≥ 5 신규 RTL case.
7. 기존 DocumentDataGrid 테스트 회귀 0.
8. tsc / lint / build / vitest exit 0.

## Out of Scope

- `mixed` type 표기.
- accumulator 결과의 persist (in-memory only).
- RDB grid 의 schema 누적 (RDB 는 schema 가 backend authoritative).
- Slice F (Nested editing).

## Invariants

- backend 의 `result.columns` / `result.rows` shape 유지.
- 기존 hidden column / sort / inline edit / Cmd+L 동작 유지.
- localStorage `column-widths:document:<db>:<coll>` 와
  `hidden-columns:document:<db>:<coll>` 호환.

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`,
  `pnpm lint`, `pnpm build`.
- Required evidence: 변경 파일 + 신규 RTL 케이스 + decisions
  D-47..D-??.

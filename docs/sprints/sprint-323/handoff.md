# Sprint 323 Handoff — Slice G.1 (BSON type primitives + editor)

날짜: 2026-05-15
스코프 origin: `docs/sprints/sprint-323/contract.md`

## 결과

- 신규 unit: 18 (bsonTypes — detect / coerce / inverse 4 type 각)
- 신규 RTL: 6 (BsonTypeEditor)
- 회귀: 0 — `pnpm vitest run --no-coverage` 3732 통과 / 10 skipped
  (sprint-322 기준 3708 → +24).
- 정적 체크: `pnpm tsc --noEmit` exit 0, `pnpm lint` exit 0.

## 변경 파일

- `src/lib/mongo/bsonTypes.ts` (NEW) — canonical EJSON helper.
- `src/lib/mongo/bsonTypes.test.ts` (NEW) — 18 unit.
- `src/components/document/BsonTypeEditor.tsx` (NEW) — type-aware
  controlled input + hint/error surface.
- `src/components/document/BsonTypeEditor.test.tsx` (NEW) — 6 RTL.

## 의사결정 (D-59..D-61)

- **D-59**: `BsonType` 4 종으로 한정 — Sprint 323 scope 는 ObjectId / ISODate /
  Decimal128 / BinData. Long / Timestamp / Symbol / DBRef 같은 legacy
  wrapper 는 surfacing 빈도 낮아 후속 sprint 로 이연.
- **D-60**: canonical EJSON v2 `$date` 의 numberLong shape (server timestamp
  ms) 는 inverse 에서만 핸들 (편집 시 ISO string 으로 풀어 보임). 사용자
  입력은 ISO string 단일 path — 두 shape 를 동시에 노출하면 UI 가 시끄러움.
- **D-61**: BinData subType 은 v0 에서는 "00" (generic) 고정. picker UI 는
  G.2 가 mock 후 후속. 대부분 collection 의 binData 는 generic 이므로
  fast-path 우선.

## 다음

Sprint 324 (Slice G.2) — popover 의 Pencil 클릭 시 cell 의 BSON type 을
detect 하여 `BsonTypeEditor` 마운트, pendingEdits 에는 EJSON wrapper 가
들어가도록 wire. mqlGenerator 가 EJSON wrapper 를 mongosh literal
(`ObjectId("...")`, `ISODate("...")`, `NumberDecimal("...")`, `BinData(...)`)
로 출력.

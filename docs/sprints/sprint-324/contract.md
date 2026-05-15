# Sprint 324 Contract — Slice G.2 (BSON type editor wire-up + mongosh literal)

## Scope

Sprint 323 의 `BsonTypeEditor` + `bsonTypes` helper 를 실제 사용처에 연결:

1. NestedExpandPopover 의 Pencil 클릭 시 entry value 의 BSON wrapper 가
   detect 되면 `BsonTypeEditor` 마운트. 미인식 시 기존 plain-text input.
2. DocumentDataGrid 의 top-level cell Pencil edit (sentinel 이 아닌 scalar
   cell) 도 동일 — column data_type 또는 cell value detect 가 BSON wrapper
   를 가리키면 type-aware editor.
3. mqlGenerator 의 `formatMqlValue` 가 EJSON wrapper 를 mongosh literal
   로 출력: `ObjectId("...")`, `ISODate("...")`, `NumberDecimal("...")`,
   `BinData(0, "...")`.

## Done Criteria

1. NestedExpandPopover 가 entry.value BSON detect → `BsonTypeEditor` 마운트
   분기. 미인식 cell 은 기존 plain input (regression 0).
2. DocumentDataGrid top-level cell 의 inline edit path 가 동일 분기 적용
   (Sprint 322 dot-key 아닌 `"row-col"` plain key).
3. mqlGenerator `formatMqlValue`:
   - `{ $oid: "..." }` → `ObjectId("...")`
   - `{ $date: "..." }` → `ISODate("...")`
   - `{ $numberDecimal: "..." }` → `NumberDecimal("...")`
   - `{ $binary: { base64, subType } }` → `BinData(<subType-int>, "<base64>")`
4. preview line 회귀 0 — plain object / scalar / array 출력 변화 없음.
5. ≥ 4 신규 unit (mqlGenerator BSON literal) + ≥ 3 신규 RTL (popover BSON
   wire-up).
6. tsc / lint / vitest exit 0.

## Out of Scope

- BinData subType picker (always 00 from G.1).
- Long / Timestamp / Symbol / DBRef wrapper.
- raw EJSON 입력 fallback (사용자가 직접 `{ $oid: ... }` 를 textarea 에
  치는 경로).

## Invariants

- F.2 plain-text nested edit / sentinel-edit guard / `_id`-in-patch guard
  회귀 0.
- mqlGenerator 의 기존 18+ test 케이스 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + tsc + lint
- Evidence: 변경 파일 + 신규 RTL/unit + decisions D-62..D-??

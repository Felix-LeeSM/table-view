# Sprint 324 Execution Brief — Slice G.2

## Objective

NestedExpandPopover 의 Pencil 이 BSON wrapper cell 에서 BsonTypeEditor 로
분기, pendingEdits 에 wrapper 가 `__bson__:` tag 직렬화로 보관, mqlGenerator
가 wrapper 를 mongosh literal 로 출력.

## Done Criteria (요약)

- NestedExpandPopover bsonType 분기 wire-up
- mqlGenerator BSON literal printer (`ObjectId / ISODate / NumberDecimal /
  BinData`)
- DocumentDataGrid `tagBsonWrapper` 직렬화 layer
- ≥ 4 신규 unit + ≥ 3 신규 RTL
- tsc / lint / vitest exit 0

## Verification Plan

- Profile: `command`
- Checks: scoped vitest + 전체 sweep + tsc + lint

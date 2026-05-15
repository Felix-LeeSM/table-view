# Sprint 323 Contract — Slice G.1 (BSON type coercion + editor primitives)

## Scope

4 종 BSON wrapper (ObjectId / ISODate / Decimal128 / BinData) 의:

- canonical EJSON shape detection (`{ $oid: ... }`, `{ $date: ... }`,
  `{ $numberDecimal: ... }`, `{ $binary: ... }`)
- 사용자 입력 (string) → canonical EJSON object 의 coercion (+ validation).
- canonical object → 사용자가 편집 가능한 string 의 inverse.
- `BsonTypeEditor` React 컴포넌트 — 4 type 별 input 변형 (text + 자동 검증
  + 친절한 hint).

## Done Criteria

1. `src/lib/mongo/bsonTypes.ts` 모듈:
   - `detectBsonType(value: unknown): "objectId" | "date" | "decimal128" | "binData" | null`
   - `coerceToEjson(type, rawInput): { value: unknown } | { error: string }`
   - `ejsonToEditableString(type, value): string`
2. 4 type 모두 unit 케이스 (round-trip valid + invalid input).
3. `src/components/document/BsonTypeEditor.tsx` — type-aware controlled input.
   - text input (ObjectId, Decimal128, BinData base64) + datetime-local
     (ISODate).
   - 잘못된 input 시 hint message + commit 차단.
4. RTL: 4 type 각각 1 case 이상 (입력 → onChange + onCommit pair).
5. tsc / lint / vitest exit 0.

## Out of Scope

- popover wire-up (Sprint 324, G.2).
- mqlGenerator 의 EJSON → mongosh literal print (Sprint 324, G.2).
- BinData subType picker UI (Sprint 324, G.2 또는 후속).

## Invariants

- F.2 nested edit 흐름 (raw-string edit) 회귀 0 — popover 의 plain text
  Pencil 은 그대로.
- mqlGenerator 의 기존 `formatMqlValue` output 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + tsc + lint
- Evidence: bsonTypes.ts + BsonTypeEditor.tsx + 신규 RTL/unit + decisions
  D-59..D-??

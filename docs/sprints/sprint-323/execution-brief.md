# Sprint 323 Execution Brief — Slice G.1

## Objective

EJSON canonical 4 type (`$oid`/`$date`/`$numberDecimal`/`$binary`) 의 detect /
coerce / inverse helper 와 type-aware editor 컴포넌트 도입.

## Task Why

Slice F.2 의 raw-string Pencil 은 ObjectId / ISODate 같은 typed BSON cell 을
mongosh literal 로 못 살림. 사용자가 "65abc..." 만 쳐도 wire 가 `{ $oid: ... }`
로 자동 패키징되어야 mongo 가 받아준다. (정확한 타입 보존이 mongo
paradigm 의 핵심.)

## Scope Boundary

- 컴포넌트 + helper 도입까지. 실제 popover/grid wire-up 은 G.2.

## Invariants

- F.2 popover read-only / plain-text edit 경로 회귀 0.
- mqlGenerator 의 기존 output 회귀 0.

## Done Criteria

1. `src/lib/mongo/bsonTypes.ts` — detect/coerce/inverse 3 helper.
2. `src/components/document/BsonTypeEditor.tsx` — controlled input 컴포넌트.
3. ≥ 8 unit (4 type × 2 valid/invalid) + ≥ 4 RTL.
4. tsc/lint/vitest exit 0.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/lib/mongo/bsonTypes.test.ts src/components/document/BsonTypeEditor.test.tsx`
  2. `pnpm vitest run --no-coverage` (full sweep)
  3. `pnpm tsc --noEmit`, `pnpm lint`
- Required evidence: 변경 파일 + 신규 테스트 + 의사결정 노트.

## Evidence To Return

- Changed/new files with purpose.
- Commands/checks run and outcomes.
- Acceptance coverage with evidence per criterion.
- Assumptions/risks/unresolved gaps.

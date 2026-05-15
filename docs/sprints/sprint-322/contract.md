# Sprint 322 Contract — Slice F.2 (Dot-notation $set inline edit)

## Scope

Sprint 321 의 NestedExpandPopover 가 각 1-depth scalar entry 를 인라인
edit 가능하게 확장 + mqlGenerator 가 dot-notation `$set` 생성.

## Done Criteria

1. mqlGenerator `parseEditKey` 가 `"row-col:path.to.field"` 형식
   수용. nested edit 의 patch key 는 `<col>.<path>`.
2. mqlGenerator update 경로 가 dot-path 를 단일 `$set` 안에 다른 top-level
   edit 와 함께 합침.
3. NestedExpandPopover 가 scalar entry 옆 ✏️ button (edit). 클릭 시
   inline input 등장, Enter commit / Esc cancel.
4. nested entry (`isNested === true`) 는 edit 미허용 (Quick Look 또는
   raw JSON 편집 권장).
5. DocumentDataGrid 가 popover 의 onCommitEdit 을 `pendingEdits` 에
   wire — key 형식 `"row-col:path"`.
6. cell 의 시각 표현: nested pending 시 sentinel cell 에 highlight
   ring 또는 dot indicator.
7. ≥ 4 신규 unit (mqlGenerator dot-notation) + ≥ 3 신규 RTL
   (popover edit + grid commit).
8. tsc / lint / build / vitest exit 0.

## Out of Scope

- 2-depth 이상 nested edit.
- nested $unset / 새 field 추가.
- popover 안 type editor (Slice G).
- transaction toggle (Slice I).

## Invariants

- 기존 top-level edit / sentinel-edit guard / `_id`-in-patch guard
  동작 유지.
- F.1 popover 의 read-only path 회귀 0.

## Verification Plan

- Profile: `command`
- Required checks: scoped vitest + 전체 sweep + 정적 체크 3종
- Evidence: 변경 파일 + 신규 RTL/unit + decisions D-55..D-??

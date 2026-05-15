# Sprint 321 Contract — Slice F.1 (Nested expand popover, read-only)

## Scope

`{...}` / `[N items]` sentinel cell 의 1-depth 내용을 grid 에서 직접
볼 수 있도록 popover. 편집 흐름은 Sprint 322 (F.2) 의 책임.

## Done Criteria

1. utility `getNestedExpansion(value)` 가 nested object → `{key, value,
   isNested}[]`, array → `{index, value, isNested}[]` 반환.
2. nested-of-nested 는 sentinel 표기 유지 (1-depth 만 expose).
3. component `NestedExpandPopover` 가 trigger button (ChevronRight 아이콘)
   + Popover content (key-value list) 를 mount.
4. content 내부 각 row 가 (a) key / index, (b) value (scalar 는 그대로,
   nested 는 sentinel), (c) type subtitle.
5. DocumentDataGrid 의 sentinel cell 에 trigger button 노출 (`aria-label="Expand nested ..."`).
6. 일반 (non-sentinel) cell 에는 button 미노출.
7. ≥ 4 unit case (utility) + ≥ 3 component RTL case.
8. tsc / lint / build / vitest exit 0.

## Out of Scope

- Editing nested fields (Sprint 322 F.2).
- Nested-of-nested 의 lazy expand (현재는 1-depth 만).
- Quick Look 과의 차별화 (Quick Look 은 전체 document, popover 는
  하나의 cell).

## Invariants

- 기존 sentinel cell 의 italic muted 표기 유지.
- inline edit / row selection 동작 유지 (trigger 클릭 시 row
  selection 토글되지 않게 stopPropagation).

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run`, `pnpm tsc --noEmit`,
  `pnpm lint`.
- Required evidence: 신규 utility + 신규 component + DocumentDataGrid
  통합 회귀 + decisions D-51..D-??.

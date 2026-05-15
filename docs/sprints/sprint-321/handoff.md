# Sprint 321 Handoff — Slice F.1 (Nested Expand Popover, Read-only)

## Status: PASS

## Scope completed

Sentinel cell (`{...}` / `[N items]`) 옆에 ChevronRight 트리거를
마운트, 클릭 시 1-depth nested fields 를 Radix Popover 안에 표시.
Edit flow 은 Sprint 322 (F.2).

## Files changed

| 파일 | 종류 | 변경 |
|------|------|------|
| `src/lib/document/nestedExpansion.ts` | NEW | 1-depth utility |
| `src/lib/document/nestedExpansion.test.ts` | NEW | 6 case |
| `src/components/document/NestedExpandPopover.tsx` | NEW | Radix Popover wrap |
| `src/components/document/NestedExpandPopover.test.tsx` | NEW | 5 case |
| `src/components/document/DocumentDataGrid.tsx` | edit | sentinel cell 옆 trigger 마운트 |
| `src/components/document/DocumentDataGrid.nested.test.tsx` | NEW | 5 RTL integration |
| `docs/phases/phase-28-decisions.md` | edit | D-51..D-54 append |
| `docs/sprints/sprint-321/contract.md` | NEW | sprint contract |
| `docs/sprints/sprint-321/execution-brief.md` | NEW | execution brief |
| `docs/sprints/sprint-321/handoff.md` | NEW | 본 문서 |

## Per-Done-Criterion evidence

1. **utility 동작** — `nestedExpansion.test.ts` 6/6 pass (scalar null,
   object expand, nested-of-nested flag, array expand, BSON canonical
   scalar, sentinel string null).
2. **popover 컴포넌트** — `NestedExpandPopover.test.tsx` 5/5 pass
   (trigger mount, scalar suppress, object content, array content,
   stopPropagation).
3. **grid 통합** — `DocumentDataGrid.nested.test.tsx` 5/5 pass
   (sentinel mount, scalar 미노출, object/array popover, row
   selection 부작용 0).
4. **회귀 0** — 전체 sweep 3696 pass / 10 skip / 0 fail.

## Checks run

- `pnpm vitest run src/lib/document/nestedExpansion.test.ts` → 6/6 pass.
- `pnpm vitest run src/components/document/NestedExpandPopover.test.tsx`
  → 5/5 pass.
- `pnpm vitest run src/components/document/DocumentDataGrid.nested.test.tsx`
  → 5/5 pass.
- `pnpm vitest run` → **302 files, 3696 pass / 10 skip / 0 fail**
  (baseline 3680 → +16 case 정합).
- `pnpm tsc --noEmit` → exit 0.
- `pnpm lint` → exit 0.
- `pnpm build` → exit 0.

## Autonomous decisions (recorded in `docs/phases/phase-28-decisions.md`)

- **D-51**: 1-depth only. nested-of-nested 는 sentinel 유지.
- **D-52**: BSON canonical singleton (`$oid` 등) 은 scalar 취급.
- **D-53**: trigger click stopPropagation — row selection 부작용 차단.
- **D-54**: sentinel 문자열 + trigger 둘 다 유지 (정보 손실 방지).

## Out of scope (deferred)

- **Sprint 322 (F.2)** — popover 안 inline edit + dot-notation `$set`
  generator.
- nested-of-nested deep edit (Quick Look 또는 Cell Detail dialog 의
  raw JSON 편집).
- popover 의 keyboard navigation (Tab / Arrow keys).

## Residual risk

- popover 가 cell 폭에 sensitive — 좁은 column 에서 trigger 가 표시
  안 될 수 있음. truncate 적용. 추후 column 폭 너비 조정으로 해결.
- BSON canonical singleton 판별이 first-key `$` prefix 만 검사. 어떤
  사용자 데이터가 우연히 `{ $custom: ... }` 형태로 저장되어 있으면
  scalar 로 잘못 표시 가능. 실제 발생 시 Slice G (BSON type editor)
  와 함께 형 검증 강화.
- 1-depth 제한이 사용자의 깊은 inspect 욕구를 좌절시킬 가능성 —
  Quick Look 으로 안내. 후속 슬라이스에서 "View in Quick Look"
  shortcut 추가 검토.

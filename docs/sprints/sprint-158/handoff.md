# Sprint 158 Handoff

## Result: PASS

## Changed Files

| File | Change |
|------|--------|
| `src/stores/tabStore.ts` | addTab exact match + preview swap 조건에 `(t.subView ?? "records") === (tabWithDb.subView ?? "records")` 추가 |
| `src/stores/tabStore.test.ts` | AC-158-01/02/03 테스트 3개 추가 (subView 구분) |
| `src/components/schema/SchemaTree.preview.entrypoints.test.tsx` | AC-156-04b assertion 정확도 개선 |

## Checks Run

- `pnpm vitest run`: pass (154 files, 2319 tests)
- `pnpm tsc --noEmit`: pass
- `pnpm lint`: pass

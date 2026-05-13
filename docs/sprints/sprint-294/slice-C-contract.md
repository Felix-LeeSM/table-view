# Sprint 294 Slice C — Contract

## Scope

`aliasColumnCompletionSource` 를 `SqlQueryEditor.tsx` 의 `buildSqlLang`
에서 `dialect.language.data.of({ autocomplete: ... })` 로 등록. 실제 에디터
파이프라인에서 호출되도록 wire.

## Done Criteria

1. `src/components/query/SqlQueryEditor.tsx` 의 `buildSqlLang` 이 새 source
   를 dialect data 로 등록.
2. `grep -q "aliasColumnCompletionSource" src/components/query/SqlQueryEditor.tsx` exit 0.
3. `pnpm test` 전체 exit 0.
4. `pnpm tsc --noEmit` exit 0.
5. Sprint 292 Slice A/B 회귀 없음.

## Out of Scope

- edge case (Slice D).
- dedup 단언 (Slice E).

## Invariants

- 두 source 가 같은 namespace closure 를 통해 schema 공유.
- compartment reconfigure (dialect/schema 변경 시) 가 새 source 도 다시
  등록.

## Verification Plan

- Profile: `mixed` (command + static)
- Required checks:
  1. `grep -q "aliasColumnCompletionSource" src/components/query/SqlQueryEditor.tsx`
  2. `pnpm vitest run`
  3. `pnpm tsc --noEmit`

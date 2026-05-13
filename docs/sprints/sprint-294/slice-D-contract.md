# Sprint 294 Slice D — Contract

## Scope

`aliasColumnCompletion.test.ts` 에 5 edge 시나리오 단언 추가:
1. multi-join 3+: `FROM users u JOIN orders o JOIN order_items oi ON …` 의
   `oi.<cursor>` → order_items 컬럼.
2. schema-qualified: `FROM public.users u WHERE u.<cursor>` → users 컬럼.
3. 명시적 AS: `FROM users AS u JOIN orders AS o ON o.<cursor>` → orders 컬럼.
4. 동일 alias 중복 (`FROM users u, users u`): crash 없음 + 후보 노출. 정책
   (first-wins / last-wins) 가 코드 코멘트로 명시.
5. quoted reserved-word alias: `FROM users "from"` → "from" 인식 또는
   안전한 null. 어느 쪽이든 단언.

각 시나리오가 RED 면 `aliasColumnCompletion.ts` (또는 `parseFromContext`)
보강. 가로 슬라이스 금지.

## Done Criteria

1. `aliasColumnCompletion.test.ts` 에 5 edge it 추가, 각각 GREEN.
2. 회귀 없음 (sprint-292 + Slice A/B/C).
3. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- dedup 단언 (Slice E).
- CTE / derived subquery (sprint-295).

## Verification Plan

- Profile: `command`
- Required checks: `pnpm vitest run src/lib/sql/aliasColumnCompletion.test.ts`,
  `pnpm tsc --noEmit`.

# Sprint 264 Spec — useSqlAutocomplete cross-DB isolation audit

## Feature Description

Sprint 263 의 OoS #4. `useSqlAutocomplete` 가 `tableColumnsCache` /
`tables` / `views` 를 활성 `(connectionId, db)` 로만 좁혀 읽는지
회귀 가드 테스트로 잠근다.

## 배경

Sprint 263 은 schemaStore 의 5 캐시 차원을 `(connId, db)` nested 로
분리했다. `useSqlAutocomplete` 도 다음 셋을 모두 `[connId]?.[db]` 로
좁혀 읽도록 갱신됨:

- `tables[connectionId]?.[db]`
- `views[connectionId]?.[db]`
- `columnsCache[connectionId]?.[db]`

그러나 본 sprint 의 회귀 가드 테스트는 cache key 가 같은 connection
의 다른 DB 로 누설되지 않는다는 사실을 **명시적으로** 단언하지 않음.
즉 추후 누군가 `columnsByDb` 의 좁힘 코드를 실수로 잘라먹으면
silent 회귀 가능.

## Audit 가설 (모두 PASS 예상)

1. **Table 컬럼 collision**: db1.public.users={id, name}, db2.public.users=
   {id, email} 일 때 db1 mount 시 `ns.users` = {id, name} 만.
2. **inactive-DB columnsCache 누설 없음**: db2 의 `ghost_table` columns
   가 cache 에 있어도 db1 mount 시 `ns.ghost_table` 미존재.
3. **DB switch rerender**: `useSqlAutocomplete("c1", "db1")` 후
   `("c1", "db2")` 로 인자 변경 시 useMemo 재빌드. db2 의 표만 보임.
4. **Schema-qualified 경로 격리**: `ns["public.users"]` 컬럼이 활성
   DB 만 따름.
5. **Fully-quoted 경로 격리**: PG dialect 에서
   `ns['"public"."users"']` 컬럼이 활성 DB 만 따름.
6. **View 격리**: views 동일 패턴으로 active DB 만 노출.

## Acceptance Criteria

### AC-264-01

`src/hooks/useSqlAutocomplete.test.ts` 에 위 6 케이스가 모두 추가되며
PASS 한다.

### AC-264-02

만약 어느 케이스라도 FAIL 할 경우 `useSqlAutocomplete.ts` 에서
누설 경로를 수정 후 같은 sprint 안에 닫는다.

### AC-264-03 — 회귀 가드

- `pnpm vitest run` 통과
- `pnpm tsc --noEmit`, `pnpm lint` 통과

## Out of Scope

- **Intra-DB 컬럼 충돌**: 같은 DB 내 다른 schema 의 같은 table 이름이
  마지막-쓰기-승 으로 cachedColumnsByName 의 bare key 를 덮어쓰는
  현상 — 본 sprint 는 cross-DB 한정.
- **Backend 보호**: backend pool 의 잘못된 db 가 잘못된 결과를
  돌려주는 시나리오 — 본 sprint 는 프론트엔드 cache key 한정.

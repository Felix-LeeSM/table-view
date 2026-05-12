# Sprint 264 Handoff — useSqlAutocomplete cross-DB isolation audit

## Status

Complete. 누설 없음 확인 — production 코드 변경 0. 회귀 가드 테스트 6
케이스만 추가.

## Audit Result

### 누설 경로 후보 (모두 차단됨)

`src/hooks/useSqlAutocomplete.ts:139-303` 의 모든 캐시 접근이 활성
`(connectionId, db)` 로 명시적 좁혀짐:

| Line | 접근 | 좁힘 |
|---|---|---|
| 187 | `columnsCache[connectionId]?.[db]` | active DB |
| 266 | `tables[connectionId]?.[db]` | active DB |
| 279 | `views[connectionId]?.[db]` | active DB |
| 293-302 | `useMemo` 의존성 배열 | `connectionId`, `db` 포함 — db 변경 시 재빌드 |

### 검증

`useSqlAutocomplete.test.ts` 에 신규 6 케이스 추가:

1. **Cross-DB table 컬럼 collision** — db1.users={id, name},
   db2.users={id, email} 시 db1 mount 의 `ns.users` 는 {id, name} 만.
2. **Inactive-DB columnsCache ghost** — db2 cache 에만 있는 `ghost_table`
   가 db1 namespace 에 나타나지 않음.
3. **DB switch rerender** — `useSqlAutocomplete("c1", "db1")` →
   `("c1", "db2")` 변경 시 useMemo 재빌드, db2 의 표만 보임.
4. **Schema-qualified 격리** — `ns["public.users"]` 가 활성 DB 컬럼만.
5. **Fully-quoted PG 격리** — `ns['"public"."users"']` 도 활성 DB 만.
6. **Views 격리** — same-name view 동일 동작.

모두 PASS (production 코드 변경 없이) — Sprint 263 의 cache key 분리가
의도대로 작동.

## Regression Gates

| 게이트 | 결과 |
|---|---|
| `pnpm vitest run --no-file-parallelism` | 258 files / 3193 tests passed (+6 신규) |
| `pnpm tsc --noEmit` | exit 0 |
| `pnpm lint` | exit 0 |

## Out of Scope (Sprint 265+ 후보)

spec.md §Out of Scope 와 동일:

1. **Intra-DB cachedColumnsByName bare-key 마지막-쓰기-승** — 같은 DB
   내 schemaA.foo / schemaB.foo 두 table 이 같은 이름이면
   `cachedColumnsByName["foo"]` 가 iteration 순서에 따라 마지막으로
   덮어쓴 schema 의 컬럼이 됨. 단, `ns["foo"]` 의 실제 값은 `tables`
   루프의 `pickColumns(name, qualified)` 가 qualified 우선이라
   table-loop 마지막 schema 의 컬럼이 들어감. UX 영향은 미미하지만 별도
   sprint 에서 audit 가능.
2. **Backend pool 의 db mismatch 시 잘못된 결과** — backend connection
   pool 이 sync 가 깨져 활성 db 와 다른 결과를 돌려주는 시나리오. 본
   sprint 는 프론트엔드 cache key 분리만 검증. 백엔드 보호는 별도
   ADR/sprint.

## Lessons

- **Cache key 분리의 회귀 가드는 "should NOT" 단언 6 줄로 충분** — 좁힘
  코드가 실수로 잘려나가도 cross-DB 테스트가 즉시 잡아냄. 추후
  schemaStore 형태가 또 바뀌면 본 sprint 의 테스트 패턴 (`ns.users`
  not toHaveProperty `email`) 을 그대로 재사용.

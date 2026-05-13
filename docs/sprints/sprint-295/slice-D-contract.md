# Sprint 295 Slice D — Contract

## Scope

7 edge case 단언 + mini-parser 보강. CTE / derived 변형 실전 케이스 회귀
차단.

## Done Criteria

1. `cteColumnCompletion.test.ts` 에 7 edge it 추가, 각 GREEN:
   - **D1 SELECT * 폴백** — `WITH t AS (SELECT * FROM users) SELECT t.<cursor>` → users 의 모든 컬럼.
   - **D2 CTE 안의 JOIN** — `WITH t AS (SELECT u.id, o.total FROM users u JOIN orders o ON ...) SELECT t.<cursor>` → `[id, total]`.
   - **D3 명시적 AS in projection** — `WITH t AS (SELECT id AS uid, name AS uname FROM users) SELECT t.<cursor>` → `[uid, uname]` (이미 Slice B 의 happy path 에서 부분 처리 — 단언 보강).
   - **D4 schema-qualified inner table** — `WITH t AS (SELECT id FROM public.users) SELECT t.<cursor>` → `[id]`.
   - **D5 WITH RECURSIVE** — `WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM n WHERE x < 10) SELECT n.<cursor>` → `[x]` (explicit column list 처리) 또는 안전한 `null`. 어느 쪽이든 단언.
   - **D6 alias 충돌 — CTE wins** — `WITH users AS (SELECT id FROM orders) SELECT users.<cursor>` → orders 의 `[id]` (CTE 가 base table 보다 우선). namespace 에는 base `users` 가 있어 충돌 가능.
   - **D7 CTE 체이닝 1단계** — `WITH a AS (SELECT id FROM users), b AS (SELECT * FROM a) SELECT b.<cursor>` → `[id]` (b 가 a 의 컬럼 inherit).
2. `cteColumnCompletion.ts` / `parseFromContext` 의 보강:
   - SELECT * 만나면 inner FROM 의 base table 을 namespace 로 폴백 lookup.
   - JOIN-aware projection (alias-prefixed `tbl.col` → `col` 만 추출).
   - 명시적 AS 의 alias name 이 virtual column.
   - schema-qualified inner table coalescing (sprint-294 재사용).
   - WITH RECURSIVE 의 explicit column list `name(col, col, ...)` 인식.
   - alias 충돌 — CTE / derived wins (코드 코멘트 명시).
   - CTE 체이닝 1단계 (b 가 a 를 참조하면 a 의 컬럼 inherit). 더 깊은 재귀는
     안전한 `null`.
3. edge 그룹화 — `describe("Sprint 295 Slice D edge cases", ...)` 헤더에
   `Sprint 295 (2026-05-14)` + 작성 이유.
4. 회귀 없음 (sprint-292/294 + Slice A/B/C 모두 GREEN).
5. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- dedup 단언 (Slice E).
- 더 깊은 재귀 / lateral / window / set-op chain — sprint-296.

## Invariants

- 외부 dep 없음.
- mini-parser 는 정의된 패턴만.
- sprint-292/294 + Slice A/B/C 무회귀.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `pnpm vitest run src/lib/sql/cteColumnCompletion.test.ts
     src/lib/sql/sqlCompletionLevel3.test.ts
     src/lib/sql/sqlCompletionLevel2.test.ts
     src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts
     src/lib/sql/aliasColumnCompletion.test.ts`
  2. `pnpm tsc --noEmit`
- Evidence: 변경 파일, mini-parser 보강 알고리즘, 7 edge GREEN, 무회귀
  transcript, tsc exit code.

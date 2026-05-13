# Sprint 294 Slice B — Execution Brief

## Objective

`aliasColumnCompletionSource` 를 신규 작성해 mid-typing flow (`SELECT u.`
가 입력된 시점, FROM 절 미입력) 에서도 alias prefix 후보가 풀리도록 보강
한다. Slice A 의 `it.fails` 가 GREEN 으로 전이.

## Task Why

DataGrip / TablePlus 수준 자동완성의 진짜 약점이 mid-typing flow 라는 게
Slice A baseline 으로 드러남. 사용자가 SELECT 의 컬럼을 먼저 쓰는 일반 패턴
에서 buffer 의 FROM/JOIN alias 를 anywhere-scan 으로 발견해야 한다.

## Scope Boundary

- `SqlQueryEditor.tsx` 수정 금지 (= Slice C).
- 3+ JOIN, schema-qualified, AS, 중복 alias edge 보강 금지 (= Slice D).
- 중복 후보 dedup 단언 금지 (= Slice E).
- CTE / derived subquery 보강 금지 (= sprint-295).
- 기존 source / 테스트 (`updateColumnCompletion.ts`,
  `updateColumnCompletion.test.ts`, `sqlCompletionLevel1.test.ts`,
  `sqlCompletionLevel2.test.ts` 의 it.fails 외 부분) 수정 금지.

## Invariants

- Slice A 의 6 baseline GREEN.
- Sprint 292 회귀 없음.
- 외부 dep 0.
- 새 source 는 syntax tree (lang-sql) + cursor-위치 가드 (String/Number/
  Comment) 를 sprint-292 패턴으로 복제.

## Done Criteria

1. `src/lib/sql/aliasColumnCompletion.ts` 신규.
2. `src/lib/sql/aliasColumnCompletion.test.ts` 신규 (6 가드 it).
3. Slice A 의 `it.fails` 가 GREEN — Slice A 의 supplementary test 를
   `it.fails` 에서 `it` 으로 바꾸거나 동등한 GREEN 회귀 가드로 교체.
4. `pnpm tsc --noEmit` exit 0.
5. 전체 vitest 무회귀.

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 294 (2026-05-14)" src/lib/sql/aliasColumnCompletion.test.ts`
  2. `pnpm vitest run src/lib/sql/aliasColumnCompletion.test.ts
     src/lib/sql/sqlCompletionLevel2.test.ts
     src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts`
  3. `pnpm tsc --noEmit`

## Evidence To Return

- 새 source 의 alias 추출 알고리즘 요약.
- mid-typing it 의 GREEN 전이 확인 vitest 출력.
- 6 baseline + sprint-292 무회귀.
- tsc exit code.

## Assumptions / Risks

- lang-sql 의 syntax tree 가 buffer 전체를 cover 한다는 가정 — multi-
  statement 도 lang-sql 의 Script 자식 노드로 잡힘. anywhere-scan 의 범위는
  cursor 의 Statement 가 alias 를 찾지 못했을 때만 다른 Statement 로
  확장. 단일 statement 에 alias 가 이미 있으면 그것만 사용.
- alias-name 충돌 가능성 — 다른 Statement 의 alias 와 같은 이름이라면
  cursor 의 Statement 가 먼저 우선. 이 정책은 코드 코멘트로 명시.

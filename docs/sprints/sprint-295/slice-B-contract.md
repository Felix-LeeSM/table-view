# Sprint 295 Slice B — Contract

## Scope

CTE / derived subquery virtual table → virtual columns 매핑을 구축하는 새
source. Slice A 의 8 RED 가 모두 GREEN 으로 전이.

## Done Criteria

1. 새 source export — 다음 둘 중 하나:
   - 별도 모듈 `src/lib/sql/cteColumnCompletion.ts` + `cteColumnCompletionSource(
     getSchema): CompletionSource`, 또는
   - `src/lib/sql/aliasColumnCompletion.ts` 의 새 path 로 합침.
2. mini-parser 가 다음 패턴 추출:
   - `WITH <name> [(col, …)] AS (<inner-select>) [, <name2> [(…)] AS …]*`.
   - `FROM (<inner-select>) [AS] <alias>` (FROM / JOIN 둘 다).
3. inner SELECT projection list 에서 컬럼 이름 추출 — 단순 `col1, col2`,
   `tbl.col`, `col AS alias`. paren 깊이 추적.
4. Slice A 의 8 RED (it.fails) 가 모두 GREEN (it). vitest 가 unexpected pass
   가 아니라 정상 it 로 처리.
5. 가드:
   - cursor String/Number/LineComment/BlockComment 안 → `null`.
   - cursor alias dot 위치 아님 → `null`.
   - unknown virtual alias → `null`.
   - getSchema undefined / 배열 → `null`.
6. 신규 단위 테스트 (별도 모듈 선택 시 `cteColumnCompletion.test.ts`,
   alias 합침 선택 시 alias 의 같은 파일 안 새 describe 블록):
   - happy path 4 (CTE single, CTE multi, derived simple, derived AS).
   - guard 4 (점 앞, String, unknown, undefined).
   - 헤더에 `Sprint 295 (2026-05-14)` + 작성 이유.
7. 외부 dep 없음.
8. `pnpm tsc --noEmit` exit 0.

## Out of Scope

- Wire (Slice C).
- SELECT * / JOIN inside / 재귀 등 edge (Slice D).
- Dedup 단언 (Slice E).

## Invariants

- sprint-292 / 294 / Slice A 무회귀.
- 외부 dep 없음.
- 등록 경로 = sprint-294 패턴 (Slice C 가 wire 할 자리).

## Verification Plan

- Profile: `command`
- Required checks:
  1. `grep -q "Sprint 295 (2026-05-14)" <new-test-file>`
  2. `pnpm vitest run src/lib/sql/sqlCompletionLevel3.test.ts
     src/lib/sql/sqlCompletionLevel2.test.ts
     src/lib/sql/sqlCompletionLevel1.test.ts
     src/lib/sql/updateColumnCompletion.test.ts
     src/lib/sql/aliasColumnCompletion.test.ts
     <new-test-file>`
  3. `pnpm tsc --noEmit`
- Evidence: 변경 파일, source 의 mini-parser 알고리즘 요약, 8 RED → GREEN
  전이 transcript, 무회귀 확인.

**중요**: Slice C 가 wire 하기 전에는 sqlCompletionLevel3.test.ts 의
`callAll` 에서 새 source 가 호출되지 않으면 8 시나리오가 여전히 RED. 따라서
Slice B 는 `sqlCompletionLevel3.test.ts` 의 `callAll` 에 새 source 를 합산
하는 변경을 같이 해야 한다 (Slice C 의 wire 는 SqlQueryEditor.tsx 수정이
별도).

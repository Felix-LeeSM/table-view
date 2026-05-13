# Feature Spec: SQL 자동완성 Level-3 — CTE / derived subquery alias 인식

## Description

`WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` 또는 `SELECT
sub.<cursor> FROM (SELECT id, total FROM orders) sub` 같이 CTE / derived
subquery 가 가상 테이블을 도입하는 패턴에서, Tab 자동완성이 그 가상 테이블의
가상 컬럼 (CTE 의 projection list, derived subquery 의 projection list) 을
풀어 받아야 한다. Sprint 292 (Level-1 — single-table) + Sprint 294 (Level-2 —
alias-aware JOIN) 위에서 동작하며, 외부 IDE (DataGrip / TablePlus) parity 의
마지막 레이어.

## Sprint Breakdown

Sprint 단위는 sprint-295 한 개. 내부적으로 5 슬라이스 — Foundation → Core →
Wire → Edge → Regression (sprint-294 와 동일 모양).

### Slice A — Foundation: Level-3 baseline

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 새 파일 `src/lib/sql/sqlCompletionLevel3.test.ts`, 헤더에 `Sprint 295
   (2026-05-14)` + 작성 이유.
2. `callAll` 헬퍼 = sprint-294 패턴 (lang-sql built-in + `updateColumnCompletionSource`
   + `aliasColumnCompletionSource` 합산).
3. 6 ~ 8 baseline 시나리오:
   - (a) `WITH t AS (SELECT id, name FROM users) SELECT t.<cursor>` → `[id, name]`.
   - (b) `WITH t AS (SELECT id, name FROM users) SELECT * FROM t WHERE t.<cursor>` → `[id, name]`.
   - (c) `WITH a AS (SELECT id FROM users), b AS (SELECT total FROM orders) SELECT a.<cursor>` → `[id]`.
   - (d) 같은 doc 의 `SELECT b.<cursor>` → `[total]`.
   - (e) `SELECT sub.<cursor> FROM (SELECT id, total FROM orders) sub` → `[id, total]`.
   - (f) `SELECT s.<cursor> FROM (SELECT id FROM users) AS s` → `[id]`.
   - (g) CTE + derived 혼합 — `WITH t AS (SELECT id FROM users) SELECT t.<cursor> FROM t JOIN (SELECT total FROM orders) sub` → `[id]`.
   - (h) Derived nested — `SELECT outer.<cursor> FROM (SELECT id FROM (SELECT id FROM users) inner) outer` → `[id]`.
4. 통과/실패 RED/GREEN 마커 (`it` / `it.fails`). 본 spec 의 가정은 거의 전부
   RED.
5. Sprint 292/294 회귀 없음.
6. `pnpm tsc --noEmit` exit 0.

**Out of Scope**:
- source 구현 (Slice B), edge case (Slice D).

### Slice B — Core: CTE / derived subquery source

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 새 source export — 별도 모듈 `src/lib/sql/cteColumnCompletion.ts` 또는
   `aliasColumnCompletion.ts` 의 새 path (Generator 가 선택).
2. mini-parser 가 `WITH <name> AS (<inner-select>) [, <name2> AS …]*` +
   `FROM (<inner-select>) [AS] <alias>` 패턴 추출. paren-depth 추적 필수.
3. inner SELECT projection list 에서 컬럼 이름 추출 — 단순 case + explicit
   `AS` 둘 다.
4. Slice A 의 RED 가 GREEN 으로 전이.
5. 가드: cursor String/Number/Comment 안 → null; alias dot 아님 → null;
   unknown virtual alias → null; projection 추출 불가 → null.
6. 신규 단위 테스트 — happy path 4 (CTE single/multi, derived simple/AS) +
   guard 4 (점 앞, String, unknown, undefined schema).
7. 외부 dep 없음. mini-parser 는 위 패턴만.
8. `pnpm tsc --noEmit` exit 0.

**Out of Scope**:
- Wire (Slice C), SELECT * / JOIN / 재귀 등 edge (Slice D).

### Slice C — Wire: SqlQueryEditor

**Verification Profile**: `mixed`

**Acceptance Criteria**:

1. `buildSqlLang` 에 `dialect.language.data.of({ autocomplete: <new-source>(
   () => ns) })` 등록 (Slice B 의 모듈 선택에 따라 grep 키워드 조정).
2. `sqlCompletionLevel3.test.ts` 의 `callAll` 에 새 source 합산.
3. sprint-292 / 294 회귀 없음.
4. `pnpm tsc --noEmit` exit 0.

### Slice D — Edge cases

**Verification Profile**: `command`

**Acceptance Criteria**:

1. SELECT * 폴백 — `WITH t AS (SELECT * FROM users) SELECT t.<cursor>` → users 의 모든 컬럼.
2. CTE 안의 JOIN — alias-prefixed projection (`u.id`) 의 컬럼 이름만 (`id`)
   추출.
3. 명시적 `AS` in projection — alias name 이 virtual column.
4. schema-qualified inner table — sprint-294 의 coalescing 재사용.
5. `WITH RECURSIVE` — explicit column list `n(x)` 인식 또는 안전한 `null`.
6. 같은 이름 CTE / base table — CTE wins.
7. CTE 가 다른 CTE 참조 — 단일 단계 chaining, 더 깊은 재귀는 안전한 `null`.
8. 모든 edge 테스트 헤더에 `Sprint 295 (2026-05-14) — Slice D edge cases` +
   작성 이유.

### Slice E — Regression Guard

**Verification Profile**: `command`

**Acceptance Criteria**:

1. sprint-292 4 시나리오 + sprint-294 7 baseline + 1 mid-typing + 15 alias
   + 13 updateColumnCompletion = 모두 GREEN.
2. Slice A baseline 의 후보 라벨 셋이 unique (한 호출 안 dedup).
3. Cross-source dedup — 한 cursor 위치에서 모든 source 호출 후 popup
   dedup 결과 라벨 unique. CTE 이름과 같은 base table 이름 있을 때 CTE
   wins 단언.
4. 모든 새 테스트 파일에 `2026-05-14` 헤더.
5. `pnpm test` 전체 exit 0.

## Global Acceptance Criteria

1. 외부 dep 추가 없음.
2. 등록 경로 = sprint-292/294 패턴 (`dialect.language.data.of({ autocomplete })`).
3. TDD 순환 준수.
4. 모든 새 테스트 헤더에 `Sprint 295 (2026-05-14)`.
5. sprint-292 / 294 무회귀.
6. mini-parser = `WITH <name> AS (…) [, …]` + `FROM (…) [AS] <alias>` 만.
7. 일관된 token-based 또는 syntax-tree-based 접근.

## Data Flow

`useSqlAutocomplete` → `SQLNamespace` → `buildSqlLang` → 4 source (lang-sql
built-in + sprint-292 + sprint-294 + sprint-295) 가 같은 `getSchema()`
클로저로 namespace 공유. 새 source: cursor 좌측 `<alias>.<partial>` 인식 →
buffer 의 `WITH <name> AS (…)` / `FROM (…) <alias>` 패턴 mini-parser 로
virtual table → columns 매핑 → alias 가 virtual table 이면 virtual columns
emit. SELECT * → inner FROM 의 base table 을 namespace 로 폴백.

## Operational States

- 빈 / 미완성 SQL: cursor 가 alias dot 위치 아님 → `null`.
- 부분 입력 (`WITH t AS (SELECT id, |`): 완성된 컬럼까지만 emit, crash 없음.
- 에러 (paren 불균형): mini-parser 안전한 `null`, 다른 source 영향 없음.
- 성공: virtual columns popup 노출 (외부 IDE parity).

## Edge Cases

- inner SELECT * → base table fallback.
- CTE 안 JOIN → alias-prefixed 의 컬럼 이름만.
- 명시적 AS projection → alias name = virtual column.
- schema-qualified inner table → sprint-294 coalescing.
- WITH RECURSIVE → explicit column list 또는 안전한 null.
- alias 가 실재 base table 과 충돌 → CTE/derived wins.
- CTE 체이닝 — 단일 단계.
- inner SELECT 안 함수 호출 (paren) → paren-depth 추적.
- multi-statement → cursor 의 Statement.
- 대소문자 / Policy A.

## Verification Hints

- 핵심 명령: `pnpm test -- sqlCompletionLevel3 sqlCompletionLevel2
  sqlCompletionLevel1 updateColumnCompletion aliasColumnCompletion
  cteColumnCompletion`.
- 빌드: `pnpm tsc --noEmit`.
- Static: `grep -q "cteColumnCompletionSource\|cte\|virtual"
  src/components/query/SqlQueryEditor.tsx`.
- 헤더 정합성: `grep -L "Sprint 295 (2026-05-14)" …`.
- Evaluator 증거: pnpm test exit 0, dialect data 등록 라인, baseline GREEN +
  RED→GREEN diff.

## Notes for Generator

- sprint-294 의 `parseFromContext` 는 paren 안 SELECT projection 까지 안
  들어감 → mini-parser 가 paren-depth 추적 필수.
- syntax-tree 접근 (`syntaxTree(state)`) 의 `CTE` / `Parens` 노드 활용도
  가능. 측정 결과로 일관 선택.
- 가드 패턴 = sprint-292 / 294 복제.
- CTE 와 derived 를 한 source 로 합칠지 분리할지 Generator 가 측정 결과로
  결정. 한 source 가 단순하면 유지보수에 이로움 (sprint-294 의 단일 source
  패턴과 일관).
- SELECT * 폴백 시 inner FROM base table 추출은 sprint-294 의
  `parseFromContext` 결과 재사용.
- buffer 전체 또는 cursor 의 Statement — sprint-294 의 anywhere-scan 패턴
  재사용 가능.

### Critical Files

- `src/lib/completion/shared.ts`
- `src/lib/sql/aliasColumnCompletion.ts`
- `src/lib/sql/sqlCompletionLevel2.test.ts`
- `src/components/query/SqlQueryEditor.tsx`
- `src/lib/sql/sqlTokenize.ts`

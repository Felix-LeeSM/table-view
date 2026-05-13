# Feature Spec: SQL 자동완성 Level-2 — alias-aware JOIN

## Description

복합 SELECT (`FROM users u JOIN orders o ON o.<cursor>`, `SELECT u.<cursor>
FROM users u`, `SELECT o.<cursor> FROM users u JOIN orders o ON …`) 에서 Tab
자동완성이 DataGrip / TablePlus 수준으로 `o.` → orders 컬럼, `u.` → users
컬럼을 풀어내야 한다. Sprint 292 의 Level-1 (단일 테이블 SELECT/UPDATE/
INSERT/DELETE) 위에서 **JOIN + alias prefix 컬럼 후보** 만을 다룬다 — CTE /
derived subquery 는 sprint-295 의 도메인.

## Sprint Breakdown

Sprint 단위는 sprint-294 한 개. 내부적으로 다음 **5 개 슬라이스** 로 분할
— Foundation → Core → Wire → Edge → Regression.

### Slice A — Foundation: lang-sql built-in alias baseline

**Goal**: lang-sql 의 `schemaCompletionSource` 가 현재 `<alias>.<cursor>`
케이스를 어디까지 처리하는지 정확히 측정. 이 sprint 가 보강해야 하는
진짜 gap 을 코드로 확정.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 신규 단위 테스트 파일 `src/lib/sql/sqlCompletionLevel2.test.ts` 가 존재
   하며 헤더에 `Sprint 294 (2026-05-14) — Level-2 alias-aware JOIN` 및 작성
   이유 명시 — `grep -q "Sprint 294 (2026-05-14)" src/lib/sql/sqlCompletionLevel2.test.ts` exit 0.
2. `vitest` 실행 시 6 baseline 시나리오 — (a) `SELECT u.<cursor> FROM users u`,
   (b) `SELECT u.<cursor> FROM users u WHERE …`, (c) `FROM users u JOIN
   orders o ON o.<cursor>`, (d) `FROM users u JOIN orders o ON u.<cursor>`,
   (e) `SELECT o.<cursor> FROM users u JOIN orders o ON …`, (f) `SELECT
   u.<cursor>, o.<cursor> FROM users u JOIN orders o ON …` — 가 모두 실행
   되며 expected 가 명시.
3. 통과 / 실패 시나리오가 RED/GREEN 마커 (`it.fails` 또는 통과 케이스) 로
   구분. Slice B 가 처리할 gap 이 1 개 이상 표시.
4. Sprint 292 의 `sqlCompletionLevel1.test.ts` 가 변경 없이 그대로 통과.

**Components**:
- `src/lib/sql/sqlCompletionLevel2.test.ts`: 새 회귀 테스트. Sprint 292 의
  `callAll` 패턴 (async + `languageDataAt<CompletionSource>("autocomplete")`
  + `updateColumnCompletionSource` 합산) 그대로 따른다.

### Slice B — Core: alias-aware completion source

**Goal**: Slice A 에서 발견된 gap (`<alias>.<cursor>` 케이스 중 lang-sql 이
처리 못 하는 시나리오) 을 자체 source 로 채운다.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 신규 source 모듈 `src/lib/sql/aliasColumnCompletion.ts` 가 존재하며
   `aliasColumnCompletionSource(getSchema): CompletionSource` 시그니처 export.
2. Slice A 의 6 시나리오가 모두 GREEN — 각 시나리오에서 `o` / `u` prefix 의
   해당 테이블 컬럼이 `result.options.label` 에 포함.
3. cursor 가 alias dot 직전 (`<alias>.` 의 dot 앞) 일 때 컬럼 후보 안 내보냄.
4. cursor 가 문자열 / 숫자 / 주석 안 → `null` 반환.
5. 알 수 없는 alias (`xyz.<cursor>` 인데 FROM 절에 `xyz` 없음) → `null`.
6. `getSchema()` 가 `undefined` / 배열 → `null`.

**Components**:
- `src/lib/sql/aliasColumnCompletion.ts`: 새 completion source. 동기 호출
  안에서 syntax tree (또는 `parseFromContext` 의 token scan) 로 alias map
  구성 → cursor 위치의 `<alias>.<partial>` 가 alias map 에 속하면 해당
  테이블의 컬럼 후보 반환.
- `src/lib/sql/aliasColumnCompletion.test.ts`: 단위 테스트.

### Slice C — Wire: SqlQueryEditor 통합

**Goal**: 새 source 가 실제 에디터의 자동완성 파이프라인에서 호출되도록
`dialect.language.data.of({ autocomplete: … })` 로 등록.

**Verification Profile**: `mixed` (command + static)

**Acceptance Criteria**:

1. `src/components/query/SqlQueryEditor.tsx` 의 `buildSqlLang` 이 새 source
   를 dialect data 로 등록 — `grep -q "aliasColumnCompletionSource"
   src/components/query/SqlQueryEditor.tsx` exit 0.
2. Slice A 의 `sqlCompletionLevel2.test.ts` 의 `callAll` 헬퍼가 새 source 도
   자연스럽게 포함 — 추가 호출 코드 없음.
3. Sprint 292 의 4 시나리오 (`sqlCompletionLevel1.test.ts`) 가 그대로 통과.
4. `pnpm tsc --noEmit` exit 0.

**Components**:
- `src/components/query/SqlQueryEditor.tsx`: `buildSqlLang` 에 한 줄 추가.

### Slice D — Edge cases

**Goal**: 실전 SQL 에서 자주 나오는 추가 케이스 단언.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `FROM users u JOIN orders o JOIN order_items oi ON …` 의 `oi.<cursor>` →
   `order_items` 컬럼 노출.
2. `FROM public.users u WHERE u.<cursor>` (schema-qualified target) → users
   컬럼 노출. bare name + qualified name 둘 다 시도.
3. `FROM users AS u JOIN orders AS o ON o.<cursor>` (명시적 AS) → orders 컬럼.
4. 동일 alias 중복 (`FROM users u, users u`) → first-wins, crash 없음. 정책이
   코드 코멘트로 명시.
5. quoted alias / keyword 충돌 (`FROM users "from"`) → 인식 또는 안전한
   `null` 반환.

**Components**:
- `src/lib/sql/aliasColumnCompletion.ts`: edge-case 보강.
- `src/lib/sql/aliasColumnCompletion.test.ts`: 5 edge-case 단언.

### Slice E — Regression Guard

**Goal**: 새 source 가 Level-1 / lang-sql built-in 과 충돌하지 않는다.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `sqlCompletionLevel1.test.ts` 4 시나리오 GREEN.
2. `updateColumnCompletion.test.ts` 12 케이스 GREEN.
3. Slice A baseline 중 lang-sql 이 이미 처리하는 케이스 (예: `SELECT
   u.<cursor> FROM users u`) — 새 source 가 추가로 호출되어도 후보 중복
   없음. `callAll` 의 `labels` Set (dedup) 와 unique 컬럼 셋 일치.
4. `pnpm test` 전체 exit 0.
5. 새 테스트 파일 모두 작성 이유 + 작성일 (2026-05-14) 코멘트 —
   `grep -L "2026-05-14" src/lib/sql/aliasColumnCompletion.test.ts
   src/lib/sql/sqlCompletionLevel2.test.ts` 가 빈 출력.

**Components**:
- `src/lib/sql/sqlCompletionLevel2.test.ts`: 중복 후보 단언 보강.

## Global Acceptance Criteria

1. 신규 외부 dep 추가 없음.
2. 새 source 는 sprint 292 의 `updateColumnCompletionSource` 와 같은 등록
   경로 (`dialect.language.data.of({ autocomplete })`).
3. CTE / derived subquery 는 sprint-294 가 처리 **안 함** — 등장 시 명시적
   `it.todo` / `it.skip` 로 sprint-295 deferral 코멘트.
4. 모든 새 테스트 파일 헤더에 `Sprint 294 (2026-05-14)` + 작성 이유 코멘트.
5. TDD 순환 준수 — slice 안 RED → GREEN → 다음 slice. 가로 슬라이스 금지.

## Data Flow

- `useSqlAutocomplete` → zustand schema store → `SQLNamespace` (bare + 
  qualified 키 둘 다).
- `SqlQueryEditor` → `buildSqlLang(dialect, ns)` → lang-sql built-in source +
  sprint 292 `updateColumnCompletionSource` + sprint 294
  `aliasColumnCompletionSource` 가 같은 `getSchema()` 클로저 통해 namespace
  공유.
- 새 source: cursor 좌측 토큰 검사로 `<alias>.<partial>` 위치 인식 →
  statement 의 FROM/JOIN/INTO 절 스캔으로 alias → tableName 매핑 → namespace
  에서 컬럼 셋 반환.

## Edge Cases

- alias = reserved keyword 와 충돌 → quoted alias 인식 또는 안전한 `null`.
- alias 가 sub-statement 안에서만 정의 + outer 참조 — sprint-295 도메인.
  `it.todo`.
- alias mid-typing (`FROM users u JOIN ord`) — crash 없이 첫 alias 만이라도
  풀려야.
- 같은 alias 중복 — first-wins + 코드 코멘트.
- alias 가 unknown table → `null`.
- multi-statement (`...; ...`) — cursor 가 속한 Statement 만 분석.
- 대소문자 혼합 alias — namespace lookup 의 Sprint 268 Policy A (union) 통과.

## Verification Hints

- 핵심 명령: `pnpm test -- sqlCompletionLevel2 sqlCompletionLevel1
  updateColumnCompletion aliasColumnCompletion`.
- 빌드: `pnpm tsc --noEmit`.
- Static check: `grep -q "aliasColumnCompletionSource"
  src/components/query/SqlQueryEditor.tsx`.
- 헤더 정합성: `grep -L "Sprint 294 (2026-05-14)" …`.
- Evaluator 가 받아야 할 증거: (1) `pnpm test` exit 0 transcript, (2) 새
  source 가 dialect data 로 등록된 line, (3) Slice A 의 baseline GREEN
  vitest 출력.

## Notes for Generator

- lang-sql 의 `getAliases` 는 이미 JOIN + alias 인식 — Slice A baseline 측정
  결과에 따라 Slice B 자체 source 가 정말 필요한지 / 일부만 필요한지 결정.
  Generator 는 측정 결과를 먼저 RED 로 코드화 후 보강.
- 기존 `parseFromContext` (`src/lib/completion/shared.ts`) 는 token-level
  FROM/JOIN/INTO + alias 추출 — 재사용 가능.
- syntax-tree 접근 (`updateColumnCompletionSource` 방식) 도 가능. 둘 중
  하나를 일관 선택.
- cursor 가드 (`String` / `Number` / `Comment`) — Sprint 292 패턴 복제.

### Critical Files

- `src/lib/sql/updateColumnCompletion.ts`
- `src/lib/completion/shared.ts`
- `src/components/query/SqlQueryEditor.tsx`
- `src/lib/sql/sqlCompletionLevel1.test.ts`
- `src/hooks/useSqlAutocomplete.ts`

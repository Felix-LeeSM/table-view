# Sprint Contract: sprint-383

## Summary

- Goal: **mongosh AST parser full grammar** — extend sprint-382 의 MVP AST (`src/lib/mongo/mongoshAst.ts`) 가 deferred 한 케이스를 채운다: (1) BSON literal call-expression (5종) inside object literal values, (2) 블록 코멘트 `/* ... */`, (3) 보간 없는 템플릿 리터럴 `` `text` ``. 또한 sprint-382 review 의 non-blocking note 3종 (err helper consolidation, parseArgList 추출, trailing chain 코멘트 명시) 을 흡수한다. `analyzeMongoPipeline` (mongoSafety.ts) 는 depth-1 nested `$facet` / `$lookup.pipeline` 안의 `$out` / `$merge` 까지 감지한다.
- Audience: sprint-382 contract Out-of-Scope 가 "→ sprint-383" 로 미룬 BSON literal / 블록 코멘트 / 템플릿 리터럴.
- Owner: Generator (sprint-383)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- **수정 — mongoshAst.ts**:
  - BSON literal 5종 (`ObjectId`, `ISODate`, `NumberLong`, `Decimal128`, `UUID`) 를 *value position* 에서 call expression 으로 수용. AST 는 각 literal 을 backend `run_mongo_command` 가 그대로 받아들이는 extended-JSON placeholder 객체 (`{$oid: "..."}`, `{$date: "..."}`, `{$numberLong: "..."}`, `{$numberDecimal: "..."}`, `{$uuid: "..."}`) 로 normalize.
  - 블록 코멘트 `/* ... */` 는 이미 sprint-382 가 strip; 본 sprint 는 nested 비지원을 contract 에 명문화하고 회귀 테스트 추가.
  - 보간 없는 템플릿 리터럴 `` `text` `` 를 string literal 로 수용. `${` 발견 시 error.
  - 신규 error kind: `variable-declaration`, `function-declaration`, `non-db-statement` (sprint-382 의 일반 `unsupported-syntax` 를 분화).
  - Refactor: `err` / `errMake` 단일 helper 로 통합. `parseCollectionCommand` 의 chain-arg loop 와 main arg-list loop 를 `parseArgList` helper 로 추출. trailing chain 코멘트 블록 (2줄) 추가.
- **수정 — runCommandParser.ts**:
  - `extractAdminCommandBody` 가 BSON literal 을 placeholder 객체로 반환 (regression: sprint-382 는 BSON literal 발견 시 `null` 반환 → 본 sprint 는 정상 객체 반환).
  - 신규 error kind 들도 `unknown` 으로 매핑.
- **수정 — mongoshAst.test.ts**:
  - 신규 AC 25개 (BSON 14 + 블록 코멘트 3 + 템플릿 2 + 거부 3 + refactor regression 3).
  - sprint-382 `AC-382-T10` (ObjectId / ISODate / NumberLong rejection) 케이스 3개는 *수용* 으로 전환 — semantic change. test body 갱신.
- **수정 — runCommandParser.test.ts**:
  - sprint-382 의 "extractAdminCommandBody returns null when a BSON literal is present" 케이스를 *수용* 으로 전환. 신규 AC 1-2개 추가 (BSON placeholder 반환).
- **수정 — mongoSafety.ts**:
  - `analyzeMongoPipeline` 가 depth-1 nested `$facet` / `$lookup.pipeline` 안의 `$out` / `$merge` 까지 감지.
- **수정 — mongoSafety.test.ts**:
  - 신규 AC 6개 (depth-1 nested detect 5 + deeper not-detected regression 1).

## Out of Scope (STILL REJECT)

- 변수 / 함수 선언 statement 자체 (`let x = 1`, `function foo()`) — 본 sprint 는 `errorKind` 만 분화하고 거부는 유지.
- Regex literal `/foo/i` — 거부 유지.
- 보간 있는 템플릿 리터럴 `` `${x}` `` — sprint-384 영역, 본 sprint 는 거부.
- 변수 참조 (`{a: x}`) — 거부 유지.
- Nested 블록 코멘트 `/* a /* b */ c */` — mongosh 실제 동작과 동일하게 *first close* 까지만 매칭 (즉 ` c */` 는 garbage → error). 본 sprint 가 명문화.
- `$function` server-side JavaScript pipeline stage — 거부 유지.
- depth ≥ 2 nested pipeline (e.g. `$facet > $facet > $out`) 의 detect — cycle detector 가 필요한 영역, 본 sprint 미커버.
- `parseMongoshExpression` (Phase 28 whitelist parser) 통합 / 재구현.
- `analyzeMongoRunCommand` 변경.
- BSON literal 의 *top-level* statement (`ObjectId("…")` 단독) — 거부 유지 (head must be `db`).

## Invariants

- sprint-381/-382 의 모든 기존 입력은 *동일* 결과 반환 (regression). 단, BSON literal 을 포함한 body 는 `null` → 정상 placeholder 객체로 전환 — 본 sprint 가 의도적으로 lock 하는 단 하나의 semantic shift.
- `mongoshAst.ts` 는 React / DOM / Tauri IPC import 없음 — 순수 TS.
- `unknown` + type guard 만 사용; `any` 금지.
- `analyzeMongoPipeline` 의 read-only severity (`info`) 는 nested 분석으로 인해 *증가* 하지 않음 — `$facet` 가 read-only sub-pipeline 만 가지면 그대로 `info`.

## Acceptance Criteria

### BSON literal — tokenizer + AST

- `AC-383-B1` `db.runCommand({_id: ObjectId("507f1f77bcf86cd799439011")})` → body `{_id: {$oid: "507f1f77bcf86cd799439011"}}`.
- `AC-383-B2` `db.runCommand({_id: ObjectId()})` (empty arg) → body `{_id: {$oid: null}}`.
- `AC-383-B3` `ObjectId("...")` 가 정확히 24 자 hex 가 아니어도 *string literal* 인 한 수용 — 길이/문자 검증은 backend 책임.
- `AC-383-B4` `db.runCommand({when: ISODate("2026-05-18T12:00:00Z")})` → body `{when: {$date: "2026-05-18T12:00:00Z"}}`.
- `AC-383-B5` `db.runCommand({when: ISODate()})` (empty arg) → body `{when: {$date: null}}`.
- `AC-383-B6` `db.runCommand({n: NumberLong("123456789")})` → body `{n: {$numberLong: "123456789"}}`.
- `AC-383-B7` `db.runCommand({n: NumberLong(123)})` (number arg) → body `{n: {$numberLong: "123"}}` (숫자 → 문자열 정규화, 확장 JSON 컨벤션).
- `AC-383-B8` `db.runCommand({d: Decimal128("3.14")})` → body `{d: {$numberDecimal: "3.14"}}`.
- `AC-383-B9` `db.runCommand({d: Decimal128(3.14)})` → body `{d: {$numberDecimal: "3.14"}}`.
- `AC-383-B10` `db.runCommand({u: UUID("550e8400-e29b-41d4-a716-446655440000")})` → body `{u: {$uuid: "550e8400-e29b-41d4-a716-446655440000"}}`.
- `AC-383-B11` BSON literal 이 *top-level statement* 일 때 (`ObjectId("...")`) → `errorKind: "non-db-statement"`.
- `AC-383-B12` BSON literal 이 2개 이상의 arg 를 가지면 거부 (`ObjectId("a", "b")`) — `errorKind: "unsupported-syntax"`.
- `AC-383-B13` BSON literal 의 arg 가 객체 / 배열 / nested call 이면 거부 (`ObjectId({$oid: "..."})`) — `errorKind: "unsupported-syntax"`.
- `AC-383-B14` BSON literal 이 collection-command 의 arg 안에 있어도 수용 (`db.users.find({_id: ObjectId("...")})`).

### 블록 코멘트 / 템플릿 리터럴

- `AC-383-C1` `/* leading */ db.runCommand({ping: 1})` → admin-command (sprint-382 에서 이미 통과; 회귀 lock).
- `AC-383-C2` `db.runCommand(/* inline */{ping: 1})` → admin-command (인라인 블록 코멘트).
- `AC-383-C3` Nested 블록 코멘트 `/* a /* b */ c */ db.runCommand({ping: 1})` → error (첫 `*/` 가 닫고, ` c */` 는 garbage).
- `AC-383-T1` `db.runCommand({name: \`alice\`})` (보간 없는 백틱) → body `{name: "alice"}`.
- `AC-383-T2` `db.runCommand({name: \`hello ${world}\`})` (보간) → `errorKind: "unsupported-syntax"`.

### 거부 케이스 (sprint-382 의 generic unsupported-syntax 를 분화)

- `AC-383-R1` `let x = 1` → `errorKind: "variable-declaration"`, message 가 "query tab" 단어 포함.
- `AC-383-R2` `function foo() {}` → `errorKind: "function-declaration"`.
- `AC-383-R3` `1 + 1` (bare 표현식) → `errorKind: "non-db-statement"`.

### Pipeline depth-1 detect (mongoSafety.ts)

- `AC-383-P1` `[{$facet: {alpha: [{$out: "x"}]}}]` → `severity: "danger"`, `kind: "mongo-out"`.
- `AC-383-P2` `[{$facet: {alpha: [{$merge: "y"}]}}]` → `severity: "danger"`, `kind: "mongo-merge"`.
- `AC-383-P3` `[{$lookup: {from: "x", pipeline: [{$out: "y"}]}}]` → `severity: "danger"`, `kind: "mongo-out"`.
- `AC-383-P4` `[{$lookup: {from: "x", pipeline: [{$merge: "y"}]}}]` → `severity: "danger"`, `kind: "mongo-merge"`.
- `AC-383-P5` `[{$facet: {alpha: [{$facet: {beta: [{$out: "z"}]}}]}}]` (depth-2) → `severity: "info"` (out-of-scope, regression-lock for deferred behavior).
- `AC-383-P6` `[{$facet: {alpha: [{$match: {}}]}}]` (read-only $facet) → `severity: "info"`.

### Refactor regression (sprint-382 review 흡수)

- `AC-383-X1` 단일 `err` helper 만 존재 — `errMake` 삭제. (테스트는 동작 회귀로 lock.)
- `AC-383-X2` `parseCollectionCommand` 의 main arg-list 와 chain-arg loop 가 *동일* `parseArgList` 헬퍼 호출. (구조 회귀: chain method 의 trailing comma 도 수용.)
- `AC-383-X3` Trailing chain (`db.users.find({}).sort({}).limit(10)`) 는 lexically 수용; dispatcher 는 첫 method 만 honor — 본 sprint 가 코멘트로 명문화.

## Design Bar / Quality Bar

- TDD red-green-refactor — AC-383-B1 부터 한 번에 하나씩.
- 신규 라인 line coverage ≥ 70%.
- BSON literal placeholder 는 plain `{$oid: ...}` 형태 — mongosh extended-JSON 컨벤션. backend `run_mongo_command` 는 이 형태를 그대로 BSON 으로 deserialize.
- 모든 error 는 `errorKind` enum 보유; sprint-382 의 union 에 3개 추가.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/mongo/` — 모든 mongo 모듈 테스트 통과.
2. `pnpm vitest run` — 전체 회귀 통과.
3. `pnpm tsc --noEmit` — 0 errors.
4. `pnpm lint` — 0 errors.

### Required Evidence

- 신규 `mongoshAst.test.ts` 의 AC 25개 결과.
- `runCommandParser.test.ts` 의 sprint-382 케이스 1개 (BSON null 반환) → 수용 전환 결과.
- `mongoSafety.test.ts` 의 신규 AC 6개 결과.
- 전체 vitest 회귀 카운트 (sprint-382 baseline 4239 → 4239 + N).

## Test Requirements

- Vitest: 신규 mongoshAst.test.ts AC 25 + mongoSafety.test.ts AC 6 + runCommandParser.test.ts AC 1-2.
- 기존 케이스 수정 ≤ 4건 (BSON rejection → 수용 전환).

## Test Script / Repro Script

1. `pnpm vitest run src/lib/mongo/`
2. `pnpm tsc --noEmit && pnpm lint`
3. `pnpm vitest run` (full regression)

## Ownership

- Generator: general-purpose Agent (sprint-383).
- Write scope: In Scope.
- Merge order: 독립 — sprint-382 가 메인 in.

## Exit Criteria

- Open P1/P2: 0
- AC 31/31 PASS (25 mongoshAst + 6 pipeline)
- pre-commit / pre-push hooks green
- PR open + linked

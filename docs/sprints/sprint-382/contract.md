# Sprint Contract: sprint-382

## Summary

- Goal: **mongosh AST parser MVP** — promote sprint-381 의 정규식 기반 `classifyMongoStatement` / `extractAdminCommandBody` 를 *typed AST* 로 교체. 신규 모듈 `src/lib/mongo/mongoshAst.ts` 가 tokenizer + recursive-descent parser 를 제공하고, `runCommandParser.ts` 가 본 AST 위에서 분류·추출을 수행한다. **Export signature 는 미변경** — call site (`useQueryExecution.ts`, `Toolbar.tsx`) 는 그대로.
- Audience: sprint-381 contract Hardening 섹션이 "AST 가 promote" 라고 명시한 후속 작업.
- Owner: Generator (sprint-382)
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)

## In Scope

- **신규 모듈**:
  - `src/lib/mongo/mongoshAst.ts` — pure TypeScript tokenizer + AST 빌더. 의존성 없음 (React/DOM/Tauri IPC 미사용).
  - `src/lib/mongo/mongoshAst.test.ts` — token / object / statement / refusal 시나리오.
- **수정**:
  - `src/lib/mongo/runCommandParser.ts` — `classifyMongoStatement` 와 `extractAdminCommandBody` 의 *내부* 가 AST 호출로 교체. 정규식 path 제거. Export signature 미변경.
  - `src/lib/mongo/runCommandParser.test.ts` — 기존 contract 보존 + AST 가 가능케 한 시나리오 추가 (multi-statement reject, nested object body, line comment 처리).
- **call site 미변경**: `src/components/query/QueryTab/useQueryExecution.ts` (line 1760–1860), `src/components/query/QueryTab/Toolbar.tsx` — 호출 형태 동일.
- **mongoshParser.ts (Phase 28 method-whitelist parser) 미변경** — 자체 tokenizer 가 이미 성숙해 LOC 추가 없이 통합 불가. (본 sprint 의 AST 모듈은 *statement classifier* 의 책임만 promote; whitelist parser 는 sprint-383 이후 별 작업에서 통합 검토.)
- **mongoSafety.ts `analyzeMongoRunCommand` 미변경** — 입력은 이미 `Record<string, unknown>` 으로 정규화된 body 이므로 AST 와 직교.

## Out of Scope (REJECT with clear errors → sprint-383)

- BSON literal: `ObjectId(...)`, `ISODate(...)`, `NumberLong(...)`, `NumberDecimal(...)`, `UUID(...)`, `BinData(...)`. AST 가 call expression 으로 만나면 `errorKind: "bson-literal"` 로 거부. (단, sprint-381 의 `extractAdminCommandBody` 는 BSON literal 본문을 *수용 안 함* 이 sprint-381 invariant 이므로 본 sprint 도 그 시맨틱 유지.)
- 블록 코멘트 `/* ... */` — tokenizer 가 이미 처리하므로 무료로 지원 (단, sprint-381 invariant 에 명시되지 않았으므로 contract 상 *bonus*).
- 템플릿 리터럴 `` `...` ``, regex literal `/foo/`, 변수 / 함수 선언, `let` / `const` / `var`, 화살표 함수.
- 다중 statement (`db.x.find(); db.y.drop()`) — `errorKind: "multiple-statements"` 로 거부 (sprint-381 정규식의 anchored `^` 시맨틱 보존).
- `parseMongoshExpression` (Phase 28 whitelist parser) 통합 / 재구현.
- `analyzeMongoRunCommand` 변경.
- `analyzeMongoPipeline` / aggregation pipeline 분석.

## Invariants

- `classifyMongoStatement(sql)` 는 모든 기존 입력에 대해 sprint-381 과 동일한 `MongoStatementKind` 반환 (regression-locked).
- `extractAdminCommandBody(sql)` 는 모든 기존 입력에 대해 sprint-381 과 동일한 `Record<string, unknown> | null` 반환.
- `statementAllowsMissingDatabase` 는 미변경.
- `mongoshAst.ts` 는 React / DOM / Tauri IPC import 없음 — 순수 TS.
- `unknown` + type guard 만 사용; `any` 금지.

## Acceptance Criteria

### Tokenizer + AST (mongoshAst.ts)

- `AC-382-T1` `db.runCommand({ping: 1})` 입력 시 AST → `{kind: "admin-command", commandName: "runCommand", body: {ping: 1}}`.
- `AC-382-T2` `db.adminCommand({serverStatus: 1})` → `{kind: "admin-command", commandName: "adminCommand", body: {serverStatus: 1}}`.
- `AC-382-T3` `db.users.find({})` → `{kind: "collection-command", collection: "users", method: "find", args: [{}]}`.
- `AC-382-T4` `db.users.find({}, {limit: 10})` → args length 2.
- `AC-382-T5` object literal: identifier key + quoted key 혼합 (`{a: 1, "b.c": 2}`) → `{a: 1, "b.c": 2}`.
- `AC-382-T6` 중첩 object literal `{outer: {inner: 1}}` → `{outer: {inner: 1}}`.
- `AC-382-T7` 문자열 single / double quote 양쪽 동일 동작.
- `AC-382-T8` 라인 코멘트 `// ...` 가 입력 어디에 있든 strip.
- `AC-382-T9` 다중 statement (`db.x.find({}); db.y.find({})`) → `{kind: "error", errorKind: "multiple-statements"}`.
- `AC-382-T10` `ObjectId("...")` 가 본문 안에 있으면 → `{kind: "error", errorKind: "bson-literal"}`.
- `AC-382-T11` 빈 입력 / 공백만 → `{kind: "error", errorKind: "unsupported-syntax"}` 와 별개로 *unknown* path 가능 — classifier 가 이를 `"unknown"` 으로 흡수.
- `AC-382-T12` 화살표 함수 `=>` / 템플릿 리터럴 `` ` `` → `{kind: "error", errorKind: "unsupported-syntax"}`.

### runCommandParser integration

- `AC-382-R1` 기존 `runCommandParser.test.ts` 의 sprint-381 시나리오 6 + 4 + 3 = 13 케이스 모두 보존 + 통과.
- `AC-382-R2` `extractAdminCommandBody("db.runCommand({ping: 1})")` → `{ping: 1}` (regex 와 동일).
- `AC-382-R3` `extractAdminCommandBody("db.runCommand({outer: {inner: 1}})")` → `{outer: {inner: 1}}` (AST 의 nested 처리는 정규식 1-패스 quoter 가 항상 안전한 건 아니지만, 본 sprint 의 AST 는 정확히 처리하므로 신규 lock).
- `AC-382-R4` `classifyMongoStatement("// comment\ndb.runCommand({ping: 1})")` → `"admin-command"` (sprint-381 정규식은 `\s*` 만 처리 → 본 sprint 가 expand).
- `AC-382-R5` `classifyMongoStatement("db.users.find({}); db.users.drop()")` → `"unknown"` (multi-statement 거부; sprint-381 의 anchored `^` 와 동일 결과).

## Design Bar / Quality Bar

- TDD red-green-refactor — AC-382-T1 부터 한 번에 하나씩.
- 신규 파일 line coverage ≥ 70% (project threshold 와 동일).
- AST 노드 타입은 **discriminated union** (`kind` 필드).
- 모든 error 는 `errorKind` enum 보유 (sprint-381 의 silent `null` 반환과 호환되도록 `runCommandParser.ts` 가 error → null 변환).
- 신규 파일 헤더에 `Sprint 382 (2026-05-17)` + 작성 이유 코멘트.

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/mongo/` — 모든 mongo 모듈 테스트 통과 (특히 `runCommandParser.test.ts` + `mongoshParser.test.ts` 회귀 없음).
2. `pnpm vitest run` — 전체 회귀 통과.
3. `pnpm tsc --noEmit` — 0 errors.
4. `pnpm lint` — 0 errors.

### Required Evidence

- 신규 `mongoshAst.test.ts` 의 12+ AC 케이스 결과.
- `runCommandParser.test.ts` 의 기존 13 + 신규 case 결과.
- 전체 vitest 회귀 카운트 (sprint-381 baseline 대비 신규 N 만 증가).

## Test Requirements

- Vitest: 신규 mongoshAst.test.ts 12 케이스 + runCommandParser.test.ts 신규 3 케이스. 기존 case 미수정 (단, 정규식 구현 디테일에 의존한 게 있으면 update — 리포트에 명시).

## Test Script / Repro Script

1. `pnpm vitest run src/lib/mongo/`
2. `pnpm tsc --noEmit && pnpm lint`
3. `pnpm vitest run` (full regression)

## Ownership

- Generator: general-purpose Agent (sprint-382).
- Write scope: In Scope.
- Merge order: 독립 — sprint-381 의 정규식 path 가 본 sprint 후 제거.

## Exit Criteria

- Open P1/P2: 0
- AC 17/17 PASS
- pre-commit / pre-push hooks green
- PR open + linked

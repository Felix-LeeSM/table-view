# Sprint Contract: sprint-384

## Summary

- Goal: **mongo BSON IPC end-to-end fix + sprint-383 cleanup** — sprint-383 의 review 가 발견한 4건의 non-blocking issue 를 닫는다: (P1) frontend 가 보내는 extended-JSON placeholder (`{$oid: "..."}`, `{$date: "..."}`, …) 를 backend `run_mongo_command` IPC 가 실제 BSON variant 로 변환하지 않아 MongoDB server 가 sub-document 로 인식하는 semantic bug, (P2) `useQueryExecution.ts` 의 stale error 문구 "BSON literals are not yet supported", (P3) `runCommandParser.ts` 의 stale docstring "deferred to sprint-383", (P4) `mongoshAst.ts` 가 1033 LOC 로 max-lines soft cap 을 초과 → 4-파일 split.
- Audience: sprint-383 PR review notes.
- Owner: Generator (sprint-384)
- Verification Profile: `frontend + backend` (pnpm vitest + pnpm tsc + pnpm lint + cargo test + cargo clippy)

## In Scope

- **수정 — `src-tauri/src/commands/document/query.rs`** (P1):
  - `run_mongo_command` 의 시그니처를 `command: bson::Document` → `command: serde_json::Value` 로 전환.
  - 신규 helper `extjson_to_bson_document(value: serde_json::Value) -> Result<bson::Document, AppError>`: `bson::Bson::try_from(serde_json::Value)` 를 호출해 extended-JSON placeholder (`{$oid: "..."}`, `{$date: "..."}`, `{$numberLong: "..."}`, `{$numberDecimal: "..."}`, `{$uuid: "..."}`) 를 진짜 `Bson::ObjectId` / `Bson::DateTime` / `Bson::Int64` / `Bson::Decimal128` / `Bson::Binary(Uuid)` variant 로 변환. plain JSON object 는 그대로 통과. invalid extended-JSON → `AppError::Validation`.
  - 다른 `find_documents` / `aggregate_documents` / `find_one_document` / `count_documents` / `distinct_documents` / `explain_mongo_find` 의 시그니처는 **그대로** — sprint-385 이상에서 cursor-chain BSON literal 지원이 들어올 때 같은 helper 를 재사용하도록 별도 sprint 로 분리.
- **수정 — `src/components/query/QueryTab/useQueryExecution.ts`** (P2):
  - 1774 라인 error message 를 갱신: "BSON literals are not yet supported" → "BSON literals (`ObjectId("…")` 등) 는 수용; nested call 이나 unknown literal 은 거부."
- **수정 — `src/lib/mongo/runCommandParser.ts`** (P3):
  - 47-49 라인 docstring 갱신: "full BSON literal support is deferred to sprint-383" → "BSON literals (`ObjectId` / `ISODate` / `NumberLong` / `Decimal128` / `UUID`) accepted as extended-JSON placeholders; backend converts to real BSON via `bson::Bson::try_from` (sprint-384)."
- **신규 — `src/lib/mongo/mongoshAst/`** (P4):
  - 디렉토리 신설. 4 파일로 split:
    - `index.ts` — public re-export (`parseMongoshStatement` + 모든 type). 호출부 import path 변경 없음 (`src/lib/mongo/mongoshAst.ts` 가 shim 으로 남거나 디렉토리 `index.ts` 가 resolved).
    - `lexer.ts` — `Token` type, `PUNCT_CHARS`, `tokenize`, `readString`, `readTemplate`, `readNumber`, `topLevelSemicolons`, `TokenStream` class.
    - `parser.ts` — `parseProgram`, `parseAdminCommand`, `parseCollectionCommand`, `parseValue`, `parseObject`, `parseArray`, `parseBsonLiteral`, BSON literal name set + placeholder map, control-flow / variable / function / shell helper rejection helpers, `sniffHeadKeyword`, `describeToken`, `isPlainObject`, `err`, `tokErr`.
    - `argList.ts` — sprint-383 의 `parseArgList` helper. lexer + parser 가 share.
  - 기존 `src/lib/mongo/mongoshAst.ts` 는 `export * from "./mongoshAst/index"` shim 으로 단축 (한 줄 — backward-compat 보존).
- **수정 — `src-tauri/src/commands/document/query.rs` tests**:
  - 신규 P1 단위 테스트 5개 (ObjectId / ISODate / NumberLong / Decimal128 / UUID conversion) + plain JSON regression 1개. 기존 `run_mongo_command_database_*_routes_to_*` 테스트 시그니처 변경에 따라 호출부 갱신 — body 구성을 `bson::Document` → `serde_json::json!({...})` 로 전환.

## Out of Scope

- mongoshAst public API surface 변경 (export 이름, 함수 signature 등) — 본 sprint 는 *file split* + *behavior preservation*.
- `find_documents` / `aggregate_documents` 등 다른 IPC entry 의 BSON literal 변환 — cursor-chain `find({_id: ObjectId(...)})` 가 backend 까지 통과하는 path 는 sprint-385+ (현재 frontend 는 admin-command 만 placeholder 를 만든다).
- `aggregate_documents` 의 pipeline 안의 `$function` server-side JS 처리.
- BSON literal 의 *top-level* statement (`ObjectId("…")` 단독) — 거부 유지.
- frontend call shape 변경 — `runMongoCommand(connectionId, database, body)` signature 유지. 변경은 backend deserialize path 에 국한.
- 새로운 mongosh literal (BinData, NumberInt, etc.) — sprint-385+.

## Invariants

- frontend 가 보내는 JSON body shape 은 변하지 않는다 — sprint-383 의 mongoshAst 가 만드는 `{$oid: "..."}` placeholder 가 그대로 IPC 를 통과해 backend 에서 BSON 으로 변환.
- 기존 plain JSON (BSON marker 없는) body 는 동일 BSON Document 로 변환됨 (regression-lock).
- `mongoshAst.ts` public import path 변경 없음 — `import { parseMongoshStatement } from "@/lib/mongo/mongoshAst"` 가 동일 동작.
- 4267 vitest 회귀 + 1600 cargo test 회귀 그대로 통과.

## Acceptance Criteria

### P1 — BSON IPC extended-JSON conversion

- `AC-384-P1-1` `run_mongo_command_inner` 가 `serde_json::json!({"_id": {"$oid": "507f1f77bcf86cd799439011"}})` 를 받으면 어댑터에 전달되는 `bson::Document` 의 `_id` field 가 `Bson::ObjectId(...)` variant 다 (sub-document 가 아님).
- `AC-384-P1-2` ISODate placeholder `{"when": {"$date": "2026-05-18T12:00:00Z"}}` → `Bson::DateTime`.
- `AC-384-P1-3` NumberLong placeholder `{"n": {"$numberLong": "9223372036854775000"}}` → `Bson::Int64`.
- `AC-384-P1-4` Decimal128 placeholder `{"d": {"$numberDecimal": "3.14"}}` → `Bson::Decimal128`.
- `AC-384-P1-5` UUID placeholder `{"u": {"$uuid": "550e8400-e29b-41d4-a716-446655440000"}}` → `Bson::Binary` (subtype Uuid).
- `AC-384-P1-6` plain JSON `{"ping": 1, "host": "example.com"}` (no markers) → BSON `{"ping": Int32(1), "host": String("example.com")}` (regression-lock).
- `AC-384-P1-7` invalid placeholder `{"_id": {"$oid": "not-24-hex"}}` → `AppError::Validation` (bson 의 extjson 파서가 hex 길이를 검증).

### P2 — Error message refresh

- `AC-384-P2-1` `src/components/query/QueryTab/useQueryExecution.ts` 의 1774 라인 부근 admin-command parse-fail message 가 "BSON literals are not yet supported" 문구를 더 이상 포함하지 않는다 + "BSON literals" 가 *수용* 됨을 명시.

### P3 — Docstring refresh

- `AC-384-P3-1` `src/lib/mongo/runCommandParser.ts` 의 `extractAdminCommandBody` docstring 이 "deferred to sprint-383" 문구를 포함하지 않는다 + `bson::Bson::try_from` 백엔드 변환을 언급.

### P4 — mongoshAst split

- `AC-384-P4-1` `src/lib/mongo/mongoshAst/` 디렉토리 존재; 안에 `index.ts`, `lexer.ts`, `parser.ts`, `argList.ts` 4개 파일 모두 존재.
- `AC-384-P4-2` 각 split 파일이 max-lines soft cap (500) 미만 OR shim 으로 single re-export 만 포함.
- `AC-384-P4-3` `pnpm vitest run src/lib/mongo/mongoshAst.test.ts` 의 기존 56 case 가 그대로 PASS — public behavior 보존.
- `AC-384-P4-4` `pnpm lint` 가 `mongoshAst` 관련 `max-lines` warning 을 더 이상 emit 하지 않는다.

## Design Bar / Quality Bar

- TDD red-green-refactor — P1 부터 Rust 단위 테스트 RED 로 시작.
- 신규 Rust 코드 line coverage ≥ 70%.
- BSON conversion 은 `bson::Bson::try_from(serde_json::Value)` 한 줄 — 수동 walker 작성 금지.
- 모든 error 는 `AppError::Validation` (frontend 가 surface).
- `unwrap()` / `expect()` 사용 금지 (user-input path) — `?` 로 propagate.
- mongoshAst split 은 *behavior-preserving* — 함수 본문 변경 0. 단순 cut/paste + import wiring 만.

## Verification Plan

### Required Checks

1. `cd src-tauri && cargo test` — 모든 Rust 테스트 통과 (1600 + 신규 7).
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings` — 0 warnings.
3. `pnpm vitest run` — 4267 + 0 신규 (frontend 변경 모두 텍스트만 / 파일 split — 신규 vitest case 없음).
4. `pnpm tsc --noEmit` — 0 errors.
5. `pnpm lint` — 0 errors, `mongoshAst` max-lines warning 사라짐.

### Required Evidence

- Rust 신규 AC 7개 결과 (extjson_to_bson_document tests).
- 전체 cargo test 회귀 카운트.
- 전체 vitest 회귀 카운트 (4267 → 4267).
- `pnpm lint` 출력에서 `mongoshAst` 관련 warning 부재 확인.

## Test Requirements

- Rust: 신규 AC 7개 (P1) + 기존 `run_mongo_command_database_*_routes_to_*` 2건 signature 갱신.
- TS: 텍스트 변경 (P2/P3) 은 새 테스트 없이 lint 만 — useQueryExecution / runCommandParser 의 기존 테스트는 통과.

## Test Script / Repro Script

1. `cd src-tauri && cargo test commands::document::query`
2. `cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings`
3. `pnpm vitest run src/lib/mongo/`
4. `pnpm tsc --noEmit && pnpm lint`
5. `pnpm vitest run` (full regression)

## Ownership

- Generator: general-purpose Agent (sprint-384).
- Write scope: In Scope.
- Merge order: 독립 — sprint-383 가 메인 in.

## Exit Criteria

- Open P1/P2: 0
- AC 13/13 PASS (P1 7 + P2 1 + P3 1 + P4 4)
- pre-commit / pre-push hooks green
- PR open + linked

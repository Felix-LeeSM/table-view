# Sprint Contract: sprint-381

## Summary

- Goal: MongoDB **db-contract α** + admin command gateway. (a) `connection.database` 의 Mongo-only 필수 해제 (RDB 는 required 유지), (b) `db.runCommand({...})` / `db.adminCommand({...})` 를 단일 IPC `run_mongo_command` 로 통과시키는 generic gateway, (c) TabDbChip 의 미선택 라벨 "(no database)" + statement-kind 인식 (admin command 시 chip 없이 Run enabled, collection command 시 chip 필수), (d) mongoAutocomplete 의 admin command dict 확장. AST parser 는 **본 sprint scope 아님** — 정규식 기반 statement-kind 판별 (sprint-382 가 AST 로 promote).
- Audience: 사용자 보고 (2026-05-17) — Mongo Query 창에서 "(select database)" chip + "Select a target database…" 메시지 때문에 `db.runCommand(...)` 같은 admin command 시도 불가.
- Owner: Generator (sprint-381)
- Verification Profile: `frontend` + `backend` (pnpm vitest + pnpm tsc + pnpm lint + cargo fmt + cargo clippy + cargo test)

## In Scope

- **Frontend types**:
  - `src/types/connection.ts` — Mongo 의 `database` 필드 의미 변경 (빈 문자열 = "no database"). 타입 자체는 wire compat 위해 `string` 그대로 유지.
- **Frontend connection form (Mongo only)**:
  - `src/components/connection/forms/MongoFormFields.tsx` — label "Database (optional)" + placeholder 갱신.
  - `src/components/connection/ConnectionDialog.tsx` — Save 검증 분기. Mongo (`isMongo`) 일 때 database 빈 OK; RDB (postgresql / mysql / sqlite) 는 기존 required 유지.
- **Frontend toolbar (statement kind)**:
  - `src/components/query/QueryTab/TabDbChip.tsx` — label "(no database)" (이전 "(select database)").
  - `src/components/query/QueryTab/Toolbar.tsx` — Run disable 조건 변경. `tab.paradigm === "document"` 일 때 sql 이 admin command pattern (`/^\s*db\.(runCommand|adminCommand)\s*\(/`) 매칭 시 chip 미선택 OK + Run enabled; collection command 일 때 chip 필수.
- **Frontend dispatcher**:
  - `src/components/query/QueryTab/useQueryExecution.ts` — document paradigm Run dispatch 분기. admin command pattern 매칭 시 `runMongoCommand` IPC 호출 (database 인자 = `tab.database || null`); collection command 일 때 기존 `parseMongoshExpression` 경로.
- **Frontend autocomplete**:
  - `src/lib/mongo/mongoAutocomplete.ts` — `MONGOSH_DB_METHODS` 에 `runCommand`/`adminCommand` 추가; 신규 `MONGO_ADMIN_COMMANDS` dict (`ping`, `serverStatus`, `hostInfo`, `buildInfo`, `listDatabases`, `listCollections`, `dbStats`, `collStats`, `currentOp`, `killOp`, `getCmdLineOpts`, `setProfilingLevel`, `getProfilingStatus`, `validate`, `getCollection`, …); `db.runCommand({` / `db.adminCommand({` 뒤 위치에서 admin command literal (`serverStatus: 1`) 추천 (신규 `createMongoAdminCommandSource`).
- **Frontend IPC wrapper**:
  - `src/lib/tauri/document.ts` — `runMongoCommand(connectionId, database, command)` wrapper.
- **Backend**:
  - `src-tauri/src/db/traits.rs` — `DocumentAdapter::run_command` trait method 추가 (`database: Option<&str>`, `command: bson::Document` → `serde_json::Value`).
  - `src-tauri/src/db/mongodb.rs` + `src-tauri/src/db/mongodb/schema.rs` — `MongoAdapter` 의 trait impl + `run_command_impl` 구현 (driver `Database::run_command`).
  - `src-tauri/src/db/testing.rs` — `StubDocumentAdapter::run_command_fn` 추가; trait stub.
  - `src-tauri/src/commands/document/query.rs` — `#[tauri::command] run_mongo_command(connection_id, database: Option<String>, command: bson::Document)` IPC.
  - `src-tauri/src/lib.rs` — `generate_handler!` 에 `run_mongo_command` 등록.

## Out of Scope

- AST parser (sprint-382 가 statement classifier 를 AST 로 promote).
- Connection schema migration — SQLite `connections.database NOT NULL` 유지. 빈 문자열을 "no database" 로 frontend 가 해석 (호환 우선).
- 새 admin command catalog 의 별도 UI (cheatsheet / palette) — 본 sprint 는 autocomplete dict 까지만.
- mongosh `db.getSiblingDB(...)` / 다른 cross-database helper.
- `db.runCommand` 호출 결과의 grid 통합 — 본 sprint 는 raw JSON response 반환 + 현 결과 패널이 받는 형태로 호환 (statement-kind 가 admin 일 때 dispatcher 가 JSON Quick Look 경로).

## Invariants

- Mongo `connection.database` 빈 문자열 허용. 다른 RDB (postgresql/mysql/sqlite) 는 required 유지.
- SQLite schema (`connections.database TEXT NOT NULL`) 미변경 — 빈 문자열로 round-trip.
- `db.runCommand({...})` / `db.adminCommand({...})` 매칭은 **정규식 1개** (`/^\s*db\.(runCommand|adminCommand)\s*\(/`) — 주석 / 다중 expression / 부분 매칭은 *naive* OK (sprint-382 의 AST 가 해결).
- 신규 IPC `run_mongo_command` 는 paradigm gate (`as_document()?`) 통과 — RDB 연결 시 `AppError::Unsupported`.
- `database = None` 시 backend 는 `client.database("admin")` 사용; `Some("myapp")` 시 `client.database("myapp")` 사용.
- Backend response 는 `serde_json::Value` (canonical EJSON via `bson::to_bson` → `bson::ser::to_value`).

## Acceptance Criteria

- `AC-381-01` Mongo connection 의 Save form: database 빈 문자열 입력 시 통과 (에러 없음). Test: `MongoFormFields` + `ConnectionDialog`.
- `AC-381-02` Postgres connection 의 Save form: database 빈 문자열 입력 시 "Database is required" 에러. Regression guard.
- `AC-381-03` TabDbChip: `database = ""` 시 라벨 = "(no database)". Test.
- `AC-381-04` Toolbar Run button: paradigm = document + sql = `db.runCommand({ping: 1})` + chip 미선택 (`tab.database = undefined`) → Run **enabled**. Test.
- `AC-381-05` Toolbar Run button: paradigm = document + sql = `db.users.find({})` + chip 미선택 → Run **disabled** + 에러 메시지 ("Select a target database…"). Test.
- `AC-381-06` useQueryExecution: sql = `db.runCommand({ping: 1})` + chip 미선택 → backend IPC `run_mongo_command` 호출 (`database` arg = `null`). 응답 JSON 을 query result 로 표시. Test.
- `AC-381-07` useQueryExecution: sql = `db.adminCommand({serverStatus: 1})` + chip = "myapp" → backend IPC `run_mongo_command` 호출 (`database` arg = `null` — adminCommand 는 항상 admin db). Test.
- `AC-381-08` useQueryExecution: sql = `db.runCommand({dbStats: 1})` + chip = "myapp" → backend IPC 호출 (`database` arg = `"myapp"`). Test.
- `AC-381-09` mongoAutocomplete: `db.r` 입력 시 candidate 에 `runCommand` 포함. Test.
- `AC-381-10` mongoAutocomplete: `db.runCommand({` 뒤 위치에서 candidate 에 admin command literal (`serverStatus`, `dbStats`, `ping`, …) 포함. Test.
- `AC-381-11` Backend `run_mongo_command_inner` 가 `database = None` 시 admin db 라우팅; `Some("myapp")` 시 해당 db 라우팅. Stub 어댑터 unit test 2.
- `AC-381-12` Backend `run_mongo_command_inner` 가 RDB connection 시 `AppError::Unsupported` 반환. Regression guard.
- `AC-381-13` Backend `run_mongo_command_inner` 가 미존재 connection 시 `AppError::NotFound` 반환. Regression guard.

## Design Bar / Quality Bar

- TDD vertical slice — RED 1 → GREEN 1 → 반복. 15 frontend RTL + 4 backend unit/integration.
- 정규식 기반 statement-kind judge: `/^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*db\.(runCommand|adminCommand)\s*\(/` — comment skipping 은 *간단한 prefix-strip* (sprint-382 AST 가 해결).
- 테스트 헤더: 모두 `2026-05-17` 작성일 + Sprint 381 + 작성 이유 코멘트.
- 신규 admin command dict 는 ~20 entries (가장 많이 쓰이는 admin/server diagnostics).

## Verification Plan

### Required Checks

1. `pnpm vitest run` — 신규 frontend test 15 case pass + 기존 4128+ regression.
2. `pnpm tsc --noEmit && pnpm lint`
3. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`
4. `cd src-tauri && cargo test --lib commands::document::query::tests::run_mongo_command` — 4 backend case pass.

### Required Evidence

- 15 frontend RTL 결과 + 테스트명.
- 4 backend unit case 결과.
- 신규 IPC `run_mongo_command` 가 `lib.rs` `generate_handler!` 에 등록됨.

## Test Requirements

- Vitest: 15+ RTL (form / chip / toolbar / dispatcher / autocomplete).
- Cargo: 4+ inner-function unit test (NotFound / Unsupported / database=None / database=Some).

## Test Script / Repro Script

1. `pnpm vitest run src/components/connection/forms/MongoFormFields src/components/connection/ConnectionDialog src/components/query/QueryTab/TabDbChip src/components/query/QueryTab/Toolbar src/components/query/QueryTab/useQueryExecution src/lib/mongo/mongoAutocomplete`
2. `cd src-tauri && cargo test --lib run_mongo_command`
3. `pnpm tsc --noEmit && pnpm lint`
4. `cd src-tauri && cargo fmt --check && cargo clippy --all-targets --all-features -- -D warnings`

## Ownership

- Generator: general-purpose Agent (이 sprint, sprint-build harness).
- Write scope: In Scope.
- Merge order: 독립 — sprint-380 (mongosh AST parser foundation) 과 함께 review.

## Exit Criteria

- Open P1/P2: 0
- AC 13/13 PASS
- pre-commit / pre-push hooks green
- PR open + linked to issue

## Hardening — Safe Mode 5-keyword whitelist (2026-05-18)

리뷰에서 *new* `runMongoCommand` dispatch path (`useQueryExecution.ts`) 가
`safeModeGate.decide` 호출 누락으로 다른 Mongo destructive write 와의
정책 동등성이 깨진다는 점이 드러났다. autocomplete (`mongoAutocomplete.ts`)
가 `drop` / `dropDatabase` / `dropIndexes` / `killOp` / `renameCollection`
를 1-click 추천하는데, dispatch 가 gate 를 거치지 않으면 Safe Mode 가
어떤 config 든 destructive admin command 가 우회 가능했다. AST 부재가
원인이 아니라 dispatch path 자체의 *gate 호출 코드 누락* 이라 본 sprint
의 책임 영역에서 봉합한다 (sprint-382 의 AST 와 무관).

### Added

- `src/lib/mongo/mongoSafety.ts` — `analyzeMongoRunCommand(body)` 함수 +
  `DESTRUCTIVE_RUN_COMMANDS` 5-key Set. body 의 first key 만 분류 (mongosh
  runCommand 의 convention: `{<command>: <arg>, ...options}`).
- `src/components/query/QueryTab/useQueryExecution.ts` — admin-command
  dispatch path 에 `safeModeGate.decide(analyzeMongoRunCommand(body))`
  호출 + `block` / `confirm` / `allow` 3-action 처리 (deleteMany /
  dropCollection / $out path 와 동일 패턴).

### Added — Acceptance Criteria

- AC-381-S1..S8 (8 unit) — classifier 가 5-keyword 만 danger 로 분류,
  read-only command (`ping` / `serverStatus` / `dbStats` / `currentOp`)
  은 info 로 통과. `{ping:1, drop:"x"}` 같은 second-key destructive 도
  info (first-key only convention).
- AC-381-S9..S11 (3 RTL) — strict + non-prod + `dropDatabase` → confirm
  (IPC 0, `pendingMongoConfirm` set, reason 포함 "dropDatabase"); warn +
  production + `drop` → confirm (IPC 0); warn + non-prod + `dropDatabase`
  → matrix-consistent allow (IPC 호출, no pending). dispatch 가 decide
  를 *호출* 하는지 lock — matrix 자체의 정책은 ADR 0022 관할.

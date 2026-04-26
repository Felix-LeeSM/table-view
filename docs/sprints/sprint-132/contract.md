# Sprint Contract: sprint-132

## Summary

- **Goal**: Raw-query DB-change 감지 + 검증. 신규 모듈 `src/lib/sqlDialectMutations.ts`가 토큰 기반 lexer로 PG `\c <db>` / `SET search_path TO <schema>`, MySQL `USE <db>`, Redis `SELECT <n>`을 추출. `QueryTab.executeQuery` 직후 lex 매치 → `connectionStore.setActiveDb` optimistic 업데이트 + `clearForConnection` (paradigm 분기) → 백엔드 cheap verify (`current_database()` PG / `db.runCommand({connectionStatus:1})` Mongo) → 불일치 시 `toast.warn` + `setActiveDb` 보정. 주석/문자열 안 매치 false positive 0.
- **Audience**: Claude Code Generator agent.
- **Owner**: harness orchestrator
- **Verification Profile**: `mixed` (vitest + tsc + lint + contrast + cargo test + clippy + e2e 정적)

## Background (이미 잡힌 사실)

- S130: PG sub-pool LRU 8 + `switchActiveDb` 통합 command + `connectionStore.setActiveDb`.
- S131: Mongo `MongoAdapter::switch_active_db` + Document arm 활성. `MongoAdapter::current_active_db()` accessor 존재.
- `PostgresAdapter`는 `(connection_id, db_name) → PgPool` sub-pool 보유. raw-query가 `\c another_db`를 실행해도 sub-pool은 그대로 → 사용자가 toolbar로 가서 manual switch 안 하면 사이드바/탭이 stale.
- 현재 `QueryTab.tsx:334`가 `executeQuery(connectionId, sql, queryId)` 호출 — 여기에 hook in.
- 기존 lexer/tokenizer 인프라:
  - `src/lib/sqlTokenize.ts` — SQL 토큰화.
  - `src/lib/sqlDialect.ts` — paradigm-specific dialect 정보.
  - `src/lib/queryAnalyzer.ts` — pgsql 분석.
- 사용자 시야: raw query 실행 후 사이드바 / DB switcher가 항상 backend의 active_db와 일치해야 함.

## In Scope

### 신규 모듈: `src/lib/sqlDialectMutations.ts`

- 토큰 기반 lexer. 입력은 `(sql: string, dialect: "postgres" | "mysql" | "redis")`. 출력은 다음 union:
  ```ts
  type DbMutationHint =
    | { kind: "switch_database"; dialect: "postgres" | "mysql"; targetDb: string }
    | { kind: "switch_schema"; dialect: "postgres"; targetSchema: string }
    | { kind: "redis_select"; databaseIndex: number }
    | null;
  ```
- 매치 규칙:
  - **PG `\c`** (psql meta-command): `^\s*\\c(?:onnect)?\s+([\w-]+)`. case-insensitive. `\c` 다음에 db name. quoted 가능 (`\c "my db"`). 결과 → `switch_database (postgres)`.
  - **PG `SET search_path TO ...`**: `^\s*set\s+search_path\s+to\s+([\w\-,\s"']+);?$`. 첫 번째 schema name만 추출. 결과 → `switch_schema (postgres)`.
  - **MySQL `USE <db>`**: `^\s*use\s+([\w-]+)\s*;?$`. case-insensitive. 결과 → `switch_database (mysql)`.
  - **Redis `SELECT <n>`**: `^\s*select\s+(\d+)\s*$`. 결과 → `redis_select`.
- **False positive 방지**:
  - 주석 안 매치 0: `--`, `/* ... */`, `#` (MySQL) 안의 토큰은 무시.
  - 문자열 안 매치 0: 작은따옴표, 큰따옴표, backtick 사이의 토큰은 무시.
  - `INSERT ... USE_THIS_FUNC()` 등 함수 호출 / identifier 일부는 매치 0.
  - 다중 statement 입력 시 마지막 매치만 반환 (or 모든 매치 배열 — 본 sprint는 마지막만).
- **단위 테스트** 최소 20개 — 각 dialect happy + 주석/문자열 false positive + 경계 (대소문자, 따옴표, 세미콜론, 공백, 다중 statement).

### `QueryTab.tsx`: 실행 후 lex hook

- `await executeQuery(...)` 직후 (성공 또는 에러 무관 — `\c` 같은 client-side 메타는 PG에서 파싱 에러 가능):
  1. `paradigm`이 rdb이면 dialect 추론 (`postgres` 가정 — 본 sprint는 PG만; MySQL/Redis는 dialect 자동 감지 hook 위치만 마련). dialect 결정 로직: `tab.connectionMeta?.databaseType` 활용 가능 — 없으면 `postgres` default.
  2. `extractDbMutation(stmt, dialect)` 호출.
  3. 결과가 `switch_database`이면:
     - **Optimistic**: `connectionStore.setActiveDb(connectionId, targetDb)`.
     - paradigm rdb → `schemaStore.clearForConnection(connectionId)`.
     - paradigm document → `documentStore.clearConnection(connectionId)`.
     - **Verify**: 신규 thin wrapper `verifyActiveDb(connectionId)` 호출.
       - rdb → backend `verify_active_db(connection_id)` Tauri command — 새로 추가 — adapter에서 `SELECT current_database()` 결과 반환.
       - document → `MongoAdapter::current_active_db()` 그대로 반환 (이미 메모리 — backend round-trip 없이 frontend에서 체크 가능하지만 일관성 위해 동일 command 사용).
     - 결과가 optimistic과 다르면 `toast.warn("Active DB mismatch: expected '<x>', got '<y>'. Reverting.")` + `setActiveDb(connectionId, actual)`.
  4. 결과가 `switch_schema`이면 schemaStore의 default schema 갱신 (현재 schema 추적 인프라가 없으면 — 있는 부분만; 없으면 toast.info만 + clearForConnection).
  5. 결과가 `redis_select`이면 본 sprint는 toast.info만 (Redis adapter Phase 9).

### 백엔드: verify_active_db Tauri command

- `src-tauri/src/commands/meta.rs`에 신규 command `verify_active_db(connection_id: String) -> Result<String, AppError>`:
  - `Rdb` → `adapter.execute_sql("SELECT current_database()", None)` → 첫 번째 row의 첫 번째 column 값.
    - 단, `RdbAdapter` trait에 `current_database()` 같은 cheap accessor 메서드 추가 검토 — 본 sprint는 raw SQL execution을 사용 (단순화).
  - `Document` → `adapter.current_active_db()` accessor 호출. None이면 빈 문자열 반환.
  - `Search/Kv` → `Err(AppError::Unsupported(...))`.
- `src-tauri/src/lib.rs`의 `tauri::generate_handler!`에 등록.

### 프런트: thin wrapper

- `src/lib/api/verifyActiveDb.ts` — `invoke<string>("verify_active_db", { connectionId })`.
- 단위 테스트 3+.

### 신규 method on RdbAdapter / DocumentAdapter (옵션)

- 본 sprint는 Tauri command가 직접 `adapter.execute_sql` 또는 `adapter.current_active_db` 호출. 신규 trait method 추가는 안 함 (단순화).

## Out of Scope

- 단축키 / 신규 e2e spec — S133.
- MySQL/SQLite/Redis adapter 구현 (Phase 9).
- DocumentDataGrid 시그니처 변경.
- `\c` 외 PG meta-command (`\d`, `\l` 등) 인식.
- Multi-statement에서 모든 매치 추출 (본 sprint는 마지막만).
- 사용자에게 "DB가 바뀌었음" UI badge — toast로 충분.

## Invariants

- 기존 vitest + cargo test 회귀 0.
- e2e 정적 컴파일 회귀 0.
- 사용자 시야 회귀 0:
  - raw query 정상 실행 (회귀 0).
  - DB-change 매치 없는 쿼리는 사이드바 캐시 무효화 0 (불필요한 fetch 0).
- false positive 0 (주석/문자열 안).
- false negative 최소화 (대소문자/공백/세미콜론 변형 모두 매치).
- aria-label 가이드 준수.
- credentials 재입력 없음.

## Acceptance Criteria

- `AC-01` 신규 모듈 `src/lib/sqlDialectMutations.ts` + `extractDbMutation(sql, dialect)` 함수.
- `AC-02` PG `\c <db>` / `SET search_path TO <schema>` / MySQL `USE <db>` / Redis `SELECT <n>` 토큰 기반 매치. 정규식 단순 매치는 OK이나 주석/문자열 마스킹 후 적용.
- `AC-03` 단위 테스트 20+: 각 dialect happy + 주석/문자열 안 false positive 0 + 경계 (대소문자, 따옴표, 세미콜론, 공백, 다중 statement, 빈 입력, null).
- `AC-04` `QueryTab.tsx`의 `executeQuery` 직후 hook — 매치 시 optimistic `setActiveDb` + paradigm 분기 store clear + verify round-trip + 불일치 시 toast.warn + revert.
- `AC-05` 신규 Tauri command `verify_active_db(connection_id)` 등록 + paradigm 분기:
  - Rdb → `current_database()` 쿼리 결과.
  - Document → `current_active_db()` accessor (또는 `""`).
  - Search/Kv → `Unsupported`.
- `AC-06` 프런트 thin wrapper `src/lib/api/verifyActiveDb.ts` + 3+ 단위 테스트.
- `AC-07` `QueryTab.tsx`의 hook 동작이 paradigm 분기를 정확히 함 (rdb → schemaStore, document → documentStore).
- `AC-08` `QueryTab.test.tsx`에 신규 시나리오:
  - PG `\c admin` 실행 → setActiveDb("admin") 호출 + verify pass (mock backend가 "admin" 반환) → toast 없음.
  - PG `\c admin` 실행 → setActiveDb("admin") 호출 + verify mismatch ("public" 반환) → toast.warn + setActiveDb("public") 보정.
  - DB-change 매치 없는 SELECT → setActiveDb 호출 0 + verify 호출 0.
  - 주석 안 `-- \c admin` → 매치 0 → 호출 0.
- `AC-09` 검증 명령 모두 그린:
  - `pnpm vitest run` (1986+ baseline + 본 sprint 신규)
  - `pnpm tsc --noEmit`
  - `pnpm lint`
  - `pnpm contrast:check`
  - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
  - `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
  - e2e 정적 컴파일 회귀 0.
- `AC-10` 사용자 시야: PG raw query `\c <db>` → 사이드바 schema 자동 재로딩 + DB switcher trigger label 갱신 (no manual click).

## Design Bar / Quality Bar

- 토큰 lexer는 단순함 우선 — comment masking → 정규식 매치 패턴. 완전한 SQL parser 도입 금지.
- false positive 0 / false negative 최소: edge case는 주석/문자열 마스킹으로 해결.
- 백엔드 verify는 cheap — `SELECT current_database()` 1회. 추가 사이드 이펙트 0.
- toast 메시지에 expected vs actual db_name 둘 다 노출.
- hook은 try/catch로 감싸 — verify 실패 시 query 결과 표시는 그대로 (verify 실패 ≠ query 실패).

## Verification Plan

### Required Checks

1. `pnpm vitest run`
2. `pnpm tsc --noEmit`
3. `pnpm lint`
4. `pnpm contrast:check`
5. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
6. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`
7. e2e 정적 컴파일 회귀 0.

### Required Evidence

- Generator must provide:
  - 변경된 파일 + 의도 한 줄
  - 7개 검증 명령 outcome
  - AC-01..AC-10 매핑(file:line / test:line)
  - extractDbMutation 핵심 로직 코드 인용
  - QueryTab hook 추가 코드 인용
  - verify_active_db Tauri command 코드 인용
- Evaluator must cite:
  - 각 AC pass/fail 구체 evidence
  - false positive 0 단위 테스트 (주석/문자열 안 매치 0)
  - QueryTab paradigm 분기 동작 RTL
  - PG / Mongo paradigm 회귀 0

## Test Requirements

### Unit Tests (필수)
- `src/lib/sqlDialectMutations.test.ts` — 20+:
  - PG `\c db_name`, `\connect db_name`, `\c "my db"`, 대소문자 변형
  - PG `SET search_path TO public`, multi-schema 추출 첫 번째만
  - MySQL `USE foo;`, `use FOO`, ` use foo `
  - Redis `SELECT 0`, `SELECT 15`
  - 주석 안 false positive 0: `-- \c admin`, `/* USE foo */`, `# USE bar` (MySQL)
  - 문자열 안 false positive 0: `SELECT 'use foo'`, `INSERT INTO t VALUES ('\\c admin')`
  - 빈 입력 → null
  - 다중 statement → 마지막 매치만
  - non-SQL 노이즈 (`SELECT 1; -- not a switch`) → null
- `src/lib/api/verifyActiveDb.test.ts` — happy / error / arg shape.
- `src/components/query/QueryTab.test.tsx` — 4+ 시나리오 (위 AC-08).
- `src-tauri/src/commands/meta.rs` — verify_active_db dispatch 테스트.

### Coverage Target
- 신규 모듈 (sqlDialectMutations + verifyActiveDb wrapper + QueryTab hook): 라인 80% 이상.

### Scenario Tests (필수)
- [ ] Happy: PG `\c admin` → 사이드바 자동 재로딩 + toolbar trigger label = "admin".
- [ ] Mismatch: lex가 `admin`을 추출했으나 backend가 `public` 반환 → toast.warn + revert.
- [ ] No-match: `SELECT 1` → setActiveDb 호출 0.
- [ ] False positive: `-- \c admin` → 매치 0.
- [ ] 회귀: Mongo paradigm raw query → 본 sprint hook 무시 (Mongo는 raw SQL 안 씀; document paradigm이면 hook skip).

## Test Script / Repro Script

1. `pnpm install`
2. `pnpm vitest run`
3. `pnpm tsc --noEmit`
4. `pnpm lint`
5. `pnpm contrast:check`
6. `cargo test --manifest-path src-tauri/Cargo.toml --lib`
7. `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings`

## Ownership

- Generator: harness general-purpose agent
- Write scope:
  - `src/lib/sqlDialectMutations.ts` + `.test.ts` (NEW)
  - `src/lib/api/verifyActiveDb.ts` + `.test.ts` (NEW)
  - `src/components/query/QueryTab.tsx` (executeQuery 직후 hook 추가)
  - `src/components/query/QueryTab.test.tsx`
  - `src-tauri/src/commands/meta.rs` (verify_active_db command + dispatch tests)
  - `src-tauri/src/lib.rs` (handler 등록)
  - **금지**: SchemaTree, DocumentDataGrid, 단축키, 신규 e2e, MySQL/Redis adapter 구현
- Merge order: 단일 commit `feat(query): raw-query DB-change detection + verify (sprint 132)`

## Exit Criteria

- Open P1/P2 findings: 0
- Required checks passing: yes
- Acceptance criteria evidence linked in `handoff.md`
- 기존 vitest + cargo test + e2e 정적 컴파일 회귀 0

# Query Language Support

기준일: 2026-05-25. 이 문서는 사용자가 에디터에서 쓰는 언어 표면을 정리한다.

중요한 구분:

- 실행은 각 DB 서버가 최종 판단한다. PostgreSQL/MySQL SQL은 가능한 한 원문을 서버에 보낸다.
- 자동완성과 Safe Mode 분석은 클라이언트가 이해하는 부분집합이다. 이 문서의 "지원/미지원 문법"은 주로 그 클라이언트 표면을 뜻한다.
- MongoDB는 임의 JavaScript를 실행하지 않는다. 지원되는 `db....` 표현식만 파싱해 IPC 명령으로 dispatch 한다.
- 자동완성 architecture decision은 ADR 0045가 source of truth다.
- "100% completion coverage"는 현재 UI가 surface 하는 vocabulary group을
  official reference 기준으로 빠짐없이 갖추는 것을 뜻한다. 서버 dialect 전체의
  의미론 검증이나 arbitrary script execution 100%를 뜻하지 않는다.
- 아래 3개 layer는 분리해서 판단한다.
  - **Vocabulary coverage**: 후보 label 목록이 Rust/WASM SOT에 존재하는가.
  - **Context routing**: cursor 위치에서 맞는 후보 group을 띄우는가.
  - **Semantic support**: client parser / Safe Mode / typed dispatch가 문법을
    구조적으로 이해하는가.

Sprint 430 기준 "100%"는 vocabulary coverage에만 쓰는 말이다. Context routing과
semantic support는 각 섹션의 제한/미지원 목록을 따른다.

## Query Language Ownership Registry

Sprint 479 기준 active query language는
`src/types/queryLanguage.ts`의 `QUERY_LANGUAGE_REGISTRY`가 소유권 matrix를
고정한다. `DataSourceProfile.languages`에 active profile이 참조하는 언어는
반드시 이 registry에서 `active` owner record를 가져야 한다.

| QueryLanguageId | Parser owner | Completion owner | Fallback policy | Safety analyzer | Syntax docs |
|---|---|---|---|---|---|
| `sql` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` from `rust-wasm-language-core` through `typescript-runtime-adapter`; TypeScript fallback mirrors are compatibility only, not source of truth | `rust-wasm-language-core` | `docs/query-language-support.md` |
| `mongosh` | `rust-wasm-language-core` | `rust-wasm-language-core` | `compatibility-mirror` from `rust-wasm-language-core` through `typescript-runtime-adapter`; TypeScript fallback mirrors are compatibility only, not source of truth | `rust-wasm-language-core` | `docs/query-language-support.md` |
| `redis-command` | `future-language-core-contract` | `future-language-core-contract` | `not-implemented`; no TypeScript source-of-truth fallback | `profile-safety-policy` | `docs/query-language-support.md` |
| `search-dsl` | `future-language-core-contract` | `future-language-core-contract` | `deferred`; fixture-backed only until live HTTP execution lands | `profile-safety-policy` | `docs/query-language-support.md` |

Deferred language ids (`cql`, `partiql`, `cypher`, `gql`, `gremlin`,
`vector-query`, `stream-command`) stay in the registry with
`future-language-core-contract` ownership so future active profiles cannot
silently introduce parser/completion vocabulary without an owner decision.

표기:

- ✅ 지원: 자동완성 또는 클라이언트 파서가 구조적으로 다룬다.
- ⚠️ 부분 지원: 실행은 가능하거나 후보는 뜨지만, 클라이언트 이해/검증이 제한된다.
- ❌ 미지원: 클라이언트가 의도적으로 제안/파싱/dispatch 하지 않는다.

## 자동완성 공통

| 표면 | PostgreSQL | MySQL | MariaDB | SQLite | DuckDB | MongoDB |
|---|---|---|---|---|---|---|
| 키워드 | ✅ CodeMirror + WASM | ✅ CodeMirror + WASM | ✅ MySQL family | ✅ CodeMirror + WASM | ✅ CodeMirror + WASM | 해당 없음 |
| 테이블/뷰/컬렉션 | ✅ schema store 기반 | ✅ database/table store 기반 | ✅ MySQL family | ✅ table/view store 기반 | ✅ table/view store 기반 | ✅ collectionNames 기반 |
| 컬럼/필드 | ✅ cache 기반 columns | ✅ cache 기반 columns | ✅ cache 기반 columns | ✅ cache 기반 columns | ✅ cache 기반 columns | ✅ sampled fieldNames 기반 |
| quoted identifier | ✅ `"schema"."table"` | ✅ `` `db`.`table` `` | ✅ `` `db`.`table` `` | ✅ `"table"` | ✅ `"schema"."table"` | 해당 없음 |
| alias column | ✅ simple alias scan | ✅ simple alias scan | ✅ simple alias scan | ✅ simple alias scan | ✅ simple alias scan | 해당 없음 |
| CTE/derived fallback | ✅ TS fallback | ✅ TS fallback | ✅ TS fallback | ✅ TS fallback | ✅ TS fallback | 해당 없음 |
| function candidates | ✅ Rust/WASM SOT + PostgreSQL | ✅ Rust/WASM SOT + MySQL | ✅ MySQL family | ✅ Rust/WASM SOT + SQLite | ✅ Rust/WASM SOT + DuckDB | 해당 없음 |
| shell/meta | ✅ Rust/WASM SOT `psql` commands | ✅ Rust/WASM SOT mysql client commands | ✅ mysql client commands | ✅ Rust/WASM SOT sqlite-cli commands | 없음 | 해당 없음 |
| operator candidates | SQL keyword/function surface | SQL keyword/function surface | SQL keyword/function surface | SQL keyword/function surface | SQL keyword/function surface | ✅ Rust/WASM SOT query/projection/update operators, stages, accumulators, expressions, BSON tags |

### Completion Coverage Matrix

| 영역 | 100% 의미 | 현재 gate |
|---|---|---|
| SQL keyword/function/shell vocabulary | current UI가 제안하는 PostgreSQL/MySQL/MariaDB/SQLite/DuckDB keyword/function/shell group이 Rust SOT에 있고 Sprint 429 smoke가 대표 token을 고정한다 | dialect/shell id. server version 세부 gate 없음 |
| SQL table/view/column/function catalog | 현재 connection cache에 들어온 object를 request catalog로 넘기고 WASM-first source가 제안한다 | catalog cache freshness와 active database/schema에 의존 |
| SQL parser/Safe Mode semantics | 아래 각 SQL 섹션의 지원 문법만 구조적으로 이해한다 | PostgreSQL/ANSI 중심 parser. MySQL/MariaDB/SQLite vendor syntax는 부분 지원 |
| Mongo operator/stage/expression/BSON vocabulary | query/projection/update/stage/accumulator/expression/type tag group이 Rust/WASM snapshot에 있고 TS fallback mirror와 drift test가 맞는다 | server version / Atlas-only / deployment capability gate 없음 |
| Mongo collection/db/admin methods | executable whitelist와 db/admin completion label이 Rust/WASM snapshot에 있다 | arbitrary JS, shell helpers, non-whitelisted methods 제외 |

## 자동완성 아키텍처 방향

현재 자동완성은 CodeMirror source와 client store cache 위에 구현되어 있다. 다음
단계의 기준 구조는 ADR 0045에 따라 아래처럼 고정한다.

```text
Tauri IPC
  -> catalog introspection
  -> client catalog store
  -> completion context builder
  -> Rust/WASM language core
  -> CodeMirror Completion[]
```

책임 분리:

- **IPC/Tauri**: DB 접속, catalog fetch, query execution, cancellation,
  active DB guard.
- **client store**: `(connId, db)` 또는 `(connId, database, collection)` 별
  catalog cache와 invalidation.
- **TS adapter**: 현재 tab, dialect profile, shell mode, catalog snapshot/slice
  를 completion request 로 정규화.
- **Rust/WASM language core**: tolerant parse, cursor context, provider
  dispatch, version/capability gate, candidate generation, built-in
  vocabulary ownership.

SQL dialect와 shell/meta command는 별도 layer다.

| Layer | 예시 | 비고 |
|---|---|---|
| SQL dialect | PostgreSQL, MySQL, MariaDB, SQLite, MSSQL, Oracle | keyword/function/type/operator/capability profile |
| Shell/meta | `psql`, `mysql` client, `sqlite3` CLI | `\dt`, `\G`, `.tables` 등. SQL keyword가 아님 |

초기 코드 SOT:

- `src/lib/sql/sqlDialectProfile.ts` — SQL dialect profile, shell profile,
  keyword/function vocabulary, capability flags.
- `src/lib/sql/sqlCompletionContext.ts` — schema store cache를 Rust/WASM
  completion request 에 넘길 flat catalog context 로 정규화하는 adapter.
- `src/lib/sql/sqlHybridCompletionSource.ts` — CodeMirror popup 의 WASM-first
  source. WASM 후보가 없으면 기존 TypeScript source set으로 fallback.
- `src/lib/sql/sqlDialect.ts` — CodeMirror dialect mapping wrapper.
- `src/lib/sql/sqlDialectKeywords.ts` — legacy import compatibility wrapper.
- `src-tauri/sql-parser-core/src/completion/vocabulary.rs` — SQL
  keyword/function/shell built-in vocabulary SOT.
- `src-tauri/mongosh-parser-core/src/completion.rs` — Mongo MQL/mongosh/admin
  completion vocabulary SOT.
- `src/lib/mongo/mongoCompletionVocabulary.ts`,
  `src/lib/mongo/mongoShellCompletionVocabulary.ts` — WASM load 전 fallback
  mirror 와 CodeMirror metadata adapter.
- `src/lib/mongo/mongoCompletionVocabulary.test.ts` — Rust/WASM vocabulary 와
  TypeScript fallback mirror drift test.

장기 구현 규칙:

- completion hot path는 IPC를 타지 않는다. IPC는 background catalog fetch에만
  사용한다.
- WASM request에는 `text`, cursor offset 정책, dialect, shell,
  `serverVersion`, normalized catalog slice를 명시한다.
- built-in keyword/function/operator/shell vocabulary 는 Rust/WASM core 가
  소유한다. TypeScript 에 남은 상수는 WASM load 전 fallback mirror 이다.
- Extension/plugin/module vocabulary 는 detected capability pack 으로만
  활성화한다. DB catalog 가 installed extension/module/plugin 을 보고하면
  알려진 pack 의 function/type/operator/snippet 후보를 추가하고, 알 수 없는
  capability 는 "detected, no completion pack" 상태로만 노출한다. 설치되지 않은
  extension 후보는 제안하지 않는다.
- Rust/WASM vocabulary 와 TypeScript fallback mirror 는 Sprint 429
  official-reference drift tests 로 고정한다.
- `serverVersion` 과 `capabilities` 는 contract surface에 있지만 Sprint 430
  기준 built-in vocabulary 후보를 세밀하게 filter하지 않는다. 오래된 서버나
  deployment가 특정 함수/stage를 거부할 수 있다.
- psql/mysql/sqlite shell command는 SQL parser grammar에 섞지 않는다.
- 큰 catalog는 매 키 입력마다 통째로 직렬화하지 않고 active scope와 prefix
  기반 slice로 축소한다.
- 기존 CodeMirror/lang-sql/TS completion은 WASM source의 fallback 으로 유지한다.

## PostgreSQL SQL

### 자동완성

✅ 지원:

- 공통 함수: `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `COALESCE`, `NULLIF`, `CAST`, `CONCAT`, `LENGTH`, `UPPER`, `LOWER`, `TRIM`, `SUBSTRING`, `EXTRACT`, `NOW`, `CURRENT_TIMESTAMP`.
- PostgreSQL 함수 후보: `DATE_TRUNC`, `TO_CHAR`, `TO_TIMESTAMP`, `JSONB_BUILD_OBJECT`, `JSONB_AGG`, `ARRAY_AGG`.
- PostgreSQL 키워드 후보: `RETURNING`, `ILIKE`, `SERIAL`, `BIGSERIAL`, `JSONB`, `EXCLUDED`, `ON CONFLICT`, `MATERIALIZED VIEW`.
- schema-qualified / fully-quoted table path와 cached columns.
- `UPDATE ... SET`, `INSERT INTO ... (...)`, `DELETE FROM ... WHERE`, 단순 `SELECT ... FROM`의 column 후보.

⚠️ 제한:

- alias/CTE completion은 editor buffer를 스캔하는 보강 source다. SQL 의미 분석기가 아니므로 복잡한 nested scope, 같은 alias shadowing, 동적 SQL은 완전 보장하지 않는다.
- 함수 후보는 편의 surface다. 모든 PostgreSQL built-in function을 열거하지 않는다.

### 클라이언트 SQL 파서 / Safe Mode

✅ 지원:

- `SELECT ... FROM ...`: projection, table/schema qualifiers, alias, comma join, `INNER/LEFT/RIGHT/FULL/CROSS JOIN`, `ON`, `USING`.
- no-FROM read-only projection SELECT: `SELECT 1`, `SELECT now()`.
- `WHERE` / `HAVING`: comparison, column comparison, `BETWEEN`, `LIKE`, `ILIKE`, `IN (...)`, `IN (SELECT ...)`, `EXISTS`, scalar subquery, `IS NULL`, boolean `AND`/`OR`/`NOT`.
- `GROUP BY`, `ORDER BY`, `LIMIT ... OFFSET ...`.
- set operations: `UNION`, `UNION ALL`, `INTERSECT`, `EXCEPT`.
- expressions: literals, column refs, simple unqualified function calls in
  SELECT-list position and as predicate comparison left-hand expressions,
  `CASE`, window functions with `OVER`, scalar subqueries.
- CTE: `WITH [RECURSIVE] cte AS (...)` wrapping `SELECT` / `INSERT` / `UPDATE` / `DELETE`; CTE body는 `SELECT`.
- DML: `INSERT INTO ... VALUES`, `DEFAULT VALUES`, `INSERT ... SELECT`, PostgreSQL `ON CONFLICT`, `RETURNING`, `UPDATE ... SET ... FROM ... WHERE ... RETURNING`, `DELETE ... USING ... WHERE ... RETURNING`.
- DDL subset: `CREATE TABLE`, `CREATE INDEX`, `CREATE VIEW`, `DROP TABLE/DATABASE/INDEX/VIEW/SCHEMA/SEQUENCE/TYPE`, `TRUNCATE`, `ALTER TABLE ADD/DROP/RENAME COLUMN`, `ADD/DROP CONSTRAINT`, `DROP INDEX`, `RENAME TABLE`.
- misc: `GRANT`, `REVOKE`, `EXPLAIN`, `SHOW`, `SET`, `COPY`, `COMMENT`.

⚠️ 부분 지원:

- schema-qualified functions, nested function arguments, function-call `LIKE`
  predicates, `DISTINCT`, and arbitrary arithmetic/string expression arguments
  are still out of scope.
- parser가 거부해도 서버 실행 자체가 항상 불가능하다는 뜻은 아니다. Safe Mode는 거부 시 기존 heuristic으로 fallback할 수 있다.

❌ 미지원:

- stored procedure/function body 문법, PL/pgSQL block, `DO $$ ... $$`.
- `MERGE`.
- 임의 vendor extension 전체. 지원 목록 밖은 `unsupported-statement`, `syntax-error`, 또는 `unsupported-expression`으로 떨어진다.

## MySQL SQL

### 자동완성

✅ 지원:

- 공통 SQL 함수 후보는 PostgreSQL과 동일.
- MySQL 전용 함수 후보: `IFNULL`, `DATE_FORMAT`, `STR_TO_DATE`, `CURDATE`, `CURTIME`, `UTC_TIMESTAMP`, `GROUP_CONCAT`, `JSON_EXTRACT`, `JSON_UNQUOTE`, `JSON_OBJECT`, `JSON_ARRAY`, `JSON_TABLE`, `JSON_VALUE`, `REGEXP_LIKE`, `REGEXP_REPLACE`, `UUID`, `UUID_TO_BIN`, `BIN_TO_UUID`, `LAST_INSERT_ID`, `DATABASE`, `VERSION`.
- MySQL 키워드 후보: `SHOW`, `DESCRIBE`, `USE`, `AUTO_INCREMENT`, `REPLACE INTO`, `DUAL`, `ENGINE`, `ON DUPLICATE KEY UPDATE`, `DUPLICATE KEY UPDATE`.
- backtick alias: `` `table` ``, fully-qualified `` `db`.`table` ``.
- PostgreSQL-only 후보(`DATE_TRUNC`, `TO_CHAR`, `JSONB_BUILD_OBJECT` 등)는 `dbType: "mysql"`에서 제외된다.

⚠️ 제한:

- 함수 후보는 Rust/WASM SOT 의 MySQL built-in vocabulary 에서 온다. SQL 실행
  가능 여부는 서버 version/capability 가 최종 판단한다.
- SQL alias/CTE/column completion source는 PostgreSQL과 공유한다. MySQL-specific parser가 아니라 editor-level SQL source다.
- mysql-client shell command 후보는 vocabulary/discovery 전용이다. Runtime
  execution support를 뜻하지 않으며, `DELIMITER` 같은 client directive는 아래
  scripting boundary에서 명시적으로 거부된다.

### 실행 / adapter surface

✅ 지원:

- 연결, ping, cancel query.
- database list / switch database / current database.
- table, column, index, constraint, view, function, trigger read path.
- free-form SQL execution: `SELECT`, `WITH`, `SHOW`, `EXPLAIN`, `DESCRIBE/DESC`는 result grid, `INSERT/UPDATE/DELETE/REPLACE`는 DML rows affected, 그 외는 DDL로 처리.
- table paging, filters, raw where, order by, default primary-key ordering, streaming rows.
- MySQL DDL UI backend: table/column/index/constraint create/drop/rename/alter family.

⚠️ 제한:

- MySQL DDL은 implicit commit이 있다. batch/dry-run transaction wrapper가 DDL rollback을 완전 보장하지 않는다.
- `DROP TABLE ... CASCADE`, `DROP COLUMN ... CASCADE` 같은 PostgreSQL-style option은 MySQL emission에서 무시된다.
- trigger write는 PG request shape과 MySQL inline body model이 달라 create/drop은 미지원이고 read-only만 지원한다.
- `DELIMITER`와 `LOAD DATA`는 query editor 및 backend RDB command boundary에서
  `Unsupported`로 거부된다. `DELIMITER`는 mysql-client directive라 서버 SQL로
  정규화하지 않고, `LOAD DATA`는 명시적 file-import confirmation UX가 없으므로
  실행하지 않는다.

### 클라이언트 SQL 파서 / Safe Mode

현재 SQL parser는 PostgreSQL/ANSI 중심의 공통 parser다. MySQL 실행은 서버에 맡기지만, Safe Mode 분류와 일부 editor 분석은 아래 부분집합만 구조적으로 이해한다. parser 자체는 dialect gate를 갖지 않으므로, 아래 MySQL/MariaDB 동기 문법도 client parser가 호출되는 곳에서는 공통 parser behavior로 인식된다.

✅ 지원:

- PostgreSQL SQL 섹션의 공통 SELECT/DML/DDL subset 대부분.
- MySQL/MariaDB legacy pagination: `LIMIT offset, count` 와
  `LIMIT count OFFSET offset`.
- MySQL/MariaDB upsert: `INSERT ... ON DUPLICATE KEY UPDATE` with
  comma-separated assignments. RHS values supported by the client parser are
  literals, `DEFAULT`, placeholders (`?`, `$1`, `:name`), and
  `VALUES(column)`.
- MySQL/MariaDB 동기로 추가된 common parser procedure call dispatch:
  `CALL proc()` and `CALL schema.proc(?, 'x', 1, @user_id)`. Argument values
  supported by the client parser are literals, `DEFAULT`, placeholders (`?`,
  `$1`, `:name`), and bounded MySQL-family user variables (`@name`); server
  execution remains the final judge for routine signature and argument
  validity.
- MySQL identifier quoting은 autocomplete/editor path에서 backtick으로 처리.

⚠️ 부분 지원:

- `SHOW`, `SET`, `EXPLAIN` 등은 공통 misc grammar로 일부 파싱된다.
- MySQL DB switch는 별도 mutation detector가 `USE <db>`를 감지해 active DB hint를 갱신한다. SQL AST 본체의 일반 DDL/DML grammar와는 별도다.
- `ON DUPLICATE KEY UPDATE` RHS expression grammar is intentionally narrow:
  arithmetic, function calls, subqueries, and arbitrary identifiers on the RHS
  still fall back to unsupported/syntax handling.
- `CALL` argument grammar is intentionally narrow: arithmetic, function calls,
  subqueries, bare identifiers, system variables (`@@name`), quoted user
  variables, and OUT/INOUT parameter semantics are not modeled by the client
  parser.
- Safe Mode classifies `CALL` as `routine-call` / `warn` because stored routine
  side effects are opaque to the client parser.

❌ 미지원:

- stored procedure/function/event body, `LOCK/UNLOCK TABLES`, transaction/control-flow scripting.
- `DELIMITER` mysql-client directive and `LOAD DATA` file import execution:
  explicitly unsupported at runtime; they are not sent to the server as
  ordinary SQL.
- MySQL dialect 전체를 의미론적으로 validate하는 기능. 서버가 받을 수 있는 SQL이라도 client parser는 모를 수 있다.

## MariaDB SQL

### 자동완성

✅ 지원:

- MySQL family profile을 공유한다. keyword/function/shell 후보는
  `dialect: "mariadb"`에서 Rust/WASM SOT의 MySQL family vocabulary를 사용한다.
- MySQL 섹션의 공통 함수, JSON/regexp/UUID 함수 후보, `SHOW`/`DESCRIBE`/`USE`,
  `ON DUPLICATE KEY UPDATE`, mysql-client shell command 후보를 제안한다.
- MariaDB-only delta: `RETURNING` is proposed for MariaDB because MariaDB
  supports `INSERT ... RETURNING`, `DELETE ... RETURNING`, and
  `REPLACE ... RETURNING`; MySQL keeps `RETURNING` out of its keyword/profile
  surface.
- backtick identifier와 database-qualified table path를 MySQL과 동일하게 다룬다.

⚠️ 제한:

- MariaDB-only 함수/문법 delta는 `RETURNING` 외에는 아직 별도 vocabulary group으로 분리하지 않았다.
- server version / storage engine / SQL mode별 후보 filtering은 없다.

### 실행 / adapter surface

✅ 지원:

- MySQL adapter의 `new_mariadb()` kind를 사용한다. 연결, ping, cancel, database
  list/switch, catalog read, table grid, free-form SQL, batch/dry-run, DDL UI
  backend는 MySQL path와 같은 구조다.

⚠️ 제한:

- MySQL과 MariaDB의 문법 divergence는 서버 실행 결과가 최종 판단한다.
- 현재 자동화 fixture는 MySQL adapter path 중심이다. MariaDB-engine integration
  fixture gap은 `RISK-043`에서 추적한다.
- trigger create/drop은 MySQL과 동일하게 unsupported다.
- `DELIMITER` / `LOAD DATA` runtime boundary도 MySQL과 동일하게 `Unsupported`
  거부다.

### 클라이언트 SQL 파서 / Safe Mode

현재 parser 의미 지원은 MySQL 섹션과 대부분 같다. `LIMIT offset, count`,
`ON DUPLICATE KEY UPDATE`, narrow `CALL proc(...)`는 MySQL-family client
parser subset에 포함된다. `RETURNING` clause parsing은 공통 DML AST가 이미
처리하며, MariaDB profile/completion surface만 MySQL과 분리한다.

❌ 미지원:

- MariaDB-specific stored routine/event/sequence/package syntax.
- `RETURNING`의 statement별/version별 세분화 gate. 현재 profile은 MariaDB
  dialect에서 keyword/capability를 노출하고 서버 실행 결과가 최종 판단한다.
- SQL mode별 quoting/escape 차이의 완전 반영.

## SQLite SQL

### 자동완성

✅ 지원:

- Rust/WASM SOT keyword/function 후보: `PRAGMA`, `WITHOUT ROWID`,
  `AUTOINCREMENT`, `INSERT OR IGNORE`, `INSERT OR REPLACE`, `STRFTIME`,
  `JULIANDAY`, `JSON_EXTRACT`, `JSON_OBJECT`, `TYPEOF` 등.
- sqlite-cli dot command 후보: `.tables`, `.schema`, `.mode`, `.headers`,
  `.recover`, `.expert` 등.
- cached table/view/column 후보와 double-quoted identifier path.

⚠️ 제한:

- SQLite compile option / extension / JSON1 availability 별 후보 filtering은 없다.
- sqlite-cli dot command는 completion 후보일 뿐 query execution path에서 shell
  command로 실행하지 않는다.

### 실행 / adapter surface

✅ 지원:

- SQLite file connection lifecycle, explicit file creation, baseline catalog
  reads, table preview/grid, single-statement query execution, batch execution,
  dry-run, paging/filter/raw-where 일부.
- Writable SQLite files support scoped row edits from table/query grids when
  the row identity is primary-key based. Read-only SQLite connections keep row
  editing disabled and runtime write attempts are rejected explicitly.

⚠️ 제한:

- SQLite adapter의 DDL write UI/runtime family는 아직 명시적 unsupported다:
  table create/drop/rename/alter, column add/drop, index create/drop,
  constraint add/drop.
- function source introspection은 unsupported다.

### 클라이언트 SQL 파서 / Safe Mode

✅ 지원:

- PostgreSQL/ANSI 중심 공통 parser subset.

⚠️ 부분 지원:

- `PRAGMA`, `VACUUM`, `INSERT OR IGNORE/REPLACE`, `WITHOUT ROWID` 같은 SQLite
  후보는 completion vocabulary에 있지만 모두 client parser semantic support를
  뜻하지는 않는다.
- SQLite execution은 서버(sqlite engine)가 최종 판단한다. parser가 SQLite의
  전체 expression grammar나 virtual table/module syntax를 의미론적으로
  validate하지 않는다.

❌ 미지원:

- sqlite-cli dot command 실행.
- `CREATE VIRTUAL TABLE`, FTS/RTREE module syntax, trigger body, recursive
  trigger semantics, extension-specific functions의 semantic validation.

## DuckDB SQL

### 자동완성

✅ 지원:

- Rust/WASM SOT keyword/function 후보와 DuckDB dialect profile을 사용한다.
- cached schema/table/view/column 후보와 double-quoted identifier path.
- CSV/Parquet/JSON/NDJSON analytics input은 SQL dialect가 아니라 DuckDB file
  connection capability에서 노출된다.

⚠️ 제한:

- DuckDB extension별 function/table-function 후보 filtering은 없다.
- shell/meta command layer는 없다.

### 실행 / adapter surface

✅ 지원:

- DuckDB file connection lifecycle, baseline catalog reads, table preview/grid,
  single-statement query execution.
- local file analytics preview/query for CSV, Parquet, JSON, and NDJSON.
  등록된 file source는 opaque id로만 노출되며 사용자 SQL 실행 전에 외부 파일 접근
  함수는 guardrail로 막는다.

⚠️ 제한:

- DDL UI/runtime family와 row edit/write parity는 unsupported다.
- file analytics preview는 history/favorites/import workflow로 승격하지 않았다.
- cloud/object-store access와 arbitrary external file reads는 scope 밖이다.

### 클라이언트 SQL 파서 / Safe Mode

✅ 지원:

- PostgreSQL/ANSI 중심 공통 parser subset.

⚠️ 부분 지원:

- DuckDB execution은 DuckDB engine이 최종 판단한다. client parser가 DuckDB의
  전체 table function, macro, extension grammar를 의미론적으로 validate하지 않는다.

❌ 미지원:

- DuckDB shell command 실행.
- `read_csv`, `read_parquet`, `glob`, metadata scan 같은 외부 파일 접근 함수의
  사용자 SQL 직접 호출.

## MongoDB Mongosh / MQL

### 자동완성

✅ 지원:

- `db.` 뒤 collection names.
- `db.<collection>.` 뒤 collection method 후보: `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `createIndex`, `dropIndex`, `bulkWrite`.
- db-level method 후보: `runCommand`, `adminCommand`, `getCollection`, `getCollectionNames`, `getCollectionInfos`, `getProfilingStatus`, `setProfilingLevel`.
- query/projection/update operator 후보는 Rust/WASM vocabulary snapshot 에서 온다. 예: `$jsonSchema`, `$bitsAllSet`, `$elemMatch`, `$setOnInsert`, `$[]`.
- aggregation stage 후보는 Rust/WASM vocabulary snapshot 에서 온다. 예: `$vectorSearch`, `$search`, `$setWindowFields`, `$lookup`, `$merge`, `$queryStats`.
- accumulator / expression operator 후보는 Rust/WASM vocabulary snapshot 에서 온다. 예: `$topN`, `$median`, `$dateTrunc`, `$toObjectId`, `$regexMatch`.
- BSON extended JSON tags: `$oid`, `$date`, `$numberLong`, `$numberDouble`, `$numberInt`, `$numberDecimal`, `$binary`, `$regularExpression`, `$timestamp`, `$minKey`, `$maxKey`, `$symbol`, `$code`, `$uuid`.
- `db.runCommand({` / `db.adminCommand({` 첫 key 위치에서 admin command literal 후보.

⚠️ 제한:

- MongoDB는 schemaless라 field completion은 sampled/cache된 fieldNames 기반이다. 컬렉션의 모든 possible field를 보장하지 않는다.
- operator 후보는 official-reference vocabulary group 기준으로 넓혔지만,
  server version / Atlas-only stage / deployment capability 는 아직 후보 단계에서
  세밀하게 gate 하지 않는다.

### 실행 parser / dispatch

✅ 지원:

- `db.runCommand({...})`, `db.adminCommand({...})`.
- collection commands dispatched by the typed parser: `find`, `findOne`, `aggregate`, `countDocuments`, `estimatedDocumentCount`, `distinct`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `replaceOne`, `deleteOne`, `deleteMany`, `createIndex`, `dropIndex`, `bulkWrite`.
- cursor chain for `find` / `aggregate`: `.sort(...)`, `.limit(...)`, `.skip(...)`, `.toArray()`.
- JSON-like values: object, array, string, number, boolean, null, comments.
- BSON literals in collection dispatch: `ObjectId(...)`, `ISODate(...)`, `UUID(...)`, `NumberLong(...)`, `NumberDecimal(...)`, `BinData(...)`.
- BSON literals in the WASM admin/body parser: `ObjectId(...)`, `ISODate(...)`, `UUID(...)`, `NumberLong(...)`, `Decimal128(...)`; `BinData(...)` and `NumberDecimal(...)` are recognized names but rejected in that branch.
- admin command safe-mode analysis for destructive command keys such as `drop`, `dropDatabase`, `dropIndexes`, `killOp`, `renameCollection`.
- Sprint 476 support claim: the tested workflows cover connection, catalog
  browse/schema/index reads, the whitelisted collection/admin dispatch surface,
  document result projection into the shared grid without RDBMS editability
  wording, document edit/bulk-write dispatch, and destructive safe-mode gates.

⚠️ 부분 지원:

- There are two parser surfaces in current code: the WASM statement classifier recognizes admin vs collection statements for toolbar/database gating, while the collection dispatch path still applies a TypeScript dispatch whitelist. Autocomplete collection methods are covered by that executable whitelist.
- `createIndex` supports the app's typed index request surface: ascending/descending key specs plus `name`, `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, and `collation`.
- `db.runCommand` / `db.adminCommand` accepts JSON-shaped command bodies with BSON placeholders, but not arbitrary JavaScript expressions.

❌ 미지원:

- arbitrary JavaScript: `eval`, callbacks, arrow functions, variables, declarations, loops, conditionals, classes, functions.
- shell helpers: `use`, `show`.
- bare collection access: `users.find({})`; must start with `db.`.
- cross-db navigation: `db.getSiblingDB(...)`.
- multiple statements separated by semicolon.
- unsupported cursor methods such as `.forEach()`, `.map()`, `.pretty()`.
- arbitrary mongosh helper methods outside the dispatch whitelist.

## Coverage 판단

Sprint 430 기준 Phase 31의 completion architecture 목표는 닫혔다. 현재 상태:

- PostgreSQL: completion + parser/Safe Mode 모두 가장 강한 surface.
- MySQL: completion vocabulary는 current UI group 기준 100%; runtime adapter는
  넓음; client parser semantics는 PostgreSQL/ANSI 중심 subset과
  `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, `@name` routine arguments를
  포함한 narrow `CALL proc(...)`를 포함한다.
- MariaDB: MySQL family completion/runtime path 공유; client parser semantics는
  MySQL-family `LIMIT offset, count`, `ON DUPLICATE KEY UPDATE`, `@name`
  routine arguments를 포함한 narrow `CALL proc(...)`를 포함한다. Sprint 451
  기준 MariaDB-only visible delta는 `RETURNING` keyword/profile exposure이며
  세부 version gate와 더 넓은 MariaDB-only syntax는 후속.
- SQLite: completion vocabulary는 current UI group 기준 100%; runtime adapter는
  read/query plus writable-file, primary-key-scoped row edits; DDL write
  backend/runtime support는 후속.
- MongoDB: Rust-owned vocabulary는 current UI group 기준 100%; execution은
  whitelisted mongosh workflow만 지원. Sprint 476 이후 public support claim은
  connection/catalog/query/result/edit/safety tests가 있는 whitelist 범위로
  제한한다.

다음이 남아 있다:

- SQL semantic widening: MySQL/MariaDB stored routine body parser,
  transaction/control-flow scripting, broader `CALL` argument expressions
  beyond literals/`DEFAULT`/placeholders/`@name` and OUT/INOUT semantics, plus
  broader `ON DUPLICATE KEY UPDATE` RHS expressions beyond literals/
  placeholders/`VALUES(column)`. `DELIMITER` and `LOAD DATA` are no longer
  silent parser gaps: current runtime behavior is explicit unsupported
  rejection.
- SQLite write parity: DDL UI/backend runtime, function source introspection,
  virtual table grammar.
- Version/capability gates: SQL server version, MariaDB delta, SQLite compile
  options/extensions, MongoDB server version/Atlas-only/deployment capability.
- Mongo completion hardening: server-version/Atlas-only stage gating and
  parser/dispatch semantic widening. Vocabulary list 자체는 Rust/WASM SOT 로
  이동했다.
- Mongo document result rendering: shared grid compatibility remains, but native
  document-first result panels and richer raw document inspection remain follow-up.
- Extension-aware completion packs: PostgreSQL starts with `pgcrypto`,
  `uuid-ossp`, `postgis`, `pgvector`, `citext`, `hstore`, and `pg_trgm`;
  later DBMS lanes use the same detected-pack rule for SQLite/DuckDB extensions,
  Redis modules, and Search plugins.

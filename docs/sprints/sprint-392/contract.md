# Sprint Contract: sprint-392

## Summary

- Goal: **SQL DML write triad — INSERT / UPDATE / DELETE** — extend the
  sprint-385/391 grammar with the *write-side* DML surface (every variant +
  every option combination commonly used in PG/MySQL/SQLite) and migrate
  `src/lib/sql/sqlSafety.ts` 의 `dml-insert` / `dml-update` / `dml-delete`
  분류 callsite를 정규식에서 AST 기반(`parseSqlPreloaded`)으로 교체한다.
- Audience: 후속 sprint (393 SELECT widening, 394 DDL additive, 395 misc).
  본 sprint 의 `parseSqlPreloaded` 호출 패턴이 회귀-안전 fallback 의 모범.
- Owner: Generator (sprint-392).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint) +
  `backend` (`cargo test`, `cargo clippy --all-targets --all-features -D warnings`,
  `cargo build --target wasm32-unknown-unknown --release --features wasm`).

## Background

- sprint-385 = SELECT narrow slice; sprint-391 = DDL destructive (DROP /
  TRUNCATE / ALTER … DROP). sprint-391 머지 후 *DDL destructive* 만 AST 분류.
- `analyzeStatement` 의 잔여 정규식: INSERT / UPDATE / DELETE / SELECT-write
  (CTE 가 wrap 하는 DML) / CREATE / GRANT / REVOKE / EXPLAIN / SHOW / DESCRIBE.
- 본 sprint 는 *write triad* (INSERT/UPDATE/DELETE) 만. SELECT widening 은 393.
- safety severity:
  - `dml-insert` — `info` (additive, 비-destructive)
  - `dml-update` — `danger` (existing rows mutate)
  - `dml-delete` — `danger` (row removal)
  - `dml-update WHERE 절 없음` — `danger` + extra reason ("WHERE 없는 UPDATE 전체 영향")
  - `dml-delete WHERE 절 없음` — `danger` + extra reason ("WHERE 없는 DELETE 전체 영향")

## In Scope

### Rust crate — grammar additions

**1. Lexer (`src-tauri/sql-parser-core/src/lexer.rs`)** — 새 keyword token:

- `INSERT`, `INTO`, `VALUES`, `DEFAULT`, `RETURNING`
- `UPDATE`, `SET`, `FROM` (이미 sprint-385 에서 있음 — 재사용)
- `DELETE`, `USING`
- `ON`, `CONFLICT`, `DO`, `NOTHING` (UPSERT — PG)
- `WHERE`, `AND`, `OR`, `NOT`, `NULL`, `IS`, `IN` (이미 SELECT 에서 일부 있음 — 재사용 확인)
- `WITH` (DML-CTE; SELECT-CTE 는 393b)

모두 case-insensitive — 기존 패턴.

**2. AST (`src-tauri/sql-parser-core/src/ast.rs`)** — 새 `ParseResult` variant:

```rust
pub enum ParseResult {
    Select(SelectStatement),
    Drop(DropStatement),
    Truncate(TruncateStatement),
    AlterTable(AlterTableStatement),
    Insert(InsertStatement),    // NEW
    Update(UpdateStatement),    // NEW
    Delete(DeleteStatement),    // NEW
    Error(ParseError),
}

pub struct InsertStatement {
    pub table: String,
    pub columns: Vec<String>,           // empty = unspecified (DEFAULT VALUES or all-column)
    pub source: InsertSource,
    pub on_conflict: Option<OnConflict>, // PG UPSERT
    pub returning: Vec<String>,         // PG RETURNING; empty = none
}

pub enum InsertSource {
    Values(Vec<Vec<InsertValue>>),     // VALUES (...), (...)
    DefaultValues,                      // INSERT … DEFAULT VALUES
    Select(Box<SelectStatement>),       // INSERT … SELECT … (sprint-385 narrow SELECT 만 우선 지원)
}

pub enum InsertValue {
    Literal(SqlLiteral),                // 숫자 / 문자열 / NULL / boolean
    Default,                            // DEFAULT keyword
    Placeholder(String),                // $1, ?, :name
}

pub enum SqlLiteral {
    Integer(i64),
    Float(f64),
    String(String),
    Boolean(bool),
    Null,
}

pub enum OnConflict {
    DoNothing,
    DoUpdate { set: Vec<UpdateAssignment>, where_clause: Option<WhereExpr> },
}

pub struct UpdateStatement {
    pub table: String,
    pub assignments: Vec<UpdateAssignment>,
    pub from: Vec<String>,              // PG UPDATE … FROM other_table; empty if absent
    pub where_clause: Option<WhereExpr>,
    pub returning: Vec<String>,
}

pub struct UpdateAssignment {
    pub column: String,
    pub value: InsertValue,             // 동일 enum 재사용
}

pub struct DeleteStatement {
    pub table: String,
    pub using: Vec<String>,             // PG DELETE … USING
    pub where_clause: Option<WhereExpr>,
    pub returning: Vec<String>,
}
```

`WhereExpr` (간이) — sprint-393 의 full expression 이 아닌 본 sprint *최소*:

```rust
pub enum WhereExpr {
    Comparison { column: String, op: CompareOp, value: InsertValue },
    And(Box<WhereExpr>, Box<WhereExpr>),
    Or(Box<WhereExpr>, Box<WhereExpr>),
    Not(Box<WhereExpr>),
    IsNull(String),
    IsNotNull(String),
}

pub enum CompareOp { Eq, Ne, Lt, Le, Gt, Ge }
```

- WHERE 의 *complex expression* (subquery / function call / arithmetic) 은
  sprint-393 의 일부. 본 sprint 는 column-op-literal 비교 + AND/OR/NOT/IS NULL
  만 cover. 그 이상은 `Error(UnsupportedExpression)` 반환.

모든 새 enum 은 `#[serde(tag = "kind", rename_all = "kebab-case")]`.

**3. Parser (`src-tauri/sql-parser-core/src/parser.rs`)** —
`parse_statement` dispatch 에 INSERT/UPDATE/DELETE 분기 추가:

- `parse_insert` — VALUES / DEFAULT VALUES / SELECT-source / ON CONFLICT / RETURNING
- `parse_update` — SET list / FROM / WHERE / RETURNING
- `parse_delete` — FROM / USING / WHERE / RETURNING
- `parse_where_expr` — recursive-descent precedence (OR < AND < NOT < primary)

`is_known_sql_verb` 의 메시지 일반화 — INSERT/UPDATE/DELETE 도 더 이상
unsupported 가 아니다.

### TS facade — `src/lib/sql/sqlAst.ts`

새 TS types (Rust serde 매핑):

```ts
export type SqlLiteralValue =
  | { kind: "integer"; value: number }
  | { kind: "float"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" };

export type SqlInsertValue =
  | { kind: "literal"; value: SqlLiteralValue }
  | { kind: "default" }
  | { kind: "placeholder"; name: string };

export type SqlCompareOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";

export type SqlWhereExpr =
  | { kind: "comparison"; column: string; op: SqlCompareOp; value: SqlInsertValue }
  | { kind: "and"; left: SqlWhereExpr; right: SqlWhereExpr }
  | { kind: "or"; left: SqlWhereExpr; right: SqlWhereExpr }
  | { kind: "not"; inner: SqlWhereExpr }
  | { kind: "is-null"; column: string }
  | { kind: "is-not-null"; column: string };

export type SqlInsertSource =
  | { kind: "values"; rows: SqlInsertValue[][] }
  | { kind: "default-values" }
  | { kind: "select"; statement: SqlSelectStatement };

export interface SqlOnConflictDoUpdate {
  kind: "do-update";
  set: SqlUpdateAssignment[];
  where_clause: SqlWhereExpr | null;
}
export type SqlOnConflict =
  | { kind: "do-nothing" }
  | SqlOnConflictDoUpdate;

export interface SqlInsertStatement {
  kind: "insert";
  table: string;
  columns: string[];
  source: SqlInsertSource;
  on_conflict: SqlOnConflict | null;
  returning: string[];
}

export interface SqlUpdateAssignment {
  column: string;
  value: SqlInsertValue;
}

export interface SqlUpdateStatement {
  kind: "update";
  table: string;
  assignments: SqlUpdateAssignment[];
  from: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

export interface SqlDeleteStatement {
  kind: "delete";
  table: string;
  using: string[];
  where_clause: SqlWhereExpr | null;
  returning: string[];
}

export type SqlParseResult =
  | SqlSelectStatement
  | SqlDropStatement
  | SqlTruncateStatement
  | SqlAlterTableStatement
  | SqlInsertStatement     // NEW
  | SqlUpdateStatement     // NEW
  | SqlDeleteStatement     // NEW
  | SqlParseError;
```

`isSqlParseResult` runtime guard 의 `kind` 분기에 새 variant 추가.

### sqlSafety callsite migration — `src/lib/sql/sqlSafety.ts`

`analyzeStatement` 의 DML 정규식 분기:

- `/^INSERT\s+INTO\b/` — 제거
- `/^UPDATE\b/` + WHERE 분석 정규식 — 제거
- `/^DELETE\s+FROM\b/` + WHERE 분석 정규식 — 제거

새 AST 분기 (sprint-391 의 `parseSqlPreloaded(sql)` 호출 패턴 재사용):

```ts
const ast = parseSqlPreloaded(sql);
if (ast) {
  switch (ast.kind) {
    case "insert": return { kind: "dml-insert", severity: "info", reasons: [] };
    case "update": {
      const reasons = ast.where_clause === null
        ? ["WHERE 없는 UPDATE — 전체 행 영향"]
        : [];
      return { kind: "dml-update", severity: "danger", reasons };
    }
    case "delete": {
      const reasons = ast.where_clause === null
        ? ["WHERE 없는 DELETE — 전체 행 영향"]
        : [];
      return { kind: "dml-delete", severity: "danger", reasons };
    }
    // DDL destructive 는 sprint-391 분기에서 이미 처리
  }
}
// AST 없으면 정규식 fallback (기존 behavior 보존)
```

**결정 (D1)**: WHERE 없는 UPDATE / DELETE 는 *별도 `reasons`* 만 추가. severity
는 동일하게 `danger`. UX 변경 없음 (안내 메시지만 강화).

**결정 (D2)**: INSERT 의 `severity` 는 `info` 유지 (기존). ON CONFLICT DO UPDATE
도 `info` 분류 — caller 가 UPSERT 를 destructive 로 보는 별도 path 없음.

**결정 (D3)**: INSERT/UPDATE/DELETE 의 *반환 shape* 변경 0 — `kind` /
`severity` / `reasons` 동일. 호출자 영향 0.

## Out of Scope

- **SELECT widening (JOIN / AND-OR / subquery / CTE / window / UNION / CASE)
  — sprint-393a/b**.
- **DDL additive (CREATE / ALTER ADD / ALTER RENAME) — sprint-394**.
- **GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT — sprint-395**.
- **Dialect 차이 — sprint-396+**.
- **MERGE / REPLACE / INSERT IGNORE / ON DUPLICATE KEY UPDATE (MySQL)** —
  본 sprint scope 아님. PG `ON CONFLICT` 만 cover.
- **WHERE 의 함수 호출 / 산술식 / subquery / IN-list / LIKE / BETWEEN** —
  sprint-393b 의 SELECT WHERE widening 과 함께. 본 sprint 는 column op literal
  + AND/OR/NOT/IS NULL 만.
- **WITH (CTE) wrap DML** — `WITH cte AS (...) INSERT/UPDATE/DELETE …` 는
  sprint-393b 의 CTE 와 함께 처리.

## Invariants

- `analyzeStatement` 의 반환 `StatementAnalysis` shape 변경 없음.
- 기존 sqlSafety test suite — 모든 case 가 AST 교체 후에도 PASS.
- `parseSql` async API + `parseSqlPreloaded` sync API 모두 보존.
- 본 sprint 의 새 `parseSqlPreloaded` 호출은 sprint-391 의 *DDL destructive 분기
  와 동일한 위치* 에서 *DML 분기* 추가 — 분기 순서 충돌 없음.
- Rust crate: no `unwrap()` on user-input paths; no Tauri/tokio/io deps.
- WASM bundle size: sprint-391 ~24 KB gzipped 대비 +30% 미만 expect.

## Acceptance Criteria

### Rust crate — INSERT (AC-392-I)

- `AC-392-I01` `INSERT INTO users VALUES (1, 'a')` → `Insert { table: "users", columns: [], source: Values([[Integer(1), String("a")]]) }`
- `AC-392-I02` `INSERT INTO users (id, name) VALUES (1, 'a')` → `columns: ["id", "name"]`
- `AC-392-I03` `INSERT INTO users VALUES (1, 'a'), (2, 'b')` → 2 rows
- `AC-392-I04` `INSERT INTO users DEFAULT VALUES` → `InsertSource::DefaultValues`
- `AC-392-I05` `INSERT INTO users (id) VALUES (DEFAULT)` → `InsertValue::Default`
- `AC-392-I06` `INSERT INTO users (id) VALUES ($1)` → placeholder
- `AC-392-I07` `INSERT INTO users (id) VALUES (?)` → placeholder (anonymous)
- `AC-392-I08` `INSERT INTO users (id) VALUES (:name)` → placeholder (named)
- `AC-392-I09` `INSERT INTO users VALUES (NULL)` → `Literal(Null)`
- `AC-392-I10` `INSERT INTO users VALUES (TRUE)` → `Literal(Boolean(true))`
- `AC-392-I11` `INSERT INTO users (x) SELECT id FROM source` → `InsertSource::Select`
- `AC-392-I12` `INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING`
- `AC-392-I13` `INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'`
- `AC-392-I14` `INSERT INTO users (id) VALUES (1) RETURNING id, name`
- `AC-392-I15` `INSERT INTO users` (no source) → SyntaxError
- `AC-392-I16` `INSERT users VALUES (1)` (missing INTO) → SyntaxError
- `AC-392-I17` `INSERT INTO users VALUES (1, 'a',)` (trailing comma) → SyntaxError
- `AC-392-I18` case-insensitive (`insert into users values (1)`)

### Rust crate — UPDATE (AC-392-U)

- `AC-392-U01` `UPDATE users SET name = 'a'` → `Update { table: "users", assignments: [...], where_clause: None }`
- `AC-392-U02` `UPDATE users SET name = 'a' WHERE id = 1` → WHERE Comparison
- `AC-392-U03` `UPDATE users SET name = 'a', age = 30` → 2 assignments
- `AC-392-U04` `UPDATE users SET name = DEFAULT` → assignment value Default
- `AC-392-U05` `UPDATE users SET name = $1 WHERE id = $2` → placeholder
- `AC-392-U06` `UPDATE users SET name = 'a' FROM other WHERE other.id = users.id`
  → `from: ["other"]` + WHERE — *주의*: WHERE 의 `other.id = users.id` 는
  본 sprint 의 column-op-literal 제한 위반 → `Error(UnsupportedExpression)`.
  AC 는 *parse 성공* 이 아니라 *Error variant 정상 반환* 검증.
- `AC-392-U07` `UPDATE users SET name = 'a' WHERE id IS NULL`
- `AC-392-U08` `UPDATE users SET name = 'a' WHERE id IS NOT NULL`
- `AC-392-U09` `UPDATE users SET name = 'a' WHERE id = 1 AND age > 30`
- `AC-392-U10` `UPDATE users SET name = 'a' WHERE id = 1 OR id = 2`
- `AC-392-U11` `UPDATE users SET name = 'a' WHERE NOT (id = 1)`
- `AC-392-U12` `UPDATE users SET name = 'a' RETURNING id`
- `AC-392-U13` `UPDATE users SET` (no assignment) → SyntaxError
- `AC-392-U14` `UPDATE users name = 'a'` (missing SET) → SyntaxError
- `AC-392-U15` case-insensitive

### Rust crate — DELETE (AC-392-D)

- `AC-392-D01` `DELETE FROM users` → `Delete { where_clause: None }`
- `AC-392-D02` `DELETE FROM users WHERE id = 1` → WHERE
- `AC-392-D03` `DELETE FROM users WHERE id = 1 AND age < 30`
- `AC-392-D04` `DELETE FROM users USING orders WHERE …` — *동일 제약*: WHERE 가
  cross-table 비교면 `UnsupportedExpression`. `using: ["orders"]` 는 parse OK.
- `AC-392-D05` `DELETE FROM users WHERE name IS NULL`
- `AC-392-D06` `DELETE FROM users WHERE id IN (1, 2, 3)` → `UnsupportedExpression`
  (IN-list 는 sprint-393b)
- `AC-392-D07` `DELETE FROM users RETURNING id`
- `AC-392-D08` `DELETE users WHERE id = 1` (missing FROM) → SyntaxError
- `AC-392-D09` `DELETE FROM` (no table) → SyntaxError
- `AC-392-D10` case-insensitive

### Rust crate — serialization (AC-392-S)

- `AC-392-S01` `Insert` serialize → `{ "kind": "insert", … }`
- `AC-392-S02` `Update` serialize → `{ "kind": "update", … }`
- `AC-392-S03` `Delete` serialize → `{ "kind": "delete", … }`
- `AC-392-S04` `WhereExpr::Comparison` serialize → `{ "kind": "comparison", … }`
- `AC-392-S05` `WhereExpr::And` 중첩 serialize round-trip
- `AC-392-S06` `InsertValue::Literal(Null)` → `{ "kind": "literal", "value": { "kind": "null" } }`
- `AC-392-S07` serde round-trip (eq) for all new variants.

### TS facade (AC-392-F)

- `AC-392-F01` `parseSql("INSERT INTO users VALUES (1)")` → `kind: "insert"`.
- `AC-392-F02` `parseSql("INSERT INTO users (id) VALUES ($1)")` → placeholder kind.
- `AC-392-F03` `parseSql("INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING")` → on_conflict.
- `AC-392-F04` `parseSql("UPDATE users SET name = 'a' WHERE id = 1")` → kind/where_clause.
- `AC-392-F05` `parseSql("UPDATE users SET name = 'a'")` → where_clause === null.
- `AC-392-F06` `parseSql("DELETE FROM users WHERE id = 1")` → kind/where_clause.
- `AC-392-F07` `parseSql("DELETE FROM users")` → where_clause === null.
- `AC-392-F08` `parseSqlPreloaded` — 모듈 로드 후 sync 호출 시 정상 AST 반환
  (DML 분기 cover).
- `AC-392-F09` runtime guard `isSqlParseResult` — INSERT/UPDATE/DELETE shape 모두 accept.

### sqlSafety integration (AC-392-X)

- `AC-392-X01` `analyzeStatement("INSERT INTO users VALUES (1)")` — `dml-insert` + `severity: info`.
- `AC-392-X02` `analyzeStatement("UPDATE users SET name = 'a' WHERE id = 1")` — `dml-update` + `severity: danger` + reasons 빈.
- `AC-392-X03` `analyzeStatement("UPDATE users SET name = 'a'")` — `dml-update` + `severity: danger` + reasons 에 "WHERE 없는 UPDATE" 포함.
- `AC-392-X04` `analyzeStatement("DELETE FROM users WHERE id = 1")` — `dml-delete` + `severity: danger` + reasons 빈.
- `AC-392-X05` `analyzeStatement("DELETE FROM users")` — `dml-delete` + `severity: danger` + reasons 에 "WHERE 없는 DELETE" 포함.
- `AC-392-X06` `analyzeStatement("INSERT INTO users (id) VALUES (1) ON CONFLICT DO UPDATE SET name = 'a'")` — `dml-insert` (severity info).
- `AC-392-X07` 기존 sqlSafety test suite — 회귀 0.
- `AC-392-X08` 반환 shape 변경 없음.

### Verification (AC-392-V)

- `AC-392-V01` `cargo test` (sql-parser-core) — sprint-385/391 + 본 sprint N → 모두 PASS.
- `AC-392-V02` `cargo test --test parse_sql_backend` — 회귀 0.
- `AC-392-V03` `pnpm vitest run` — 모두 PASS.
- `AC-392-V04` `pnpm tsc --noEmit` — 0 errors.
- `AC-392-V05` `pnpm lint` — 0 errors.
- `AC-392-V06` `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `AC-392-V07` `pnpm build:sql-wasm` — succeeds, gzipped < sprint-391 ×1.3.

## Design Bar / Quality Bar

- 기존 hand-written recursive-descent 패턴 유지 (no `nom`/`logos`).
- `unwrap()` / `expect()` 금지 (user-input paths).
- TS: no `any`. WASM 결과는 `unknown` + runtime guard.
- `parseSqlPreloaded` 의 sync 동작은 순수 — exception 안 던짐, side effect 없음.
- WHERE 의 *unsupported expression* 은 panic 이 아닌 `Error(UnsupportedExpression)`
  variant 반환 — caller 가 정규식 fallback 으로 graceful degrade.

## Verification Plan

### Required Checks

```bash
cd src-tauri/sql-parser-core && cargo test
cd src-tauri && cargo test --test parse_sql_backend
cd src-tauri && cargo clippy --all-targets --all-features -- -D warnings
pnpm build:sql-wasm
pnpm vitest run
pnpm tsc --noEmit
pnpm lint
```

### Required Evidence

- Rust unit test 추가 개수 (≥ 60 covering AC-392-I + U + D + S).
- TS facade test 추가 개수 (≥ 9 covering AC-392-F).
- sqlSafety AST integration test 추가 개수 (≥ 8 covering AC-392-X).
- `.wasm` 파일 크기 (gzipped) — sprint-391 대비 +30% 미만.

## Test Requirements

- Rust unit tests: ≥ 60 새 추가.
- TS facade tests: ≥ 9 새 추가.
- sqlSafety tests: ≥ 8 새 추가 + 기존 회귀 0.
- Vitest baseline: 4274 → 4274+ (delta 양수).

## Ownership

- Generator: general-purpose Agent (sprint-392).
- Write scope: In Scope.
- Merge order: sprint-391 위. sprint-393 (SELECT widening) 가 본 sprint 위에 build.

## Exit Criteria

- Open P1/P2: 0
- AC PASS — I 18 + U 15 + D 10 + S 7 + F 9 + X 8 + V 7 = **74 AC**
- Pre-commit + pre-push hooks green
- PR open + linked

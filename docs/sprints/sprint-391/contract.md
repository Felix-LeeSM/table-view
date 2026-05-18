# Sprint Contract: sprint-391

## Summary

- Goal: **SQL DDL destructive grammar — DROP / TRUNCATE / ALTER … DROP** —
  extend the sprint-385 SELECT-only grammar slice with the full DDL destructive
  surface (every variant + every option combination) and migrate
  `src/lib/sql/sqlSafety.ts` 의 `ddl-drop` / `ddl-truncate` / `ddl-alter-drop`
  분류 callsite를 정규식에서 AST 기반(`parseSql`)으로 교체한다.
- Audience: 후속 sprint (392 DML / 393 SELECT widening / 394 DDL additive)에서
  분류기 callsite 의 정규식 → AST 패턴을 재사용한다.
- Owner: Generator (sprint-391).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint) +
  `backend` (`cargo test`, `cargo clippy --all-targets --all-features -D warnings`,
  `cargo build --target wasm32-unknown-unknown --release --features wasm`).

## Background

- sprint-385 는 SELECT narrow slice 만 cover (31 Rust tests + 1 facade test).
- `src/lib/sql/sqlSafety.ts` 의 `analyzeStatement` 는 *정규식 기반*. 본 sprint
  머지 후 DDL destructive (DROP / TRUNCATE / ALTER DROP) 의 분류는 *AST 기반*
  이어야 한다. *호출자* (`useSafeModeGate` 등) 에는 영향이 0이며 — 내부 분류
  메커니즘만 변경.
- 남은 정규식 (INSERT / UPDATE / DELETE / SELECT / CREATE / GRANT / REVOKE /
  WITH / EXPLAIN / SHOW / DESCRIBE 분류) 은 sprint-392~394 가 단계적으로 교체.

## In Scope

### Rust crate — grammar additions

**1. Lexer (`src-tauri/sql-parser-core/src/lexer.rs`)**

새 keyword token 추가:

- `DROP`, `TRUNCATE`, `ALTER`
- `TABLE`, `DATABASE`, `INDEX`, `VIEW`, `SCHEMA`, `SEQUENCE`, `TYPE`
- `IF`, `EXISTS`
- `CASCADE`, `RESTRICT`
- `RESTART`, `CONTINUE`, `IDENTITY`
- `COLUMN`, `CONSTRAINT`

모두 case-insensitive — 기존 `Select`/`From`/`Where` 와 동일한 패턴.

**2. AST (`src-tauri/sql-parser-core/src/ast.rs`)**

`ParseResult` 에 새 variant 추가:

```rust
pub enum ParseResult {
    Select(SelectStatement),
    Drop(DropStatement),             // NEW
    Truncate(TruncateStatement),     // NEW
    AlterTable(AlterTableStatement), // NEW
    Error(ParseError),
}

pub struct DropStatement {
    pub object_type: DropObjectType,
    pub name: String,
    pub if_exists: bool,
    pub cascade: Option<CascadeBehavior>,
}

pub enum DropObjectType { Table, Database, Index, View, Schema, Sequence, Type }

pub enum CascadeBehavior { Cascade, Restrict }

pub struct TruncateStatement {
    pub table: String,
    pub restart_identity: Option<bool>,  // None = unspecified, Some(true) = RESTART, Some(false) = CONTINUE
    pub cascade: Option<CascadeBehavior>,
}

pub struct AlterTableStatement {
    pub table: String,
    pub action: AlterAction,
}

pub enum AlterAction {
    DropColumn { column: String, if_exists: bool, cascade: Option<CascadeBehavior> },
    DropConstraint { constraint: String, cascade: Option<CascadeBehavior> },
    DropIndex { index: String },  // MySQL-style ALTER TABLE … DROP INDEX
}
```

모든 새 enum 은 `#[serde(tag = "kind", rename_all = "kebab-case")]`.

**3. Parser (`src-tauri/sql-parser-core/src/parser.rs`)**

`parse_statement` 의 first-token dispatch 분기에 `Drop`/`Truncate`/`Alter` token
인식 추가. 각 verb 별 sub-parser:

- `parse_drop` — 모든 object type + IF EXISTS + CASCADE/RESTRICT 조합
- `parse_truncate` — TABLE keyword optional + RESTART/CONTINUE IDENTITY + CASCADE/RESTRICT
- `parse_alter_table` — DROP COLUMN/CONSTRAINT/INDEX 각 옵션 조합

`is_known_sql_verb` 의 sprint 메시지 (`"sprint-385 only supports SELECT"`) 를
일반화 — 본 sprint 이후 DROP/TRUNCATE/ALTER 는 더 이상 unsupported 가 아니다.

### TS facade — `src/lib/sql/sqlAst.ts`

새 TypeScript types 추가 (Rust serde 매핑):

```ts
export type SqlDropObjectType =
  | "table" | "database" | "index" | "view" | "schema" | "sequence" | "type";

export type SqlCascadeBehavior = "cascade" | "restrict";

export interface SqlDropStatement {
  kind: "drop";
  object_type: SqlDropObjectType;
  name: string;
  if_exists: boolean;
  cascade: SqlCascadeBehavior | null;
}

export interface SqlTruncateStatement {
  kind: "truncate";
  table: string;
  restart_identity: boolean | null;
  cascade: SqlCascadeBehavior | null;
}

export type SqlAlterAction =
  | { kind: "drop-column"; column: string; if_exists: boolean;
      cascade: SqlCascadeBehavior | null }
  | { kind: "drop-constraint"; constraint: string;
      cascade: SqlCascadeBehavior | null }
  | { kind: "drop-index"; index: string };

export interface SqlAlterTableStatement {
  kind: "alter-table";
  table: string;
  action: SqlAlterAction;
}

export type SqlParseResult =
  | SqlSelectStatement
  | SqlDropStatement
  | SqlTruncateStatement
  | SqlAlterTableStatement
  | SqlParseError;
```

`isSqlParseResult` runtime guard 의 `kind` 분기에 새 variant 추가.

### sqlSafety callsite migration — `src/lib/sql/sqlSafety.ts`

**`analyzeStatement`** 의 정규식 DDL destructive 분기:

- `/^DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER)\b/` — 제거
- `/^TRUNCATE\b/` — 제거
- `/^ALTER\s+TABLE\b/ && /\bDROP\s+(COLUMN|CONSTRAINT)\b/` — 제거

새 *동기* AST helper (`parseSqlSync` 또는 `analyzeDdlDestructive`) 가 필요한데,
`parseSql` 은 WASM lazy-load async API 이므로 *분류기 입장에서는 사용 불가*
(`analyzeStatement` 는 sync). 따라서 본 sprint 는 *backend native parser* (Tauri
가 아닌 `sql-parser-core` 의 동기 native 호출은 frontend 에서 불가) 가 아닌
*WASM 동기 호출 wrapper* 를 도입한다.

→ **결정 (D1)**: WASM 모듈의 init promise 가 *이미 resolved* 인 경우 동기 호출
이 가능하다는 wasm-pack `--target web` 의 특성을 활용해, `sqlAst.ts` 에
`parseSqlPreloaded(sql: string): SqlParseResult | null` 동기 API 추가. 캐시된
모듈이 없으면 `null` (정규식 fallback). 캐시된 모듈이 있으면 즉시 동기 결과.

→ **결정 (D2)**: `sqlSafety.ts` 의 `analyzeStatement` 의 DDL destructive 분기는
*먼저* `parseSqlPreloaded(sql)` 시도 → `kind === "drop"|"truncate"|"alter-table"`
일 때 AST 기반 분류 적용. WASM 모듈이 preload 되지 않았으면 *정규식 fallback*
(기존 behavior 보존). `analyzeStatement` 의 sync API 는 *변경 없음*.

→ **결정 (D3)**: `parseSqlPreloaded` 는 본 sprint 한정으로 *DDL destructive 만*
처리. SELECT / DML / other 는 caller 의 정규식 분기 유지. sqlSafety 의 *반환
shape* 는 변경 0 — 호출자 영향 0.

## Out of Scope

- **DML grammar (INSERT / UPDATE / DELETE) — sprint-392**.
- **SELECT widening (JOIN / AND-OR / subquery / CTE / window) — sprint-393**.
- **DDL additive (CREATE / ALTER ADD / ALTER RENAME) — sprint-394**.
- **Dialect 차이 (MySQL backtick `` ` ``, MSSQL `[bracket]`, schema qualifier
  `public.users`) — sprint-396+**.
- **DROP TRIGGER / DROP FUNCTION / DROP PROCEDURE / DROP ROLE** — 본 sprint
  scope 아님. 정규식 폴백이 처리 (DROP TRIGGER 는 기존 정규식이 `ddl-drop` 으로
  분류).
- **GRANT / REVOKE 분류** — 정규식 유지 (DDL 이지만 destructive grammar 아님).
- **Multi-statement parsing** — 한 statement per `parse_sql` 호출.

## Invariants

- `analyzeStatement` 의 반환 `StatementAnalysis` shape (`kind`, `severity`,
  `reasons`) **변경 없음**. 호출자 (`useSafeModeGate`, `escalateWarnIfLargeImpact`,
  raw editor) 영향 0.
- 기존 sqlSafety test suite — *모든* case 가 AST 교체 후에도 PASS.
- TS facade `parseSql` async API 유지 (sprint-385 lazy WASM load).
- 새 `parseSqlPreloaded` 는 `analyzeStatement` 내부에서만 사용; public API 노출
  최소화.
- Rust crate: no `unwrap()` on user-input paths; no Tauri/tokio/io deps.
- WASM bundle size: sprint-385 의 ~20.3 KB gzipped 대비 +20% 미만 expect.

## Acceptance Criteria

### Rust crate — DROP (AC-391-D)

- `AC-391-D01` `DROP TABLE users` → `Drop { object_type: Table, name: "users", if_exists: false, cascade: None }`
- `AC-391-D02` `DROP TABLE IF EXISTS users` → `if_exists: true`
- `AC-391-D03` `DROP TABLE users CASCADE` → `cascade: Some(Cascade)`
- `AC-391-D04` `DROP TABLE IF EXISTS users CASCADE` — combined
- `AC-391-D05` `DROP TABLE users RESTRICT` → `cascade: Some(Restrict)`
- `AC-391-D06` `DROP DATABASE myapp` — `DropObjectType::Database`
- `AC-391-D07` `DROP DATABASE IF EXISTS myapp`
- `AC-391-D08` `DROP INDEX idx_users_email` — `DropObjectType::Index`
- `AC-391-D09` `DROP INDEX IF EXISTS idx CASCADE`
- `AC-391-D10` `DROP VIEW v_active_users` — `DropObjectType::View`
- `AC-391-D11` `DROP VIEW IF EXISTS v RESTRICT`
- `AC-391-D12` `DROP SCHEMA public CASCADE` — `DropObjectType::Schema`
- `AC-391-D13` `DROP SCHEMA IF EXISTS s CASCADE`
- `AC-391-D14` `DROP SEQUENCE my_seq` — `DropObjectType::Sequence`
- `AC-391-D15` `DROP TYPE my_enum CASCADE` — `DropObjectType::Type`
- `AC-391-D16` `DROP TABLE` (no name) → SyntaxError
- `AC-391-D17` `DROP FROOBAR x` (unknown object) → SyntaxError
- `AC-391-D18` `DROP TABLE x CASCADE RESTRICT` → SyntaxError (mutually exclusive)
- `AC-391-D19` case-insensitive (`drop table users`) → identical AST

### Rust crate — TRUNCATE (AC-391-T)

- `AC-391-T01` `TRUNCATE users` → `Truncate { table: "users", restart_identity: None, cascade: None }`
- `AC-391-T02` `TRUNCATE TABLE users` — TABLE keyword optional
- `AC-391-T03` `TRUNCATE users CASCADE` → `cascade: Some(Cascade)`
- `AC-391-T04` `TRUNCATE users RESTRICT`
- `AC-391-T05` `TRUNCATE users RESTART IDENTITY` → `restart_identity: Some(true)`
- `AC-391-T06` `TRUNCATE users CONTINUE IDENTITY` → `restart_identity: Some(false)`
- `AC-391-T07` `TRUNCATE users RESTART IDENTITY CASCADE` — combined
- `AC-391-T08` `TRUNCATE users CONTINUE IDENTITY RESTRICT` — combined
- `AC-391-T09` `TRUNCATE TABLE users RESTART IDENTITY CASCADE` — TABLE + all opts
- `AC-391-T10` `TRUNCATE` (no name) → SyntaxError
- `AC-391-T11` `TRUNCATE users RESTART` (missing IDENTITY) → SyntaxError
- `AC-391-T12` `TRUNCATE users CASCADE RESTRICT` → SyntaxError (mutually exclusive)
- `AC-391-T13` case-insensitive (`truncate table users cascade`)

### Rust crate — ALTER TABLE … DROP (AC-391-A)

- `AC-391-A01` `ALTER TABLE users DROP COLUMN email` → `DropColumn { column: "email", if_exists: false, cascade: None }`
- `AC-391-A02` `ALTER TABLE users DROP COLUMN email CASCADE`
- `AC-391-A03` `ALTER TABLE users DROP COLUMN IF EXISTS email`
- `AC-391-A04` `ALTER TABLE users DROP COLUMN IF EXISTS email CASCADE`
- `AC-391-A05` `ALTER TABLE users DROP COLUMN email RESTRICT`
- `AC-391-A06` `ALTER TABLE users DROP CONSTRAINT users_pkey` → `DropConstraint`
- `AC-391-A07` `ALTER TABLE users DROP CONSTRAINT users_pkey CASCADE`
- `AC-391-A08` `ALTER TABLE users DROP CONSTRAINT users_pkey RESTRICT`
- `AC-391-A09` `ALTER TABLE users DROP INDEX idx_email` → `DropIndex` (MySQL-style)
- `AC-391-A10` `ALTER TABLE` (no name) → SyntaxError
- `AC-391-A11` `ALTER TABLE users` (no action) → SyntaxError
- `AC-391-A12` `ALTER TABLE users DROP` (no target keyword) → SyntaxError
- `AC-391-A13` `ALTER TABLE users DROP COLUMN` (no column name) → SyntaxError
- `AC-391-A14` `ALTER TABLE users ADD COLUMN x int` → UnsupportedStatement
  (ALTER ADD 은 sprint-394)

### Rust crate — serialization (AC-391-S)

- `AC-391-S01` `Drop` variant serialize → `{ "kind": "drop", "object_type": "table", … }`
- `AC-391-S02` `Truncate` variant serialize → `{ "kind": "truncate", … }`
- `AC-391-S03` `AlterTable` + `DropColumn` serialize → `{ "kind": "alter-table", "action": { "kind": "drop-column", … } }`
- `AC-391-S04` 모든 새 variant serde round-trip (`to_string` → `from_str` → eq).

### TS facade (AC-391-F)

- `AC-391-F01` `parseSql("DROP TABLE users")` → `kind: "drop"` + 전체 shape.
- `AC-391-F02` `parseSql("DROP TABLE IF EXISTS users CASCADE")` → flags 정확.
- `AC-391-F03` `parseSql("TRUNCATE users RESTART IDENTITY CASCADE")` → restart_identity / cascade 정확.
- `AC-391-F04` `parseSql("ALTER TABLE users DROP COLUMN email CASCADE")` → action.kind === "drop-column".
- `AC-391-F05` `parseSql("ALTER TABLE users DROP CONSTRAINT pk")` → action.kind === "drop-constraint".
- `AC-391-F06` `parseSql("ALTER TABLE users DROP INDEX idx")` → action.kind === "drop-index".
- `AC-391-F07` `parseSqlPreloaded` — 모듈 미로드 시 `null` 반환 (regression-safe fallback).
- `AC-391-F08` `parseSqlPreloaded` — 모듈 로드 후 sync 호출 시 정상 AST 반환.

### sqlSafety integration (AC-391-X)

- `AC-391-X01` `analyzeStatement("DROP TABLE users")` — `kind: "ddl-drop"` + `severity: "danger"` (AST path, 기존 정규식 fallback 과 동일).
- `AC-391-X02` `analyzeStatement("DROP TABLE IF EXISTS users CASCADE")` — `ddl-drop` 분류 (옵션 무관).
- `AC-391-X03` `analyzeStatement("TRUNCATE TABLE events")` — `ddl-truncate` (기존과 동일).
- `AC-391-X04` `analyzeStatement("TRUNCATE users RESTART IDENTITY CASCADE")` — `ddl-truncate` (옵션 풍부).
- `AC-391-X05` `analyzeStatement("ALTER TABLE users DROP COLUMN email")` — `ddl-alter-drop`.
- `AC-391-X06` `analyzeStatement("ALTER TABLE users DROP CONSTRAINT pk CASCADE")` — `ddl-alter-drop`.
- `AC-391-X07` 기존 sqlSafety test suite 전체 PASS (회귀 0).
- `AC-391-X08` `analyzeStatement` 의 *반환 shape* 변경 없음 (`StatementAnalysis` 의 `kind` / `severity` / `reasons` 동일).

### Verification (AC-391-V)

- `AC-391-V01` `cargo test` (sql-parser-core) — sprint-385 31 + sprint-391 N → 모두 PASS.
- `AC-391-V02` `cargo test --test parse_sql_backend` — 2 PASS (회귀 0).
- `AC-391-V03` `pnpm vitest run` — 모두 PASS (4271 + 본 sprint 새 facade + sqlSafety AST tests).
- `AC-391-V04` `pnpm tsc --noEmit` — 0 errors.
- `AC-391-V05` `pnpm lint` — 0 errors.
- `AC-391-V06` `cargo clippy --all-targets --all-features -- -D warnings` — clean.
- `AC-391-V07` `pnpm build:sql-wasm` — succeeds, bundle gzipped < sprint-385 ×1.2.

## Design Bar / Quality Bar

- 기존 sprint-385 의 hand-written recursive-descent 패턴 유지 (no `nom`/`logos`).
- `unwrap()` / `expect()` 금지 (user-input paths).
- TS: no `any`. WASM 결과는 `unknown` + runtime guard.
- `parseSqlPreloaded` 의 sync 동작은 *순수* — side effect 없음, exception 안 던짐.

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

- Rust unit test 추가 개수 (≥ 50 covering AC-391-D + T + A + S).
- TS facade test 추가 개수 (≥ 8 covering AC-391-F).
- sqlSafety AST integration test 추가 개수 (≥ 6 covering AC-391-X).
- `.wasm` 파일 크기 (gzipped) — sprint-385 ~20.3 KB 대비 +20% 미만.

## Test Requirements

- Rust unit tests: ≥ 50 새 추가 (총 ~81+).
- TS facade tests: ≥ 8 새 추가.
- sqlSafety tests: ≥ 6 새 추가 + 기존 회귀 0.
- Vitest baseline: 4271 → 4271+ (delta 양수).

## Ownership

- Generator: general-purpose Agent (sprint-391).
- Write scope: In Scope.
- Merge order: sprint-385/390 위. sprint-392 (DML) 가 본 sprint 위에 build.

## Exit Criteria

- Open P1/P2: 0
- AC PASS — D 19 + T 13 + A 14 + S 4 + F 8 + X 8 + V 7 = **73 AC**
- Pre-commit + pre-push hooks green
- PR open + linked

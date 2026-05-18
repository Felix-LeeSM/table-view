# Sprint Contract: sprint-394

## Summary

- Goal: **SQL DDL additive grammar — CREATE TABLE / CREATE INDEX /
  CREATE VIEW + ALTER TABLE ADD / RENAME** — extend the sprint-385 /
  391 / 392 / 393a / 393b grammar with the *constructive* side of DDL:
  the `CREATE` family of statements and the *non-destructive* `ALTER
  TABLE` actions (`ADD COLUMN`, `ADD CONSTRAINT`, `RENAME TO`, `RENAME
  COLUMN`). This sprint also migrates the corresponding sqlSafety
  classifications (`ddl-create`, `ddl-alter-add`, `ddl-alter-rename`)
  from the regex fast-path to the AST branch.
- Audience: With sprint-394 merged, sqlSafety's regex residue is
  reduced to GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT
  (sprint-395's territory). Downstream tooling that depends on
  understanding the *shape* of created tables / indexes / views (column
  introspection, autocomplete for newly-created relations) gains an
  AST to read from.
- Owner: Generator (sprint-394).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint)
  + `backend` (`cargo test`, `cargo clippy --all-targets
  --all-features -D warnings`, `cargo build --target
  wasm32-unknown-unknown --release --features wasm`).

## Background

- sprint-391 covered the *destructive* DDL surface (`DROP`,
  `TRUNCATE`, `ALTER … DROP`). The dual — *additive* DDL — was
  deferred to this sprint because the column-type + constraint grammar
  has significantly more surface (NUMERIC(p, s), DEFAULT expressions,
  CHECK predicates) and benefits from being scoped in a single review.
- The safety classifications introduced by this sprint:
  - `ddl-create` — `severity: info`. Creating a new table, index, or
    view is non-destructive (no existing rows / structure is modified).
    The classification is informational and informs the safe-mode UI
    that a write is happening but does not require a warning.
  - `ddl-alter-add` — `severity: warn`. ALTER TABLE … ADD COLUMN or
    ADD CONSTRAINT modifies existing schema; depending on the column
    type and DEFAULT, this may rewrite the table on some backends. A
    warn classification surfaces the change in the safe-mode UI.
  - `ddl-alter-rename` — `severity: warn`. Renaming a table or column
    breaks any external query that hard-codes the old name; a warn
    classification is appropriate.
  - `ddl-create-view` — `severity: info`. `CREATE OR REPLACE VIEW`
    is treated the same as plain CREATE VIEW for the classification —
    the view body itself may reference relations that are then
    re-pointed, but the classification only inspects the top-level
    verb. `OR REPLACE` does not escalate severity in this sprint.
- The existing sqlSafety regex `^CREATE\s+...` continues to function as
  a *fallback* path when the WASM module is not preloaded —
  exactly the same fallback contract as sprint-391 / sprint-392.

## In Scope

### Lexer additions

The lexer gains the following new case-insensitive keyword tokens.

- Top-level verbs: `CREATE`, `OR`, `REPLACE`, `RENAME`, `TO`.
- Object kinds: `TABLE`, `INDEX`, `VIEW` (already lexed by sprint-391;
  reused), `UNIQUE`.
- Type names (lexed as keyword tokens so the parser can distinguish
  type position from identifier position): `INTEGER`, `BIGINT`,
  `VARCHAR`, `TEXT`, `TIMESTAMP`, `DATE`, `BOOLEAN`, `NUMERIC`,
  `SERIAL`, `UUID`. The lexer treats unrecognized type-name-shaped
  identifiers in type position as `Error(SyntaxError)` — the parser
  needs an explicit allowlist to keep the AST predictable.
- Constraint keywords: `PRIMARY`, `KEY`, `NULL` (already lexed),
  `NOT` (already lexed), `DEFAULT` (already lexed), `UNIQUE` (already
  lexed once for index — reused), `REFERENCES`, `CHECK`,
  `CONSTRAINT` (already lexed in sprint-391 — reused).

### AST additions (natural-language spec)

The `ParseResult` discriminated union gains four new top-level variants:
`create-table`, `create-index`, `create-view`, and (re-used from
sprint-391) `alter-table` with two new `action` variants. Discriminator
names are kebab-case.

- **CREATE TABLE statement.** Top-level `kind="create-table"` carries
  four slots: `table` (the schema-qualified table reference shape from
  sprint-393a — `schema` may be null, `table` required), `if_not_exists`
  (boolean — true when `IF NOT EXISTS` was present), `columns` (an
  ordered list of column definitions; empty list is rejected as
  `Error(SyntaxError)`), and `table_constraints` (an ordered list of
  table-level constraints; empty list when absent). The AST does not
  carry a "creation-mode" field — TEMPORARY / UNLOGGED variants are out
  of scope for this sprint and are rejected at the parser level (see
  AC-394-T23). A future sprint that introduces those variants will add
  the slot deliberately.
- **Column definition.** Each column has four slots: `name` (string),
  `data_type` (the column-type shape — see below), `constraints` (an
  ordered list of column-level constraints; empty when absent), and a
  position-preservation flag (`source_index`, integer) recording the
  zero-based index of this column in the CREATE statement source — the
  flag is useful for downstream tooling that wants to map AST back to
  source position, and is set by the parser, not by the user.
- **Column type.** A discriminated union with `kind` tags: `integer`,
  `bigint`, `text`, `date`, `boolean`, `serial`, `uuid` (each carrying
  no extra fields), `varchar` (carrying a length integer), `timestamp`
  (carrying an optional `with_time_zone` boolean — false when absent),
  and `numeric` (carrying optional precision integer and optional scale
  integer; both null when absent, only precision present when `NUMERIC(p)`,
  both present when `NUMERIC(p, s)`).
- **Column-level constraint.** A discriminated union with `kind` tags:
  - `primary-key` (no fields beyond the kind tag).
  - `not-null` (no fields).
  - `default` (carrying a value of the same literal-or-placeholder
    shape introduced by sprint-392 — `InsertValue`).
  - `unique` (no fields).
  - `references` (carrying a target table reference and an optional
    target column name; both fields populated from `REFERENCES
    other(other_col)`; the column slot is null when source writes
    just `REFERENCES other`).
  - `check` (carrying a WHERE-style expression — the same widened
    grammar introduced by sprint-393a / sprint-393b).
  Each constraint may optionally carry a constraint name (set by
  `CONSTRAINT name PRIMARY KEY` etc.); the name slot is null when
  unset.
- **Table-level constraint.** Same as column-level constraint *plus* a
  required `columns` slot (ordered list of column names) for
  `primary-key`, `unique`, and `references`. The `check` variant does
  not carry a `columns` slot (the expression already references
  columns by name).
- **CREATE INDEX statement.** Top-level `kind="create-index"` carries:
  `unique` (boolean — true when `UNIQUE` was present), `if_not_exists`
  (boolean), `name` (string), `table` (schema-qualified table
  reference), `columns` (ordered list of column references — at least
  one; an empty list is a syntax error).
- **CREATE VIEW statement.** Top-level `kind="create-view"` carries:
  `or_replace` (boolean — true when `OR REPLACE` was present), `name`
  (schema-qualified table reference), `body` (a nested `SelectStatement`
  — the same shape as sprint-393a / 393b SELECT, set-operation chain
  allowed). The view body is parsed by re-entering the SELECT parser;
  a body that fails to parse propagates as `Error(...)` at the top
  level (not as a nested error inside the CREATE VIEW shape).
- **ALTER TABLE additive actions.** The sprint-391 `AlterTableStatement`
  shape gains three new `action` variants under the existing
  `kind="alter-table"` top-level:
  - `add-column` — carries a `column` field of the column-definition
    shape (the same shape used by CREATE TABLE), and an
    `if_not_exists` boolean (false unless `IF NOT EXISTS` was
    present).
  - `add-constraint` — carries a table-level constraint shape (the
    same shape used by CREATE TABLE table-constraint).
  - `rename-table` — carries `new_name` (string identifier).
  - `rename-column` — carries `old_name` and `new_name` (both
    strings).

The sprint-391 destructive `action` variants (`drop-column`,
`drop-constraint`, `drop-index`) remain unchanged.

### Parser additions

- **CREATE dispatcher.** A top-level `CREATE` token routes by the next
  token: `TABLE`, `INDEX`, `UNIQUE INDEX`, `VIEW`, or `OR REPLACE
  VIEW`. Any other follow-up token routes to `Error(SyntaxError)` —
  there is no fallthrough to a generic "unknown CREATE" classification
  in the parser (the regex fallback in sqlSafety still handles e.g.
  `CREATE FUNCTION` for safety classification, but the AST returns
  `Error`).
- **CREATE TABLE parser.** Parses the optional `IF NOT EXISTS`, the
  table reference, the parenthesized definition list, and assembles
  the AST. The definition list interleaves column definitions and
  table-level constraints; the parser distinguishes by looking ahead
  for the `CONSTRAINT` keyword or a recognized constraint keyword
  (`PRIMARY`, `UNIQUE`, `CHECK`, `FOREIGN` — see below) at item
  position.
- **Column type parser.** The type-name allowlist is the lexer's
  keyword set. `VARCHAR(n)` requires a parenthesized integer literal.
  `NUMERIC` accepts zero, one, or two arguments. `TIMESTAMP WITH TIME
  ZONE` is one token sequence; bare `TIMESTAMP` leaves
  `with_time_zone=false`. The parser does not attempt to coerce
  vendor-specific synonyms (`INT4`, `INT8`, `STRING`, `LONGTEXT`) —
  those parse to `Error(SyntaxError)` and remain regex-classified.
- **Constraint parser.** Accepts both inline column constraints
  (between the column-type and the next comma) and table-level
  constraints (introduced by `CONSTRAINT name ...` or by a bare
  `PRIMARY KEY (...)` / `UNIQUE (...)` / `CHECK (...)` / `FOREIGN
  KEY (...) REFERENCES ...`). The `FOREIGN KEY (cols) REFERENCES
  target(cols)` form parses to a table-level `references` constraint
  with the columns slot populated; the bare `REFERENCES other(c)`
  inline form parses to a column-level `references` constraint with
  the columns slot absent (column is implied by the containing column
  definition).
- **CREATE INDEX parser.** Accepts `[UNIQUE] [IF NOT EXISTS] name ON
  table (col1, col2, ...)`. The column list is ordered identifiers
  (no expressions in this sprint; functional indexes are deferred).
- **CREATE VIEW parser.** Accepts `[OR REPLACE] VIEW name AS
  <select-statement>`. The select-statement is parsed by the existing
  SELECT entry, so set-operation chains and CTE bodies inside view
  definitions are supported automatically — *but* a CTE-wrapped VIEW
  (`CREATE VIEW name AS WITH t AS (...) SELECT ...`) is recognized
  by accepting `WITH` as the start of the body and parsing it as a
  `with` AST node. The view's `body` slot in that case is typed to
  the `SelectStatement | WithStatement` union; a CTE-wrap inside a
  view body delegates to the same recursive parser used by sprint-393b.
- **ALTER TABLE additive parser.** Extends the sprint-391 dispatcher.
  The dispatcher already peeks at the token after `ALTER TABLE
  <name>`; it now recognizes `ADD COLUMN`, `ADD CONSTRAINT`, `ADD`
  followed by a bare constraint keyword (treated as `ADD CONSTRAINT`
  without an explicit name slot), `RENAME TO`, and `RENAME COLUMN`.

### TS facade updates

`src/lib/sql/sqlAst.ts` extends as follows:

- Four new top-level union members: `SqlCreateTableStatement`,
  `SqlCreateIndexStatement`, `SqlCreateViewStatement`, plus the
  existing `SqlAlterTableStatement` with new `action` discriminator
  values (`add-column`, `add-constraint`, `rename-table`,
  `rename-column`).
- New sub-shapes: column definition, column type discriminated union,
  column-level constraint discriminated union, table-level constraint
  discriminated union.
- The view body type is `SqlSelectStatement | SqlWithStatement`.
- The runtime guard `isSqlParseResult` accepts the new top-level
  `kind`s and the new constraint / type discriminators without
  throwing.

`parseSql` / `parseSqlPreloaded` keep their existing surfaces.

### sqlSafety integration

`src/lib/sql/sqlSafety.ts` callsite ordering:

1. CTE-wrap branch (sprint-393b) — delegate to inner statement.
2. DDL destructive branch (sprint-391) — `drop` / `truncate` /
   `alter-table` with destructive action.
3. **New: DDL additive branch (this sprint)** — `create-table` /
   `create-index` / `create-view` / `alter-table` with additive action.
4. DML branch (sprint-392) — `insert` / `update` / `delete`.
5. SELECT branch (sprint-393a / 393b) — `select` / `with` with SELECT
   inner.

The new DDL additive branch maps AST `kind` to safety classification:

- `kind="create-table"` → `kind="ddl-create"`, `severity="info"`,
  `reasons=[]`.
- `kind="create-index"` → `kind="ddl-create"`, `severity="info"`,
  `reasons=[]`.
- `kind="create-view"` → `kind="ddl-create"`, `severity="info"`,
  `reasons=[]`.
- `kind="alter-table"` with action `add-column` → `kind=
  "ddl-alter-add"`, `severity="warn"`, `reasons=["ALTER TABLE — ADD
  COLUMN (schema 변경)"]`.
- `kind="alter-table"` with action `add-constraint` → `kind=
  "ddl-alter-add"`, `severity="warn"`, `reasons=["ALTER TABLE — ADD
  CONSTRAINT (schema 변경)"]`.
- `kind="alter-table"` with action `rename-table` → `kind=
  "ddl-alter-rename"`, `severity="warn"`, `reasons=["ALTER TABLE —
  RENAME (이름 변경)"]`.
- `kind="alter-table"` with action `rename-column` → `kind=
  "ddl-alter-rename"`, `severity="warn"`, `reasons=["ALTER TABLE —
  RENAME COLUMN (이름 변경)"]`.

**Decision (D1)**: `OR REPLACE` on a view does not escalate severity.
A view that already exists has its body re-pointed, but no rows /
schema are touched. Severity stays `info`.

**Decision (D2)**: The `reasons` strings emitted by this sprint's new
branches are *pinned verbatim*. The exact strings are:

- ALTER TABLE … ADD COLUMN: `"ALTER TABLE — ADD COLUMN (schema 변경)"`.
- ALTER TABLE … ADD CONSTRAINT: `"ALTER TABLE — ADD CONSTRAINT (schema 변경)"`.
- ALTER TABLE … RENAME TO: `"ALTER TABLE — RENAME (이름 변경)"`.
- ALTER TABLE … RENAME COLUMN: `"ALTER TABLE — RENAME COLUMN (이름 변경)"`.

CREATE TABLE / CREATE INDEX / CREATE VIEW emit empty `reasons`
arrays. Reviewers must reject silent rewording or prefix changes.

**Decision (D3)**: When the AST `parseSqlPreloaded` returns an
`Error(...)` for a CREATE-shaped input (e.g. `CREATE FUNCTION foo()
RETURNS ...` which is out of scope for the AST parser), the safety
classifier falls back to the regex path on the original SQL string —
the same fallback contract as sprint-391 / sprint-392.

## Out of Scope

- **CREATE FUNCTION / PROCEDURE / TRIGGER / ROLE / EXTENSION** — these
  parse to `Error(SyntaxError)` at the AST level and are classified by
  the regex fast-path (`CREATE` followed by an unknown object → existing
  regex behavior).
- **CREATE TEMPORARY TABLE / UNLOGGED TABLE** — the `creation-mode`
  slot is fixed at `"persistent"` in this sprint; `TEMPORARY` /
  `UNLOGGED` parse to `Error(SyntaxError)`.
- **CREATE MATERIALIZED VIEW** — out of scope; the `MATERIALIZED`
  keyword is not lexed in this sprint.
- **Functional / expression indexes** (`CREATE INDEX … ON t (lower(a))`)
  — out of scope; index column list is identifier-only.
- **DEFAULT with function call** (`DEFAULT now()`) — the DEFAULT slot
  accepts only literal / placeholder values in this sprint; `DEFAULT
  <function-call>` parses to `Error(UnsupportedExpression)`. (The
  function-call expression is a future sprint.)
- **ALTER TABLE actions beyond ADD / RENAME** — `ALTER COLUMN TYPE`,
  `ALTER COLUMN SET DEFAULT`, `ALTER COLUMN DROP DEFAULT`,
  `ALTER COLUMN SET NOT NULL`, `ALTER COLUMN DROP NOT NULL`,
  `OWNER TO`, `SET TABLESPACE` — out of scope; they parse to
  `Error(SyntaxError)`.
- **`COMMENT ON COLUMN` / `COMMENT ON TABLE`** — sprint-395.
- **`GRANT` / `REVOKE`** — sprint-395.
- **Dialect-specific column types** (`MEDIUMINT`, `TINYINT`,
  `DATETIME`, `MONEY`, `BLOB`) — deferred to a dialect sprint.
- **`COLLATE` clauses** on column definitions — out of scope.

## Invariants

- The AST `ParseResult` union remains backwards-compatible — every
  prior sprint's variant continues to exist and serialize identically.
- All sprint-385 / 391 / 392 / 393a / 393b tests pass without
  modification.
- `analyzeStatement`'s return `StatementAnalysis` shape is unchanged.
  Existing sqlSafety tests remain green.
- The Rust crate continues to have no Tauri / tokio / IO dependency.
- No `unwrap()` / `expect()` on user-input paths.
- TS facade uses `unknown` + runtime guards; no `any`.
- WASM bundle size: ≤ sprint-393b gzipped size × 1.4.
- `OR REPLACE` does not escalate the safety classification (per D1).
- TEMPORARY / UNLOGGED variants of CREATE TABLE remain
  `Error(SyntaxError)` in this sprint — reviewers must reject any
  silent acceptance with a stub AST value.

## Acceptance Criteria

### T — CREATE TABLE (AC-394-T)

- `AC-394-T01` Statement `CREATE TABLE users (id INTEGER, name TEXT)`
  parses with top-level `kind="create-table"`, `if_not_exists=false`,
  a `columns` list of length 2, and `table_constraints` empty.
- `AC-394-T02` Statement `CREATE TABLE IF NOT EXISTS users (id
  INTEGER)` parses with `if_not_exists=true`.
- `AC-394-T03` Statement `CREATE TABLE public.users (id INTEGER)`
  parses with the table reference's schema slot `"public"` and table
  slot `"users"`.
- `AC-394-T04` Statement `CREATE TABLE t (a VARCHAR(255))` parses with
  column type `kind="varchar"` and length `255`.
- `AC-394-T05` Statement `CREATE TABLE t (a NUMERIC(10, 2))` parses
  with column type `kind="numeric"`, precision `10`, scale `2`.
- `AC-394-T06` Statement `CREATE TABLE t (a NUMERIC(10))` parses with
  column type `kind="numeric"`, precision `10`, scale null.
- `AC-394-T07` Statement `CREATE TABLE t (a NUMERIC)` parses with
  column type `kind="numeric"`, precision and scale both null.
- `AC-394-T08` Statement `CREATE TABLE t (a TIMESTAMP)` parses with
  column type `kind="timestamp"`, `with_time_zone=false`.
- `AC-394-T09` Statement `CREATE TABLE t (a TIMESTAMP WITH TIME
  ZONE)` parses with `with_time_zone=true`.
- `AC-394-T10` Statement `CREATE TABLE t (a UUID PRIMARY KEY)` parses
  with the column's `constraints` list containing one entry
  `kind="primary-key"`.
- `AC-394-T11` Statement `CREATE TABLE t (a INTEGER NOT NULL DEFAULT
  0)` parses with two column constraints in input order
  (`not-null` then `default`), the DEFAULT value being the integer
  literal `0`.
- `AC-394-T12` Statement `CREATE TABLE t (a INTEGER UNIQUE)` parses
  with column constraint `kind="unique"`.
- `AC-394-T13` Statement `CREATE TABLE t (a INTEGER REFERENCES other)`
  parses with column constraint `kind="references"`, target table
  `"other"`, target column null.
- `AC-394-T14` Statement `CREATE TABLE t (a INTEGER REFERENCES
  other(id))` parses with target column `"id"`.
- `AC-394-T15` Statement `CREATE TABLE t (a INTEGER CHECK (a > 0))`
  parses with column constraint `kind="check"` carrying a WHERE-style
  expression of `kind="comparison"`.
- `AC-394-T16` Statement `CREATE TABLE t (a INTEGER, PRIMARY KEY
  (a))` parses with the table-constraint list of length 1 (table-
  level `primary-key` with columns list `["a"]`).
- `AC-394-T17` Statement `CREATE TABLE t (a INTEGER, b INTEGER,
  UNIQUE (a, b))` parses with table-level `unique` with columns list
  `["a", "b"]`.
- `AC-394-T18` Statement `CREATE TABLE t (a INTEGER, FOREIGN KEY (a)
  REFERENCES other(id))` parses with table-level `references` with
  columns list `["a"]`, target table `"other"`, target column `"id"`.
- `AC-394-T19` Statement `CREATE TABLE t (a INTEGER, CONSTRAINT pk
  PRIMARY KEY (a))` parses with the table-level constraint's name
  slot set to `"pk"`.
- `AC-394-T20` Statement `CREATE TABLE t ()` (empty definition list)
  parses as `Error(SyntaxError)`.
- `AC-394-T21` Statement `CREATE TABLE t (a INT4)` (unknown type)
  parses as `Error(SyntaxError)`.
- `AC-394-T22` Statement `CREATE TABLE` (no name) parses as
  `Error(SyntaxError)`.
- `AC-394-T23` Statement `CREATE TEMPORARY TABLE t (a INTEGER)`
  parses as `Error(SyntaxError)` — TEMPORARY is out of scope.
- `AC-394-T24` Case-insensitive variants (`create table users (id
  integer)`) parse identically to the all-uppercase form.

### I — CREATE INDEX (AC-394-I)

- `AC-394-I01` Statement `CREATE INDEX idx ON users (email)` parses
  with `kind="create-index"`, `unique=false`, `if_not_exists=false`,
  name `"idx"`, table `"users"`, columns list `["email"]`.
- `AC-394-I02` Statement `CREATE UNIQUE INDEX idx ON users (email)`
  parses with `unique=true`.
- `AC-394-I03` Statement `CREATE INDEX IF NOT EXISTS idx ON users
  (email)` parses with `if_not_exists=true`.
- `AC-394-I04` Statement `CREATE INDEX idx ON public.users (a, b)`
  parses with schema-qualified table reference and column list
  `["a", "b"]`.
- `AC-394-I05` Statement `CREATE INDEX idx ON users ()` (empty column
  list) parses as `Error(SyntaxError)`.
- `AC-394-I06` Statement `CREATE INDEX idx ON users (lower(a))`
  (expression-index) parses as `Error(SyntaxError)`.

### V — CREATE VIEW (AC-394-V)

- `AC-394-V01` Statement `CREATE VIEW v_active AS SELECT * FROM users
  WHERE active = 1` parses with `kind="create-view"`,
  `or_replace=false`, name `"v_active"`, body of `kind="select"`.
- `AC-394-V02` Statement `CREATE OR REPLACE VIEW v AS SELECT * FROM
  users` parses with `or_replace=true`.
- `AC-394-V03` Statement `CREATE VIEW public.v AS SELECT * FROM x`
  parses with schema-qualified view name.
- `AC-394-V04` Statement `CREATE VIEW v AS WITH t AS (SELECT 1)
  SELECT * FROM t` parses with body `kind="with"` (CTE-wrap inside
  the view body).
- `AC-394-V05` Statement `CREATE VIEW v AS SELECT a FROM x UNION
  SELECT a FROM y` parses with body `kind="select"` and a populated
  `set_operation` list.
- `AC-394-V06` Statement `CREATE VIEW v` (no body) parses as
  `Error(SyntaxError)`.
- `AC-394-V07` Statement `CREATE MATERIALIZED VIEW v AS SELECT 1`
  parses as `Error(SyntaxError)`.

### A — ALTER TABLE additive (AC-394-A)

- `AC-394-A01` Statement `ALTER TABLE users ADD COLUMN email TEXT`
  parses with `kind="alter-table"`, action `kind="add-column"`,
  `if_not_exists=false`, the column's `name="email"` and type
  `kind="text"`.
- `AC-394-A02` Statement `ALTER TABLE users ADD COLUMN IF NOT EXISTS
  email TEXT` parses with `if_not_exists=true`.
- `AC-394-A03` Statement `ALTER TABLE users ADD COLUMN age INTEGER
  NOT NULL DEFAULT 0` parses with the column's `constraints` list of
  length 2 in input order.
- `AC-394-A04` Statement `ALTER TABLE users ADD CONSTRAINT users_pk
  PRIMARY KEY (id)` parses with action `kind="add-constraint"`
  carrying a table-level `primary-key` constraint with name
  `"users_pk"` and columns list `["id"]`.
- `AC-394-A05` Statement `ALTER TABLE users ADD UNIQUE (email)`
  (anonymous constraint) parses with action `kind="add-constraint"`
  carrying a constraint whose name slot is null.
- `AC-394-A06` Statement `ALTER TABLE users RENAME TO members` parses
  with action `kind="rename-table"` and `new_name="members"`.
- `AC-394-A07` Statement `ALTER TABLE users RENAME COLUMN email TO
  email_address` parses with action `kind="rename-column"`,
  `old_name="email"`, `new_name="email_address"`.
- `AC-394-A08` Statement `ALTER TABLE users ADD COLUMN` (no name)
  parses as `Error(SyntaxError)`.
- `AC-394-A09` Statement `ALTER TABLE users RENAME` (no target)
  parses as `Error(SyntaxError)`.
- `AC-394-A10` Statement `ALTER TABLE users ALTER COLUMN email TYPE
  VARCHAR(255)` parses as `Error(SyntaxError)` — out of scope.
- `AC-394-A11` Case-insensitive variants parse identically.

### S — Serialization (AC-394-S)

- `AC-394-S01` A `create-table` parse serializes with top-level
  `kind="create-table"` and the documented slots (`table`,
  `if_not_exists`, `columns`, `table_constraints`).
- `AC-394-S02` Column type variants serialize with the documented
  kebab-case `kind` discriminators (`integer`, `bigint`, `varchar`,
  `text`, `timestamp`, `date`, `boolean`, `numeric`, `serial`,
  `uuid`).
- `AC-394-S03` Column-level and table-level constraint variants
  serialize with the documented kebab-case `kind` discriminators
  (`primary-key`, `not-null`, `default`, `unique`, `references`,
  `check`).
- `AC-394-S04` `create-index` and `create-view` parses serialize with
  the documented slots.
- `AC-394-S05` `alter-table` parses with the four new action variants
  serialize with `action.kind` set to `add-column`, `add-constraint`,
  `rename-table`, `rename-column` respectively.
- `AC-394-S06` Every new AST variant round-trips through serde
  `to_string` → `from_str` and compares equal.

### F — TS facade (AC-394-F)

- `AC-394-F01` `parseSql("CREATE TABLE users (id INTEGER, name TEXT)")`
  resolves to a value whose `kind` is `"create-table"` and whose
  `columns` list has length 2.
- `AC-394-F02` `parseSql("CREATE UNIQUE INDEX idx ON users (email)")`
  resolves to `kind="create-index"`, `unique=true`.
- `AC-394-F03` `parseSql("CREATE OR REPLACE VIEW v AS SELECT 1")`
  resolves to `kind="create-view"`, `or_replace=true`.
- `AC-394-F04` `parseSql("ALTER TABLE users ADD COLUMN email TEXT")`
  resolves to `kind="alter-table"` with `action.kind="add-column"`.
- `AC-394-F05` `parseSql("ALTER TABLE users RENAME TO members")`
  resolves with `action.kind="rename-table"`.
- `AC-394-F06` `parseSqlPreloaded` returns each of the new top-level
  shapes synchronously once preloaded; returns null when not
  preloaded.
- `AC-394-F07` The runtime guard `isSqlParseResult` accepts the new
  top-level `kind`s and the new column-type / constraint
  discriminators without throwing.

### X — sqlSafety integration (AC-394-X)

- `AC-394-X01` `analyzeStatement("CREATE TABLE t (a INTEGER)")`
  returns `kind="ddl-create"`, `severity="info"`, `reasons=[]`.
- `AC-394-X02` `analyzeStatement("CREATE INDEX idx ON t (a)")`
  returns `kind="ddl-create"`, `severity="info"`, `reasons=[]`.
- `AC-394-X03` `analyzeStatement("CREATE VIEW v AS SELECT * FROM t")`
  returns `kind="ddl-create"`, `severity="info"`, `reasons=[]`.
- `AC-394-X04` `analyzeStatement("CREATE OR REPLACE VIEW v AS SELECT
  * FROM t")` returns the same triple as plain CREATE VIEW (no
  escalation per D1).
- `AC-394-X05` `analyzeStatement("ALTER TABLE t ADD COLUMN c TEXT")`
  returns `kind="ddl-alter-add"`, `severity="warn"`,
  `reasons=["ALTER TABLE — ADD COLUMN (schema 변경)"]` (pinned per
  D2).
- `AC-394-X06` `analyzeStatement("ALTER TABLE t ADD CONSTRAINT pk
  PRIMARY KEY (id)")` returns `kind="ddl-alter-add"`,
  `severity="warn"`, `reasons=["ALTER TABLE — ADD CONSTRAINT
  (schema 변경)"]` (pinned).
- `AC-394-X07` `analyzeStatement("ALTER TABLE t RENAME TO t2")`
  returns `kind="ddl-alter-rename"`, `severity="warn"`,
  `reasons=["ALTER TABLE — RENAME (이름 변경)"]` (pinned).
- `AC-394-X08` `analyzeStatement("ALTER TABLE t RENAME COLUMN a TO
  b")` returns `kind="ddl-alter-rename"`, `severity="warn"`,
  `reasons=["ALTER TABLE — RENAME COLUMN (이름 변경)"]` (pinned).
- `AC-394-X09` `analyzeStatement("CREATE FUNCTION foo() RETURNS
  void AS $$ ... $$ LANGUAGE plpgsql")` falls back to regex
  classification (`ddl-create` / `severity="info"` from the existing
  regex path) — verifies the regex fallback contract D3.
- `AC-394-X10` The existing sqlSafety test suite passes unchanged
  (regression count zero).
- `AC-394-X11` The return `StatementAnalysis` shape is unchanged.

### Verification (AC-394-V)

- `AC-394-Ve01` `cargo test` inside `src-tauri/sql-parser-core`
  passes, with the prior sprints' baseline tests still green and at
  least 80 new tests added (covering T + I + V + A + S).
- `AC-394-Ve02` `cargo test --test parse_sql_backend` passes;
  baseline regression count zero.
- `AC-394-Ve03` `pnpm vitest run` passes; the post-sprint count
  exceeds the pre-sprint count by at least the new facade +
  sqlSafety tests (≥ 14).
- `AC-394-Ve04` `pnpm tsc --noEmit` reports 0 errors.
- `AC-394-Ve05` `pnpm lint` reports 0 errors.
- `AC-394-Ve06` `cargo clippy --all-targets --all-features -- -D
  warnings` is clean.
- `AC-394-Ve07` `pnpm build:sql-wasm` succeeds and the gzipped
  output is no larger than the sprint-393b gzipped output × 1.4.

## Design Bar / Quality Bar

- Hand-written recursive-descent retained.
- No `unwrap()` / `expect()` on user-input paths.
- TS facade uses `unknown` + guard; no `any`.
- `parseSqlPreloaded` continues to be pure-sync, exception-free.
- The sqlSafety `reasons` strings are *pinned verbatim* (decision
  D2). Reviewers must reject silent rewording.
- The column-type allowlist is an *explicit* set in both lexer and
  AST. Adding a new type in a future sprint must be a deliberate
  change, not an accidental side-effect of relaxed lexing.

## Verification Plan

### Required commands

1. `cd src-tauri/sql-parser-core && cargo test` — all green.
2. `cd src-tauri && cargo test --test parse_sql_backend` —
   regression zero.
3. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — clean.
4. `pnpm build:sql-wasm` — succeeds; gzipped measured.
5. `pnpm vitest run` — all green.
6. `pnpm tsc --noEmit` — 0 errors.
7. `pnpm lint` — 0 errors.

### Required evidence

- Rust unit test new count (≥ 80 across T + I + V + A + S).
- TS facade test new count (≥ 7 across F).
- sqlSafety integration test new count (≥ 9 across X — covers all
  classification rules + regex fallback).
- WASM gzipped size after this sprint vs. sprint-393b baseline.

## Test Requirements

- Rust unit tests: ≥ 80 newly added.
- TS facade tests: ≥ 7 newly added.
- sqlSafety integration tests: ≥ 9 newly added; existing regression
  count zero.
- Vitest baseline delta strictly positive.

## Ownership

- Generator: general-purpose Agent (sprint-394).
- Write scope: items listed under In Scope.
- Merge order: builds on sprint-393b. sprint-395 follows.

## Exit Criteria

- Open P1 / P2: 0.
- AC PASS counts: T 24 + I 6 + V 7 + A 11 + S 6 + F 7 + X 11 +
  Ve 7 = **79 AC**.
- Pre-commit and pre-push hooks green.
- PR open and linked.

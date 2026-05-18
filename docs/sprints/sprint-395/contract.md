# Sprint Contract: sprint-395

## Summary

- Goal: **SQL misc grammar — GRANT / REVOKE / EXPLAIN / SHOW / SET /
  COPY / COMMENT** — close the remaining regex-classified statement
  kinds by extending the AST grammar and migrating the corresponding
  sqlSafety classifications. After this sprint the AST branch covers
  every safety classification in `analyzeStatement`, and the regex
  fast-path is retained only as a defensive fallback for inputs that
  cannot be parsed (or when the WASM module has not been preloaded).
- Audience: Tooling that depends on classifying mixed statement
  streams (database admin scripts, migration batches) gains AST-level
  insight into permission changes, data-movement statements
  (`COPY`), and the inner statement of an `EXPLAIN`. The migration
  itself does *not* change behavior visible to end users — the
  return shapes of `analyzeStatement` are pinned.
- Owner: Generator (sprint-395).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm
  lint) + `backend` (`cargo test`, `cargo clippy --all-targets
  --all-features -D warnings`, `cargo build --target
  wasm32-unknown-unknown --release --features wasm`).

## Background

- After sprint-394, the regex fast-path in `src/lib/sql/sqlSafety.ts`
  still handles GRANT, REVOKE, EXPLAIN, SHOW, SET, COPY, and COMMENT.
  These are stylistically heterogeneous: GRANT / REVOKE are
  permission changes (warn-level), EXPLAIN wraps another statement
  (severity inherited from the inner statement), SHOW / SET are
  configuration reads / writes (info-level), COPY moves data between
  files and tables (warn-level — bulk data movement), and COMMENT
  is purely metadata (info-level).
- The safety classifications introduced by this sprint:
  - `permission-change` — `severity: warn`. GRANT and REVOKE both
    classify here.
  - `inherited` — *no new safety kind*. EXPLAIN inherits the inner
    statement's `kind`, `severity`, and `reasons` (similar to
    sprint-393b's CTE-wrap rule). The outer EXPLAIN does not change
    the classification — it only "passes through".
  - `config-read` — `severity: info`. SHOW classifies here.
  - `config-write` — `severity: info`. SET classifies here.
  - `data-movement` — `severity: warn`. COPY (both directions —
    `FROM` and `TO`) classifies here.
  - `metadata` — `severity: info`. COMMENT classifies here.
- The existing regex fast-path remains as a fallback for any input
  that the AST parser rejects. The same fallback contract from
  sprint-391 onward applies: when `parseSqlPreloaded` returns
  `Error(...)` or null, the regex path runs.

## In Scope

### Lexer additions

The lexer gains the following new case-insensitive keyword tokens.

- Permission: `GRANT`, `REVOKE`, `PRIVILEGES`, `ALL`, `SELECT`,
  `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`,
  `TRIGGER`, `USAGE`, `EXECUTE`, `OPTION` (most of these are
  already keywords in prior sprints — only those missing are added).
- EXPLAIN family: `EXPLAIN`, `ANALYZE`, `VERBOSE`, `FORMAT`. The
  `(option ...)` parenthesized form is recognized — see Parser.
- Configuration: `SHOW`, `SET`, `DATABASES`, `TABLES`, `SCHEMAS`,
  `SESSION`, `LOCAL`.
- Data movement: `COPY`, `STDIN`, `STDOUT`, `DELIMITER`, `CSV`,
  `HEADER`.
- Comment: `COMMENT`, `IS`, `ON` (already lexed — reused).
- Object-kind tokens for COMMENT: `COLUMN` (already lexed),
  `INDEX` (already lexed), `SCHEMA` (already lexed), `SEQUENCE`
  (already lexed), `VIEW` (already lexed), `TABLE` (already
  lexed), `DATABASE` (already lexed).

### AST additions (natural-language spec)

The `ParseResult` discriminated union gains seven new top-level
variants. Discriminator names are kebab-case.

- **GRANT statement.** Top-level `kind="grant"` carries: a
  `privileges` slot (an ordered list of privilege tags — see below),
  an `object` slot (a discriminated union describing the grant
  target), a `grantees` slot (an ordered list of role-or-public
  references), and a `with_grant_option` boolean (true when `WITH
  GRANT OPTION` was present).
- **REVOKE statement.** Top-level `kind="revoke"` mirrors the GRANT
  shape with one addition: a `grant_option_for` boolean (true when
  `REVOKE GRANT OPTION FOR ...` was used; the revoke targets only
  the grant-option flag, not the privilege itself). The `grantees`
  slot is renamed `revokees` to avoid confusion. A `cascade` slot
  records whether `CASCADE` or `RESTRICT` was supplied — the same
  `CascadeBehavior` discriminated union introduced by sprint-391 is
  reused.
- **Privilege tag.** A discriminated union with `kind` tags: `all`
  (representing `ALL` or `ALL PRIVILEGES` — they are normalized to
  the same tag), `select`, `insert`, `update`, `delete`, `truncate`,
  `references`, `trigger`, `usage`, `execute`. UPDATE / SELECT /
  REFERENCES that name specific columns (`GRANT UPDATE (col1, col2)
  ON ...`) carry an extra `columns` slot (ordered list of column
  names; empty when the privilege applies to all columns of the
  table).
- **GRANT/REVOKE object.** A discriminated union with `kind` tags:
  - `table` (carrying a `tables` slot — an ordered list of schema-
    qualified table references; the keyword `TABLE` is optional in
    the source, but the AST always tags `kind="table"` for grants on
    one or more tables).
  - `schema` (carrying a `schemas` slot — an ordered list of schema
    names).
  - `database` (carrying a `databases` slot — same).
  - `sequence` (carrying a `sequences` slot — same).
  - `function` (carrying a `functions` slot — same). Function
    arguments are *not* parsed in this sprint — only the function
    name is recorded.
  - `all-in-schema` (carrying a `schema_name` slot — represents PG's
    `ALL TABLES IN SCHEMA name` shorthand; the parser distinguishes
    this from a plain `TABLE` target by the `ALL TABLES IN SCHEMA`
    token sequence).
- **EXPLAIN statement.** Top-level `kind="explain"` carries: an
  `analyze` boolean, a `verbose` boolean, an `options` ordered list
  of key/value pairs (each pair has `name: string` and `value:
  InsertValue`; the value uses the sprint-392 literal-or-placeholder
  shape), and an `inner_statement` slot of nested `ParseResult`
  (any of `select`, `insert`, `update`, `delete`, `with`, or any of
  the new top-level kinds introduced by sprint-394 — though
  `EXPLAIN CREATE TABLE` is not standard SQL and the parser may
  return `Error(SyntaxError)` for non-DML/non-SELECT inner; the AST
  type permits the union, but the parser enforces what is sensible).
- **SHOW statement.** Top-level `kind="show"` carries: a `target`
  slot that is a discriminated union with `kind` tags:
  - `variable` (carrying a `name` string — `SHOW search_path`).
  - `tables` (carrying an optional `schema` slot — `SHOW TABLES`
    or `SHOW TABLES IN schema_name`).
  - `databases` (no extra slots — `SHOW DATABASES`).
  - `schemas` (no extra slots — `SHOW SCHEMAS`).
- **SET statement.** Top-level `kind="set"` carries: a `scope` slot
  (kebab-case tag `session`, `local`, or `default` — `default` when
  neither `SESSION` nor `LOCAL` was specified), a `name` slot
  (string — the variable name), and a `value` slot. The value is a
  discriminated union with `kind` tags `literal` (carrying the sprint-
  392 `SqlLiteral` shape — integer / float / string / boolean / null),
  `default` (representing the `DEFAULT` keyword), and `identifier`
  (carrying a `name` string — for bare-identifier RHS such as `SET
  search_path = public`). The `identifier` variant is NOT a reuse of
  the sprint-392 `InsertValue::Placeholder` — keeping the two shapes
  distinct prevents downstream tooling from treating SET values as
  parameter placeholders.
- **COPY statement.** Top-level `kind="copy"` carries: a `direction`
  slot (kebab-case tag `from` or `to`), a `target` slot (a
  discriminated union — either `kind="table"` carrying a schema-
  qualified table reference and an optional ordered column list, or
  `kind="select"` carrying a nested SELECT — `COPY (SELECT ...) TO
  ...` is supported), a `source` slot (a discriminated union with
  `kind` tags `file` carrying a `path` string, `stdin` (no fields),
  or `stdout` (no fields)), and an `options` slot (ordered list of
  key/value pairs in the same shape as EXPLAIN options).
- **COMMENT statement.** Top-level `kind="comment"` carries: a
  `target` slot (a discriminated union with `kind` tags `table`,
  `column`, `view`, `index`, `schema`, `sequence`, `database`, and
  `constraint` — each carrying the relevant identifiers; `column`
  carries `table` and `column` slots, `constraint` carries `table`
  and `constraint` slots), and a `text` slot — either a string
  literal or the literal token `NULL` (recorded as the kebab-case
  string `"null"`).

The privilege list, object list, role list, and option list are all
serialized in input order; reviewers must reject any normalization
that re-orders them.

### Parser additions

- **GRANT / REVOKE parser.** Both share the privilege-list and object
  parsers. The privilege list accepts `ALL [PRIVILEGES]` or a comma-
  separated list of named privileges. The object parser dispatches
  on the object-kind keyword (`TABLE` / `SEQUENCE` / `FUNCTION` /
  `SCHEMA` / `DATABASE`, plus the `ALL TABLES IN SCHEMA` shorthand
  with a peek-ahead). The grantee list accepts `PUBLIC`, role
  identifiers, or `CURRENT_USER` / `SESSION_USER` (the latter two
  are normalized as role-references with a `well-known` sub-tag —
  details captured by the implementer's test, not pinned by AC).
  The `WITH GRANT OPTION` trailer and the `CASCADE` / `RESTRICT`
  trailer (REVOKE only) are recognized.
- **EXPLAIN parser.** Accepts the keyword sequence
  `EXPLAIN [ANALYZE] [VERBOSE] [(option_name option_value, ...)]
  inner-statement`. The parenthesized option list is comma-
  separated; each option is a name followed by a value. The inner-
  statement is parsed by re-entering the top-level dispatcher; any
  statement form that parses to a recognized AST kind is permitted.
  An inner statement that itself errors propagates the error to
  the top level (the EXPLAIN wrapper is not preserved with an
  inner-error slot — the input is treated as a parse failure).
- **SHOW parser.** Accepts `SHOW <variable-name>`, `SHOW TABLES [IN
  schema]`, `SHOW DATABASES`, `SHOW SCHEMAS`. The variable-name
  position accepts dotted identifiers (`SHOW search_path` /
  `SHOW datestyle`).
- **SET parser.** Accepts `SET [SESSION|LOCAL] <name> {TO|=}
  <value>`. The value position accepts a literal (recorded with the
  SET-specific `literal` kind tag wrapping the sprint-392
  `SqlLiteral`), the keyword `DEFAULT` (recorded as `kind="default"`),
  or a bare identifier (recorded as `kind="identifier"` with the
  identifier as the `name` slot). The SET-specific value union is
  documented above under "SET statement" — it is intentionally
  distinct from the sprint-392 `InsertValue` shape so that bare
  identifier RHSes do not pollute the placeholder surface used by
  DML/SELECT.
- **COPY parser.** Accepts both directions:
  `COPY <table-or-subquery> [(col1, col2)] FROM <source> [options]`
  and `COPY <table> [(cols)] TO <source> [options]`. The source is
  `STDIN` (only valid with `FROM`), `STDOUT` (only valid with
  `TO`), or a single-quoted file-path string literal. The
  parenthesized options list mirrors the EXPLAIN options shape.
  `COPY (SELECT ...) TO ...` is supported as a subquery target;
  `COPY (SELECT ...) FROM ...` is rejected as `Error(SyntaxError)`.
- **COMMENT parser.** Accepts `COMMENT ON <object-kind> <ident>
  IS <string-or-NULL>`. The object-kind keyword routes the target
  variant. For `COMMENT ON COLUMN <table>.<column>` the parser
  splits the dotted identifier; if no dot is present in the COLUMN
  case, the parser returns `Error(SyntaxError)`. For `COMMENT ON
  CONSTRAINT <constraint> ON <table>` the parser recognizes the
  PG-specific `ON <table>` trailer (the constraint variant carries
  both slots).

### TS facade updates

`src/lib/sql/sqlAst.ts` extends as follows:

- Seven new top-level union members corresponding to the new AST
  variants: `SqlGrantStatement`, `SqlRevokeStatement`,
  `SqlExplainStatement`, `SqlShowStatement`, `SqlSetStatement`,
  `SqlCopyStatement`, `SqlCommentStatement`.
- New sub-shapes for privilege tag, GRANT/REVOKE object,
  EXPLAIN/COPY options, SHOW target, COPY source, COMMENT target.
- The runtime guard `isSqlParseResult` accepts each new top-level
  `kind` and each new discriminated-union sub-shape without
  throwing.

`parseSql` / `parseSqlPreloaded` keep their existing surfaces.

### sqlSafety integration

`src/lib/sql/sqlSafety.ts` callsite ordering after this sprint
(top-to-bottom; first match wins):

1. CTE-wrap branch (sprint-393b) — delegate to inner.
2. EXPLAIN-wrap branch (this sprint) — delegate to inner.
3. DDL destructive branch (sprint-391).
4. DDL additive branch (sprint-394).
5. **New: permission branch (this sprint)** — `grant` / `revoke`.
6. DML branch (sprint-392).
7. SELECT branch (sprint-393a / 393b).
8. **New: misc branches (this sprint)** — `show` / `set` / `copy` /
   `comment`.

The new branches map AST `kind` to safety classification:

- `kind="grant"` → `kind="permission-change"`, `severity="warn"`,
  `reasons=["GRANT — 권한 변경"]`.
- `kind="revoke"` → `kind="permission-change"`, `severity="warn"`,
  `reasons=["REVOKE — 권한 변경"]`.
- `kind="explain"` → classification of `inner_statement`; if the
  inner statement is itself unclassified or `Error(...)`, fall back
  to the regex path on the original SQL string.
- `kind="show"` → `kind="config-read"`, `severity="info"`,
  `reasons=[]`.
- `kind="set"` → `kind="config-write"`, `severity="info"`,
  `reasons=[]`.
- `kind="copy"` with `direction="from"` → `kind="data-movement"`,
  `severity="warn"`, `reasons=["COPY FROM — 대량 import"]`.
- `kind="copy"` with `direction="to"` → `kind="data-movement"`,
  `severity="warn"`, `reasons=["COPY TO — 대량 export"]`.
- `kind="comment"` → `kind="metadata"`, `severity="info"`,
  `reasons=[]`.

**Decision (D1)**: EXPLAIN's classification *inherits* the inner
statement's `kind` / `severity` / `reasons` verbatim, like the
sprint-393b CTE-wrap rule. The outer EXPLAIN does not append any
new reason or escalate severity. This keeps the safety surface
predictable when a user runs `EXPLAIN DELETE FROM …`.

**Decision (D2)**: COPY's direction *does not* escalate severity
between `FROM` and `TO`. Both are warn-level. The `reasons` strings
differ to surface the intent to the user.

**Decision (D3)**: SET's `severity` is `info`, not `warn`. This
reflects that `SET search_path = …` is a per-session configuration
change with no row impact. If a future sprint introduces a list of
"sensitive" SET targets that should escalate to `warn`, that is a
new decision in a new sprint.

**Decision (D4)**: SHOW DATABASES / SHOW TABLES classify the same
as `SHOW <variable>` — `config-read` / `info`. The classifier does
not distinguish between the target variants for safety purposes.

**Decision (D5)**: The new `reasons` strings are *pinned verbatim*
across all AC tests. The exact strings are:

- GRANT: `"GRANT — 권한 변경"`.
- REVOKE: `"REVOKE — 권한 변경"`.
- COPY FROM: `"COPY FROM — 대량 import"`.
- COPY TO: `"COPY TO — 대량 export"`.

(Korean prefix mirrors the sprint-392 / sprint-394 reason style of
the existing sqlSafety surface — verifiable by grepping the
existing reasons in `src/lib/sql/sqlSafety.ts`.) SHOW / SET /
COMMENT classifications emit empty `reasons` arrays. EXPLAIN
inherits its inner statement's `reasons` verbatim (D1) and does
not append anything. Reviewers must reject silent rewording or
prefix changes.

## Out of Scope

- **REASSIGN OWNED** / **DROP OWNED** — out of scope; these parse to
  `Error(SyntaxError)` and remain regex-classified (or
  unclassified — they were not previously regex-handled and are
  outside the safety classifier's existing surface).
- **CREATE ROLE / DROP ROLE / ALTER ROLE** — out of scope.
- **PG `\copy` (psql meta-command)** — not SQL; out of scope.
- **MySQL `LOAD DATA INFILE`** — different syntax from `COPY`; out
  of scope.
- **`PREPARE` / `EXECUTE` (PG prepared-statement DDL)** — out of
  scope.
- **`BEGIN` / `COMMIT` / `ROLLBACK` / `SAVEPOINT`** — out of scope;
  transaction-control statements remain regex-classified (existing
  behavior; not migrated by this sprint).
- **`LOCK TABLE` / `UNLOCK TABLES`** — out of scope.
- **EXPLAIN inner-statement that is itself out-of-scope** (e.g.
  `EXPLAIN BEGIN`) — the AST parser returns `Error(SyntaxError)`
  and the regex fallback handles classification.
- **Dialect-specific extensions** (PG `EXPLAIN (FORMAT JSON)`
  format-string values, MySQL `EXPLAIN FORMAT=TREE`) — the
  parenthesized options list accepts the *shape* of `(name value,
  ...)` but does not validate option names or values; an unknown
  option name still parses successfully (the AST stores the
  name/value pair opaquely).
- **GRANT/REVOKE column-level for INSERT / DELETE / TRIGGER** —
  only the standardly column-applicable privileges (UPDATE,
  SELECT, REFERENCES) accept the `(columns)` qualifier. Attempting
  the column qualifier on other privileges parses to
  `Error(SyntaxError)`.

## Invariants

- The AST `ParseResult` union remains backwards-compatible — every
  prior sprint's variant continues to exist and serialize
  identically.
- All sprint-385 / 391 / 392 / 393a / 393b / 394 tests pass without
  modification.
- `analyzeStatement`'s return `StatementAnalysis` shape is
  unchanged.
- The Rust crate continues to have no Tauri / tokio / IO
  dependency.
- No `unwrap()` / `expect()` on user-input paths.
- TS facade uses `unknown` + runtime guards; no `any`.
- WASM bundle size: ≤ sprint-394 gzipped size × 1.3.
- The EXPLAIN-wrap branch must short-circuit cleanly when the
  inner statement is `Error(...)` — fall back to regex (D1).
- The new `reasons` strings are pinned (D5); reviewers must reject
  silent rewording.
- Branch ordering in `sqlSafety` is documented above (CTE-wrap →
  EXPLAIN-wrap → DDL destructive → DDL additive → permission →
  DML → SELECT → misc); reviewers must verify the ordering by
  reading the patched file.

## Acceptance Criteria

### G — GRANT (AC-395-G)

- `AC-395-G01` Statement `GRANT SELECT ON users TO alice` parses
  with `kind="grant"`, privileges list of length 1 (`kind=
  "select"`), object `kind="table"` with one table `"users"`,
  grantees list `["alice"]`, `with_grant_option=false`.
- `AC-395-G02` Statement `GRANT SELECT, INSERT ON users TO alice,
  bob` parses with privileges list of length 2 and grantees list
  of length 2, both in input order.
- `AC-395-G03` Statement `GRANT ALL ON users TO alice` parses with
  privilege list `[{kind: "all"}]`.
- `AC-395-G04` Statement `GRANT ALL PRIVILEGES ON users TO alice`
  parses identically to AC-395-G03 (`ALL` and `ALL PRIVILEGES`
  normalize to the same tag).
- `AC-395-G05` Statement `GRANT UPDATE (a, b) ON users TO alice`
  parses with the privilege's `columns` slot `["a", "b"]`.
- `AC-395-G06` Statement `GRANT INSERT (a) ON users TO alice`
  parses as `Error(SyntaxError)` (INSERT does not accept the
  column qualifier in this sprint).
- `AC-395-G07` Statement `GRANT USAGE ON SCHEMA public TO alice`
  parses with object `kind="schema"`, schemas list `["public"]`.
- `AC-395-G08` Statement `GRANT SELECT ON ALL TABLES IN SCHEMA
  public TO alice` parses with object `kind="all-in-schema"`,
  `schema_name="public"`.
- `AC-395-G09` Statement `GRANT EXECUTE ON FUNCTION foo TO alice`
  parses with object `kind="function"`, functions list `["foo"]`.
- `AC-395-G10` Statement `GRANT SELECT ON users TO PUBLIC` parses
  with grantees list of length 1 whose single entry is a role
  reference with kebab-case `kind="public"` (the pseudo-role
  identifier). Plain identifier grantees (like `alice`) have
  `kind="role"` carrying a `name` slot; `PUBLIC` does not collapse
  into the role-by-name path.
- `AC-395-G11` Statement `GRANT SELECT ON users TO alice WITH
  GRANT OPTION` parses with `with_grant_option=true`.
- `AC-395-G12` Statement `GRANT` (no privilege) parses as
  `Error(SyntaxError)`.
- `AC-395-G13` Case-insensitive variants parse identically.

### R — REVOKE (AC-395-R)

- `AC-395-R01` Statement `REVOKE SELECT ON users FROM alice`
  parses with `kind="revoke"`, the same privilege / object / role
  shape as GRANT, `grant_option_for=false`, `cascade=None`.
- `AC-395-R02` Statement `REVOKE GRANT OPTION FOR SELECT ON
  users FROM alice` parses with `grant_option_for=true`.
- `AC-395-R03` Statement `REVOKE SELECT ON users FROM alice
  CASCADE` parses with `cascade=Some(Cascade)`.
- `AC-395-R04` Statement `REVOKE SELECT ON users FROM alice
  RESTRICT` parses with `cascade=Some(Restrict)`.
- `AC-395-R05` Statement `REVOKE ALL ON ALL TABLES IN SCHEMA
  public FROM alice` parses with privilege `kind="all"` and
  object `kind="all-in-schema"`.
- `AC-395-R06` Statement `REVOKE` (no privilege) parses as
  `Error(SyntaxError)`.
- `AC-395-R07` Case-insensitive variants parse identically.

### E — EXPLAIN (AC-395-E)

- `AC-395-E01` Statement `EXPLAIN SELECT * FROM users` parses with
  `kind="explain"`, `analyze=false`, `verbose=false`, options
  empty, `inner_statement.kind="select"`.
- `AC-395-E02` Statement `EXPLAIN ANALYZE SELECT * FROM users`
  parses with `analyze=true`.
- `AC-395-E03` Statement `EXPLAIN VERBOSE SELECT * FROM users`
  parses with `verbose=true`.
- `AC-395-E04` Statement `EXPLAIN ANALYZE VERBOSE SELECT * FROM
  users` parses with both flags true.
- `AC-395-E05` Statement `EXPLAIN (ANALYZE true, FORMAT 'json')
  SELECT * FROM users` parses with options list of length 2. Option
  names are normalized to lowercase by the parser before recording
  in the AST — so the first option's `name` slot is the lowercase
  string `"analyze"` and the second's is `"format"`. The second
  option's value is the string literal `"json"`.
- `AC-395-E06` Statement `EXPLAIN DELETE FROM users WHERE id =
  1` parses with `inner_statement.kind="delete"`.
- `AC-395-E07` Statement `EXPLAIN BEGIN` parses as
  `Error(SyntaxError)` — the inner statement is out of scope.
- `AC-395-E08` Statement `EXPLAIN` (no inner) parses as
  `Error(SyntaxError)`.
- `AC-395-E09` Case-insensitive variants parse identically.

### H — SHOW (AC-395-H)

- `AC-395-H01` Statement `SHOW search_path` parses with `kind=
  "show"`, target `kind="variable"`, name `"search_path"`.
- `AC-395-H02` Statement `SHOW TABLES` parses with target
  `kind="tables"`, schema null.
- `AC-395-H03` Statement `SHOW TABLES IN public` parses with
  target `kind="tables"`, schema `"public"`.
- `AC-395-H04` Statement `SHOW DATABASES` parses with target
  `kind="databases"`.
- `AC-395-H05` Statement `SHOW SCHEMAS` parses with target
  `kind="schemas"`.
- `AC-395-H06` Statement `SHOW` (no target) parses as
  `Error(SyntaxError)`.

### T — SET (AC-395-T)

- `AC-395-T01` Statement `SET search_path = 'public'` parses with
  `kind="set"`, scope `"default"`, name `"search_path"`, value
  `kind="literal"` wrapping a `SqlLiteral` of kind `string` with
  payload `"public"`.
- `AC-395-T02` Statement `SET search_path TO 'public'` parses
  identically (TO and = are equivalent).
- `AC-395-T03` Statement `SET SESSION timezone = 'UTC'` parses
  with scope `"session"`.
- `AC-395-T04` Statement `SET LOCAL timezone = 'UTC'` parses with
  scope `"local"`.
- `AC-395-T05` Statement `SET search_path = DEFAULT` parses with
  value `kind="default"`.
- `AC-395-T06` Statement `SET search_path = public` (bare
  identifier value) parses with value `kind="identifier"`,
  `name="public"` (per the SET-specific value union).
- `AC-395-T07` Statement `SET` (no name) parses as
  `Error(SyntaxError)`.

### C — COPY (AC-395-C)

- `AC-395-C01` Statement `COPY users FROM '/tmp/users.csv'` parses
  with `kind="copy"`, direction `"from"`, target `kind="table"`
  with table `"users"` and columns list empty, source
  `kind="file"` path `/tmp/users.csv`, options empty.
- `AC-395-C02` Statement `COPY users (id, name) FROM
  '/tmp/users.csv'` parses with target columns list `["id",
  "name"]`.
- `AC-395-C03` Statement `COPY users TO STDOUT` parses with
  direction `"to"`, source `kind="stdout"`.
- `AC-395-C04` Statement `COPY users FROM STDIN` parses with
  direction `"from"`, source `kind="stdin"`.
- `AC-395-C05` Statement `COPY users TO STDIN` parses as
  `Error(SyntaxError)` (STDIN is FROM-only).
- `AC-395-C06` Statement `COPY users FROM STDOUT` parses as
  `Error(SyntaxError)` (STDOUT is TO-only).
- `AC-395-C07` Statement `COPY (SELECT * FROM users) TO
  '/tmp/users.csv'` parses with target `kind="select"` carrying
  a nested SELECT.
- `AC-395-C08` Statement `COPY (SELECT * FROM users) FROM
  '/tmp/users.csv'` parses as `Error(SyntaxError)` (subquery
  source is FROM-incompatible).
- `AC-395-C09` Statement `COPY users FROM '/tmp/users.csv' WITH
  (FORMAT csv, HEADER true)` parses with options list of length 2.
- `AC-395-C10` Case-insensitive variants parse identically.

### M — COMMENT (AC-395-M)

- `AC-395-M01` Statement `COMMENT ON TABLE users IS 'all users'`
  parses with `kind="comment"`, target `kind="table"` with table
  `"users"`, text the string `"all users"`.
- `AC-395-M02` Statement `COMMENT ON COLUMN users.email IS 'email
  address'` parses with target `kind="column"`, table `"users"`,
  column `"email"`.
- `AC-395-M03` Statement `COMMENT ON COLUMN email IS 'addr'`
  parses as `Error(SyntaxError)` (COLUMN target requires the
  dotted form).
- `AC-395-M04` Statement `COMMENT ON INDEX idx IS 'email
  lookup'` parses with target `kind="index"`.
- `AC-395-M05` Statement `COMMENT ON SCHEMA public IS 'main'`
  parses with target `kind="schema"`.
- `AC-395-M06` Statement `COMMENT ON CONSTRAINT users_pk ON
  users IS 'PK'` parses with target `kind="constraint"`, table
  `"users"`, constraint `"users_pk"`.
- `AC-395-M07` Statement `COMMENT ON TABLE users IS NULL` parses
  with text the kebab-case string `"null"`.
- `AC-395-M08` Statement `COMMENT ON FUNCTION foo IS '...'`
  parses as `Error(SyntaxError)` — FUNCTION target is out of
  scope for COMMENT in this sprint.

### S — Serialization (AC-395-S)

- `AC-395-S01` Every new top-level statement serializes with the
  documented kebab-case `kind` discriminator (`grant`, `revoke`,
  `explain`, `show`, `set`, `copy`, `comment`).
- `AC-395-S02` Every privilege tag, object variant, target
  variant, and source variant serializes with the documented
  kebab-case discriminator.
- `AC-395-S03` Every new AST variant round-trips through serde
  `to_string` → `from_str` and compares equal.

### F — TS facade (AC-395-F)

- `AC-395-F01` `parseSql("GRANT SELECT ON users TO alice")`
  resolves to `kind="grant"` with the documented shape.
- `AC-395-F02` `parseSql("REVOKE SELECT ON users FROM alice
  CASCADE")` resolves to `kind="revoke"` with cascade populated.
- `AC-395-F03` `parseSql("EXPLAIN ANALYZE SELECT * FROM users")`
  resolves to `kind="explain"` with `analyze=true` and
  `inner_statement.kind="select"`.
- `AC-395-F04` `parseSql("SHOW search_path")` resolves to `kind=
  "show"`.
- `AC-395-F05` `parseSql("SET timezone = 'UTC'")` resolves to
  `kind="set"`.
- `AC-395-F06` `parseSql("COPY users FROM '/tmp/users.csv'")`
  resolves to `kind="copy"` with direction `"from"`.
- `AC-395-F07` `parseSql("COMMENT ON TABLE users IS 'all'")`
  resolves to `kind="comment"`.
- `AC-395-F08` `parseSqlPreloaded` returns each new top-level
  shape synchronously once preloaded; returns null when not
  preloaded.
- `AC-395-F09` The runtime guard `isSqlParseResult` accepts each
  new top-level `kind` and each new discriminated-union sub-shape
  without throwing.

### X — sqlSafety integration (AC-395-X)

- `AC-395-X01` `analyzeStatement("GRANT SELECT ON users TO
  alice")` returns `kind="permission-change"`,
  `severity="warn"`, `reasons=["GRANT — 권한 변경"]` (pinned
  per D5).
- `AC-395-X02` `analyzeStatement("REVOKE SELECT ON users FROM
  alice")` returns `kind="permission-change"`,
  `severity="warn"`, `reasons=["REVOKE — 권한 변경"]` (pinned).
- `AC-395-X03` `analyzeStatement("EXPLAIN SELECT * FROM users")`
  returns `kind="select"`, `severity="info"`, `reasons=[]` —
  inherits from inner SELECT (D1).
- `AC-395-X04` `analyzeStatement("EXPLAIN DELETE FROM users")`
  returns `kind="dml-delete"`, `severity="danger"`, and the
  `reasons` list includes the sprint-392 "WHERE 없는 DELETE"
  string — verifying that the inner statement's reasons pass
  through verbatim.
- `AC-395-X05` `analyzeStatement("EXPLAIN ANALYZE UPDATE users
  SET a = 1 WHERE id = 1")` returns `kind="dml-update"`,
  `severity="danger"`, `reasons=[]` (the WHERE present, no
  missing-WHERE reason).
- `AC-395-X06` `analyzeStatement("SHOW search_path")` returns
  `kind="config-read"`, `severity="info"`, `reasons=[]`.
- `AC-395-X07` `analyzeStatement("SET timezone = 'UTC'")` returns
  `kind="config-write"`, `severity="info"`, `reasons=[]`.
- `AC-395-X08` `analyzeStatement("COPY users FROM '/tmp/u.csv'")`
  returns `kind="data-movement"`, `severity="warn"`,
  `reasons=["COPY FROM — 대량 import"]` (pinned).
- `AC-395-X09` `analyzeStatement("COPY users TO '/tmp/u.csv'")`
  returns `kind="data-movement"`, `severity="warn"`,
  `reasons=["COPY TO — 대량 export"]` (pinned).
- `AC-395-X10` `analyzeStatement("COMMENT ON TABLE users IS
  'all'")` returns `kind="metadata"`, `severity="info"`,
  `reasons=[]`.
- `AC-395-X11` `analyzeStatement("EXPLAIN BEGIN")` falls back to
  the regex path on the original SQL string — verifying the
  fallback contract.
- `AC-395-X12` The existing sqlSafety test suite passes
  unchanged (regression count zero).
- `AC-395-X13` The return `StatementAnalysis` shape is unchanged.

### V — Verification (AC-395-V)

- `AC-395-V01` `cargo test` inside `src-tauri/sql-parser-core`
  passes, with the prior sprints' baseline tests still green and
  at least 80 new tests added (covering G + R + E + H + T + C +
  M + S).
- `AC-395-V02` `cargo test --test parse_sql_backend` passes;
  baseline regression count zero.
- `AC-395-V03` `pnpm vitest run` passes; the post-sprint count
  exceeds the pre-sprint count by at least the new facade +
  sqlSafety tests (≥ 22).
- `AC-395-V04` `pnpm tsc --noEmit` reports 0 errors.
- `AC-395-V05` `pnpm lint` reports 0 errors.
- `AC-395-V06` `cargo clippy --all-targets --all-features -- -D
  warnings` is clean.
- `AC-395-V07` `pnpm build:sql-wasm` succeeds and the gzipped
  output is no larger than the sprint-394 gzipped output × 1.3.

## Design Bar / Quality Bar

- Hand-written recursive-descent retained.
- No `unwrap()` / `expect()` on user-input paths.
- TS facade uses `unknown` + guard; no `any`.
- `parseSqlPreloaded` continues to be pure-sync, exception-free.
- The branch ordering in `sqlSafety` is *load-bearing*. Tests
  exercise the ordering by feeding inputs that could match
  multiple branches (e.g. EXPLAIN around a DELETE — must hit
  EXPLAIN-wrap before DML).
- The `reasons` strings are pinned (D5); the verification suite
  uses exact-string comparison.

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

- Rust unit test new count (≥ 80 across G + R + E + H + T + C + M
  + S).
- TS facade test new count (≥ 9 across F).
- sqlSafety integration test new count (≥ 13 across X).
- WASM gzipped size after this sprint vs. sprint-394 baseline.

## Test Requirements

- Rust unit tests: ≥ 80 newly added.
- TS facade tests: ≥ 9 newly added.
- sqlSafety integration tests: ≥ 13 newly added; existing
  regression count zero.
- Vitest baseline delta strictly positive.

## Ownership

- Generator: general-purpose Agent (sprint-395).
- Write scope: items listed under In Scope.
- Merge order: builds on sprint-394. Closes the SQL parser grammar
  expansion plan announced at sprint-385; subsequent SQL work
  (sprint-396+) shifts to dialect-specific token expansions and
  to replacing the remaining `cursorClause.ts` /
  `cteColumnCompletion.ts` regex paths with AST.

## Exit Criteria

- Open P1 / P2: 0.
- AC PASS counts: G 13 + R 7 + E 9 + H 6 + T 7 + C 10 + M 8 +
  S 3 + F 9 + X 13 + V 7 = **92 AC**.
- Pre-commit and pre-push hooks green.
- PR open and linked.

# Sprint Contract: sprint-393b

## Summary

- Goal: **SELECT widening — pass 2 (compositional read-side surface)** —
  extend the sprint-393a SELECT grammar with the *compositional* features
  that turn flat queries into the shapes real applications run: CTE
  (`WITH ... AS (...)`), window functions, scalar / table subqueries,
  set operations (`UNION` / `UNION ALL` / `INTERSECT` / `EXCEPT`),
  `CASE WHEN ... THEN ... ELSE ... END`, and literal `IN`-lists. This
  sprint also covers the *DML-wrap CTE* form (`WITH cte AS (...) UPDATE
  / DELETE / INSERT ...`) and adds the sqlSafety classification rule that
  inherits the inner statement's severity when a CTE wraps a write
  statement.
- Audience: With sprint-393b merged, the AST path covers the vast majority
  of read-side SQL that real queries take, and the regex fast-path in
  `sqlSafety` is consulted only for DDL additive (sprint-394) and misc
  (sprint-395). Tooling that uses the AST (cursor clause detection, CTE
  column completion) can rely on the richer shape from this sprint on.
- Owner: Generator (sprint-393b).
- Verification Profile: `frontend` (pnpm vitest + pnpm tsc + pnpm lint) +
  `backend` (`cargo test`, `cargo clippy --all-targets --all-features
  -D warnings`, `cargo build --target wasm32-unknown-unknown --release
  --features wasm`).

## Background

- sprint-393a widened SELECT with FROM list + joins + GROUP BY + HAVING +
  ORDER BY + LIMIT and added BETWEEN / LIKE / column-column comparison to
  the WHERE expression. Set operations, CTE, window functions, subqueries,
  CASE, and IN-list were explicitly deferred to *this* sprint.
- The deferred features cluster into three review boundaries:
  - **CTE / DML wrap** — the CTE form sits above the statement. Specifically,
    the existing `parse_statement` entry must learn that `WITH` introduces
    a list of CTE definitions followed by *one* of the existing SELECT /
    INSERT / UPDATE / DELETE statements. The wrapping affects sqlSafety
    classification (the severity of the inner write statement is carried
    by the outer `WITH` statement) but does not change the inner
    statement's own AST shape.
  - **Subquery / Set operation** — both turn a SELECT into something that
    can appear in more positions: a subquery in WHERE / FROM / SELECT-list,
    or a SELECT chained via `UNION` / `INTERSECT` / `EXCEPT`. The AST
    rooted at `SelectStatement` must accept *nested* SELECT-like trees.
  - **Expression compositions** — window functions, CASE expressions, and
    IN-list literally extend the expression grammar; they appear in the
    SELECT list, WHERE, HAVING, and ORDER BY positions and do not change
    the top-level statement shape.
- sqlSafety severity in this sprint:
  - A read-only SELECT (with or without CTE / set ops / window / CASE /
    IN-list) remains `kind="select"` / `severity="info"`.
  - A CTE whose inner statement is `INSERT` / `UPDATE` / `DELETE` inherits
    the inner statement's classification (`dml-insert` / `dml-update` /
    `dml-delete`) and its severity (`info` for INSERT, `danger` for
    UPDATE / DELETE), and the reasons list of the outer classification
    includes the inner statement's reasons (so the "WHERE 없는 UPDATE"
    reason from sprint-392 still surfaces when the inner UPDATE is
    bare-WHERE).

## In Scope

### Lexer additions

The lexer gains the following new case-insensitive keyword tokens. As with
prior sprints, casing is irrelevant — the lexer normalizes for the parser.

- CTE / set / sub: `WITH`, `RECURSIVE`, `UNION`, `INTERSECT`, `EXCEPT`,
  `ALL` (already lexed in some earlier sprint — reused if present),
  `EXISTS`.
- Window: `OVER`, `PARTITION`, `ROWS`, `RANGE`, `PRECEDING`, `FOLLOWING`,
  `UNBOUNDED`, `CURRENT`, `ROW` (the window-frame tokens are recognized
  even if the parser only accepts a subset of frames — see Parser below).
- CASE / IN: `CASE`, `WHEN`, `THEN`, `ELSE`, `END`, `IN`.

### AST additions (natural-language spec)

The widening is expressed as new variants inside existing trees and as one
new top-level statement variant. The discriminator names are kebab-case.

- **New top-level `kind` `with` (CTE wrap).** A successful parse of a
  `WITH ... AS (...) inner-statement` input serializes its top-level
  `kind` as `"with"` and carries three slots: a `recursive` boolean flag
  (true when `WITH RECURSIVE` was used, false otherwise), an ordered list
  of CTE definitions, and an `inner_statement` slot whose value is a
  nested `ParseResult` (any of `select`, `insert`, `update`, or `delete`
  — not another `with`, since nested `WITH` is out of scope for this
  sprint).
- **CTE definition.** Each entry in the CTE list has three properties: a
  name (string identifier), an optional column-list (ordered list of
  identifiers, empty when absent), and an inner SELECT statement (the
  parenthesized body). The inner SELECT is the same `SelectStatement`
  shape that sprint-393a defines; CTE bodies may themselves use set
  operations or window functions or subqueries.
- **Set operations.** The `SelectStatement` shape gains an optional
  `set_operation` chain. The chain is an ordered list whose entries
  carry an operator tag (`union`, `union-all`, `intersect`, `except`)
  and a right-hand SELECT. The chain is empty when the input is a single
  SELECT with no `UNION` / `INTERSECT` / `EXCEPT`. The first SELECT in
  the chain is the lexically-leftmost one; subsequent entries describe
  the next operator and operand. The serializer must preserve
  left-to-right input order — set operations are not commutative when
  duplicates differ. The chain does not get its own top-level
  `kind="union"` discriminator — it remains under `kind="select"`.
- **Subqueries.** Three positions accept a nested SELECT:
  - **WHERE / HAVING expression position.** A new expression primary
    identified by `kind="in-subquery"` carries a column reference and a
    nested SELECT; the negated form `column NOT IN (SELECT ...)` is
    `not` wrapping `in-subquery`. A new expression primary
    `kind="exists"` carries a nested SELECT; `NOT EXISTS` is `not`
    wrapping `exists`. A new expression primary `kind="scalar-subquery"`
    carries a nested SELECT and represents subqueries used as a scalar
    value in comparisons (e.g. `col = (SELECT max(x) FROM t)`).
  - **FROM-item position.** A FROM item may, in place of a table
    reference, carry a subquery (a nested SELECT). The FROM item's
    `source` slot becomes a discriminated union of `kind="table"` (the
    sprint-393a shape with `schema` + `table`) and `kind="subquery"`
    (carrying the nested SELECT). A subquery FROM item must have an
    alias — an unaliased FROM subquery parses to `SyntaxError`.
  - **SELECT-list scalar subquery.** A select-list item may be a scalar
    subquery (one column, one row expected at runtime). The select-list
    item shape gains an `expression` slot of expression type, and a
    new expression primary `kind="scalar-subquery"` covers it. Bare
    `*` and bare column references keep their existing shapes — only
    when the input is parenthesized SELECT does the `scalar-subquery`
    primary apply.
- **Window functions.** A new expression primary `kind="window-function"`
  appears in the SELECT list and in ORDER BY. It carries a function name
  (string), an ordered list of argument expressions (each expression
  itself uses the widened grammar — column refs, literals, `*` for
  `COUNT(*)`), and an OVER clause. The OVER clause carries an optional
  partition-by list (ordered list of column references; empty when
  absent), an optional order-by list (the same ordering-item shape as
  sprint-393a), and an optional frame descriptor. The frame descriptor
  carries a unit tag (`rows` or `range`), a start bound, and an
  optional end bound. Each bound has a kind tag: `unbounded-preceding`,
  `unbounded-following`, `current-row`, `preceding` (carrying a literal
  N), or `following` (carrying a literal N). When the input writes only
  the start bound (`ROWS UNBOUNDED PRECEDING`), the end bound slot is
  null.
- **CASE expression.** A new expression primary `kind="case"` carries an
  optional `operand` slot (the simple-CASE form `CASE col WHEN ... THEN
  ...` has the operand set; the searched-CASE form `CASE WHEN ... THEN
  ...` has it null), an ordered list of WHEN-clauses, and an optional
  ELSE expression. Each WHEN-clause carries a `condition` (an
  expression; for simple CASE this is a value compared against the
  operand, for searched CASE it is a boolean expression) and a `result`
  expression. CASE may appear in the SELECT list and in WHERE / HAVING
  (so the expression grammar uniformly accepts it).
- **IN-list (literal-only).** A new expression primary `kind="in-list"`
  carries a column reference and an ordered list of literal-or-
  placeholder values (the same `InsertValue` shape from sprint-392).
  `column NOT IN (1, 2, 3)` is `not` wrapping `in-list`. The grammar
  does not accept `column IN (SELECT ...)` under `in-list` — that
  shape is `in-subquery` (above).

### Parser additions

- **CTE / WITH parser.** A top-level `WITH` token (case-insensitive)
  triggers the WITH parser. It accepts an optional `RECURSIVE` keyword
  immediately after `WITH`, then one or more CTE definitions separated
  by commas, then *exactly one* inner statement chosen from SELECT,
  INSERT, UPDATE, or DELETE. The inner statement is parsed by the
  same sub-parsers used by sprint-385 / sprint-392 / sprint-393a. A
  `WITH` followed by another `WITH` (nested CTE wrap) parses to
  `SyntaxError`.
- **Set-operation parser.** After a SELECT body is parsed (including its
  ORDER BY / LIMIT), the parser checks for `UNION`, `UNION ALL`,
  `INTERSECT`, or `EXCEPT`. When present, the parser recursively
  parses the right-hand SELECT and appends a chain entry. Chaining is
  left-associative.
- **Subquery parser.** A parenthesized `(SELECT ...)` is a valid
  expression-position primary (`scalar-subquery` / `exists` /
  `in-subquery`) and a valid FROM-item source. The parser must accept
  arbitrary depth of subquery nesting, but enforces the "subquery in
  FROM must have alias" rule.
- **Window function parser.** Any function call (identifier followed by
  parenthesized argument list) immediately followed by `OVER (...)`
  parses as a window function. The argument list accepts the same
  expressions as the select-list (column refs, literals, `*`). Without
  the `OVER` keyword, a function-call expression parses to
  `Error(UnsupportedExpression)` — bare function calls are not in scope
  for this sprint (they land alongside the rest of the function-call
  expression work in a later sprint).
- **CASE parser.** `CASE` introduces a CASE expression. The simple-CASE
  form (`CASE col WHEN v1 THEN r1 ... END`) and the searched-CASE form
  (`CASE WHEN cond1 THEN r1 ... END`) are both accepted; the parser
  decides by peeking at whether a `WHEN` follows immediately after
  `CASE` (searched form) or after a non-`WHEN` token (simple form). An
  `ELSE` clause is optional; `END` is required.
- **IN-list parser.** An expression primary parser sees `column IN (` and
  must decide whether the parenthesized body is a literal-list or a
  subquery. The decision is based on the first token inside the
  parentheses: a `SELECT` token (case-insensitive) routes to
  `in-subquery`, anything else (a literal token) routes to `in-list`.
  Mixed lists (a literal followed by a SELECT) parse to `SyntaxError`.

### TS facade updates

`src/lib/sql/sqlAst.ts` extends as follows:

- A new top-level union member `SqlWithStatement` with `kind="with"`,
  carrying `recursive: boolean`, `ctes: SqlCteDefinition[]`, and
  `inner_statement: SqlParseResult` (typed to the SELECT / INSERT /
  UPDATE / DELETE union, not back to `SqlParseResult` itself to keep
  the recursive type tractable).
- A new sub-shape `SqlCteDefinition` with `name: string`, `columns:
  string[]` (empty when absent), and `body: SqlSelectStatement`.
- A new optional `set_operation` field on `SqlSelectStatement` of type
  ordered list of `{ operator: "union" | "union-all" | "intersect" |
  "except"; statement: SqlSelectStatement }`.
- The FROM-item `source` slot becomes a discriminated union with
  `kind="table"` (the existing shape) and `kind="subquery"` (carrying
  a SELECT).
- New expression primaries: `in-list`, `in-subquery`, `exists`,
  `scalar-subquery`, `window-function`, `case`. Each is a member of the
  `SqlWhereExpr` / select-list-expression union type.
- The runtime guard `isSqlParseResult` accepts the new top-level
  `kind="with"` and the new expression primary kinds without throwing.

`parseSql` / `parseSqlPreloaded` keep their existing surfaces. The
preloaded synchronous API returns the new `with` shape when applicable.

### sqlSafety integration

`src/lib/sql/sqlSafety.ts` gains a CTE-wrap branch. When the AST top-level
`kind` is `"with"`, the safety classifier recursively classifies the
inner statement and returns:

- The inner statement's `kind` (e.g. `dml-update`).
- The inner statement's `severity` (e.g. `danger`).
- The inner statement's `reasons` extended with the prefix "WITH (CTE
  wrap)" or kept verbatim depending on whether the inner statement's
  reasons are already self-describing. The sprint chooses to keep them
  verbatim — the AST CTE name is not surfaced into the safety reason
  text. This decision is fixed below (D2).

For a `WITH` wrapping a plain SELECT (no DML inside), the classifier
returns `kind="select"`, `severity="info"`, `reasons=[]` — same as a
bare SELECT.

**Decision (D1)**: The CTE-wrap classification is *recursive on the inner
statement only*. CTE definitions inside the WITH list are not classified
individually, even though their bodies may contain SELECT shapes. Bodies
are read-only (they are SELECTs, not DML), so this does not lose any
safety signal in practice.

**Decision (D2)**: The reasons list emitted by the outer WITH
classification is the inner statement's reasons, unchanged. The wrapping
context (the CTE name(s)) does not appear in the reason text. This keeps
the safety surface deterministic and easy to test.

**Decision (D3)**: When the AST `parseSqlPreloaded` returns a `with`
shape that wraps a recognized DML inner statement, the AST branch is
taken. When the inner statement is itself an `Error(...)` variant (e.g.
the inner statement is a form not yet supported by the parser), the
classifier falls back to the regex path on the original SQL string —
the same fallback contract as sprint-391 / sprint-392.

`parseSqlPreloaded` callsite ordering: the AST branch first checks for
the `with` top-level (delegate to inner classification), then proceeds
to the existing sprint-391 DDL destructive branch, then the sprint-392
DML branch, then the sprint-393a / sprint-393b SELECT branch. Order
matters because `with` may carry a DML inner statement that would
otherwise be matched by the DML branch on the raw SQL string.

### IN-list expression migration

sprint-392 marked `WHERE col IN (1, 2, 3)` as
`Error(UnsupportedExpression)` (see AC-392-D06). With sprint-393b's
`in-list` primary, the same input now parses successfully. The
sqlSafety branch for DML containing IN-list continues to classify as
`dml-update` / `dml-delete` per the sprint-392 rules — no severity
change.

## Out of Scope

- **Nested `WITH` (`WITH a AS (...) WITH b AS (...) SELECT ...`)** — not
  standard SQL; parses to `SyntaxError`.
- **Recursive CTE bodies** — the `RECURSIVE` keyword is *lexed* and the
  flag is recorded on the AST, but the grammar of the CTE body does not
  change. A CTE body that uses self-reference is still parsed as an
  ordinary SELECT (with set-operation chaining); validating self-
  reference semantics is not the parser's job.
- **Lateral subquery / `LATERAL` keyword** — deferred.
- **CASE expressions in DML SET / RETURNING positions** — sprint-393b
  only adds CASE inside SELECT / WHERE / HAVING / ORDER BY. DML SET
  with CASE is deferred.
- **Aggregate function calls outside window position** — `COUNT(*)`,
  `SUM(x)` without `OVER` continue to return `Error(UnsupportedExpression)`.
- **Arithmetic expressions** (`a + b`, `a * 2`) — still
  `Error(UnsupportedExpression)`. These land alongside the rest of the
  function-call work in a future sprint.
- **DDL additive (CREATE / ALTER ADD / ALTER RENAME)** — sprint-394.
- **GRANT / REVOKE / EXPLAIN / SHOW / SET / COPY / COMMENT** —
  sprint-395.
- **Dialect-specific tokens** (MySQL backtick, MSSQL bracket, PG double-
  quoted identifier) — sprint-396+.
- **Window-frame `EXCLUDE` clause** (`EXCLUDE CURRENT ROW`) — out of
  scope; an `EXCLUDE` token after a frame parses to `SyntaxError`.
- **`FILTER` clause on window functions** (PG) — out of scope.

## Invariants

- A successful SELECT-only parse continues to return `kind="select"`
  even when the input uses set operations, CTE-wrap-of-SELECT, window
  functions, CASE, or IN-list. The new top-level `kind="with"` appears
  only when the input uses `WITH`.
- All sprint-385 / sprint-391 / sprint-392 / sprint-393a tests continue
  to pass without modification.
- `analyzeStatement`'s return `StatementAnalysis` shape is unchanged.
  Existing sqlSafety tests remain green.
- The Rust crate continues to have no Tauri / tokio / IO dependency.
- No `unwrap()` / `expect()` on user-input paths.
- TS facade uses `unknown` + runtime guards; no `any`.
- The CTE-wrap branch in sqlSafety must short-circuit cleanly when the
  inner statement is missing (`Error(...)`) — fall back to the regex
  path on the original SQL string.
- WASM bundle size: ≤ sprint-393a gzipped size × 1.5. This is a larger
  multiplier because window-function / CASE / subquery contribute the
  most code-path mass of any single sprint.

## Acceptance Criteria

### W — CTE / WITH (AC-393b-W)

- `AC-393b-W01` Statement `WITH t AS (SELECT 1) SELECT * FROM t` parses
  with top-level `kind="with"`, `recursive=false`, one CTE entry with
  name `"t"`, and `inner_statement.kind="select"`.
- `AC-393b-W02` Statement `WITH RECURSIVE t AS (SELECT 1) SELECT * FROM
  t` parses with `recursive=true`.
- `AC-393b-W03` Statement `WITH t (a, b) AS (SELECT 1, 2) SELECT * FROM
  t` parses with the CTE entry's `columns` list of length 2.
- `AC-393b-W04` Statement `WITH a AS (SELECT 1), b AS (SELECT 2)
  SELECT * FROM a, b` parses with a CTE list of length 2.
- `AC-393b-W05` Statement `WITH t AS (SELECT 1) INSERT INTO x SELECT *
  FROM t` parses with `kind="with"` and `inner_statement.kind="insert"`.
- `AC-393b-W06` Statement `WITH t AS (SELECT 1) UPDATE x SET a = 1
  WHERE x.id IN (SELECT id FROM t)` parses with `kind="with"` and
  `inner_statement.kind="update"` carrying an `in-subquery` primary.
- `AC-393b-W07` Statement `WITH t AS (SELECT 1) DELETE FROM x WHERE
  x.id IN (SELECT id FROM t)` parses with `inner_statement.kind=
  "delete"`.
- `AC-393b-W08` Statement `WITH t AS (SELECT 1)` (no inner statement)
  parses as `Error(SyntaxError)`.
- `AC-393b-W09` Statement `WITH t AS SELECT 1 SELECT * FROM t` (missing
  parentheses around CTE body) parses as `Error(SyntaxError)`.
- `AC-393b-W10` Statement `WITH a AS (SELECT 1) WITH b AS (SELECT 2)
  SELECT * FROM b` (nested WITH) parses as `Error(SyntaxError)`.

### U — Set operations (AC-393b-U)

- `AC-393b-U01` Statement `SELECT a FROM x UNION SELECT a FROM y`
  parses with `kind="select"` and a `set_operation` list of length 1
  whose entry has operator `"union"`.
- `AC-393b-U02` Statement `SELECT a FROM x UNION ALL SELECT a FROM y`
  parses with operator `"union-all"`.
- `AC-393b-U03` Statement `SELECT a FROM x INTERSECT SELECT a FROM y`
  parses with operator `"intersect"`.
- `AC-393b-U04` Statement `SELECT a FROM x EXCEPT SELECT a FROM y`
  parses with operator `"except"`.
- `AC-393b-U05` Statement `SELECT a FROM x UNION SELECT a FROM y
  UNION ALL SELECT a FROM z` parses with a `set_operation` list of
  length 2 in left-to-right input order.
- `AC-393b-U06` Statement `SELECT a FROM x UNION SELECT a FROM y
  ORDER BY a` parses with the ORDER BY recorded on the *first* (leftmost)
  `SelectStatement` in the chain. The right-hand entries of the
  `set_operation` list carry SELECTs whose own `order_by` slot is empty.
  Downstream consumers that want the "outer" ORDER BY read it from the
  root SELECT, not from the last chain entry. This is a deterministic
  serializer rule — implementations must not swap, normalize, or
  duplicate the slot.
- `AC-393b-U07` Statement `SELECT a UNION` (no right-hand SELECT) parses
  as `Error(SyntaxError)`.

### Q — Subqueries (AC-393b-Q)

- `AC-393b-Q01` Statement `SELECT a FROM x WHERE x.id IN (SELECT id
  FROM y)` parses with WHERE primary `kind="in-subquery"` carrying a
  column and a nested SELECT.
- `AC-393b-Q02` Statement `SELECT a FROM x WHERE x.id NOT IN (SELECT
  id FROM y)` parses with a `not` primary wrapping `in-subquery`.
- `AC-393b-Q03` Statement `SELECT a FROM x WHERE EXISTS (SELECT 1 FROM
  y WHERE y.x_id = x.id)` parses with WHERE primary `kind="exists"`.
- `AC-393b-Q04` Statement `SELECT a FROM x WHERE NOT EXISTS (SELECT 1
  FROM y WHERE y.x_id = x.id)` parses with `not` wrapping `exists`.
- `AC-393b-Q05` Statement `SELECT a FROM (SELECT a FROM x) AS s` parses
  with a FROM item whose `source.kind="subquery"` and alias `"s"`.
- `AC-393b-Q06` Statement `SELECT a FROM (SELECT a FROM x)` (subquery
  FROM with no alias) parses as `Error(SyntaxError)`.
- `AC-393b-Q07` Statement `SELECT a FROM x WHERE x.a = (SELECT b FROM
  y LIMIT 1)` parses with WHERE comparison whose right-hand side is a
  `scalar-subquery` primary whose nested SELECT is a sprint-393a-shape
  SELECT (no aggregate function). This input form deliberately avoids
  the out-of-scope `max(b)` function call so that the AC is reproducible
  without relying on an "implementer's choice" escape clause. A SELECT
  with `max(b)` inside would propagate the inner `UnsupportedExpression`
  error to the top level and is covered separately by the existing
  sprint-392 "WHERE has function call" deferral.
- `AC-393b-Q08` Statement `SELECT (SELECT a FROM x LIMIT 1) FROM y`
  parses with a SELECT-list item whose expression is a
  `scalar-subquery`.

### O — Window functions (AC-393b-O)

- `AC-393b-O01` Statement `SELECT row_number() OVER () FROM x` parses
  with a SELECT-list expression of `kind="window-function"`, function
  name `"row_number"`, empty argument list, and an OVER clause with no
  partition-by, no order-by, no frame.
- `AC-393b-O02` Statement `SELECT rank() OVER (PARTITION BY a) FROM x`
  parses with the OVER clause carrying a partition-by list of length 1.
- `AC-393b-O03` Statement `SELECT rank() OVER (ORDER BY a DESC) FROM x`
  parses with the OVER clause carrying an order-by list of length 1
  whose direction is `"desc"`.
- `AC-393b-O04` Statement `SELECT rank() OVER (PARTITION BY a ORDER BY
  b) FROM x` parses with both partition-by and order-by populated.
- `AC-393b-O05` Statement `SELECT sum(x) OVER (ROWS BETWEEN UNBOUNDED
  PRECEDING AND CURRENT ROW) FROM t` parses with a frame descriptor of
  unit `"rows"`, start bound `kind="unbounded-preceding"`, end bound
  `kind="current-row"`.
- `AC-393b-O06` Statement `SELECT sum(x) OVER (ORDER BY a ROWS 5
  PRECEDING) FROM t` parses with a single start bound `kind=
  "preceding"` carrying the literal `5` and a null end bound.
- `AC-393b-O07` Statement `SELECT count(*) OVER () FROM t` parses with
  a SELECT-list `window-function` whose arguments list has length 1 and
  whose single argument is the special `*` shape (a column reference
  with column slot `"*"`, table slot null — or whichever AST
  representation the implementer chooses, as long as it is documented).
- `AC-393b-O08` Statement `SELECT sum(x) FROM t` (no OVER) parses with
  WHERE / SELECT-list expression `Error(UnsupportedExpression)` — bare
  function call is still out of scope.

### C — CASE expression (AC-393b-C)

- `AC-393b-C01` Statement `SELECT CASE WHEN x.a > 0 THEN 'pos' ELSE
  'neg' END FROM x` parses with a SELECT-list expression `kind="case"`,
  no operand, one WHEN-clause, and an ELSE expression.
- `AC-393b-C02` Statement `SELECT CASE x.a WHEN 1 THEN 'one' WHEN 2
  THEN 'two' END FROM x` parses with operand set, two WHEN-clauses, no
  ELSE.
- `AC-393b-C03` Statement `SELECT a FROM x WHERE CASE WHEN x.a > 0
  THEN 1 ELSE 0 END = 1` parses with a WHERE comparison whose left-
  hand side is a `case` primary.
- `AC-393b-C04` Statement `SELECT CASE END FROM x` (no WHEN-clauses)
  parses as `Error(SyntaxError)`.
- `AC-393b-C05` Statement `SELECT CASE WHEN x > 0 THEN 'p' ELSE 'n'
  FROM x` (missing END) parses as `Error(SyntaxError)`.

### I — IN-list (AC-393b-I)

- `AC-393b-I01` Statement `SELECT a FROM x WHERE x.id IN (1, 2, 3)`
  parses with WHERE primary `kind="in-list"` carrying a column and a
  values list of length 3.
- `AC-393b-I02` Statement `SELECT a FROM x WHERE x.id NOT IN (1, 2, 3)`
  parses with `not` wrapping `in-list`.
- `AC-393b-I03` Statement `DELETE FROM x WHERE x.id IN (1, 2, 3)`
  parses as `kind="delete"` with WHERE primary `kind="in-list"`. The
  sprint-392 deferral of IN-list (AC-392-D06) is lifted by this sprint.
- `AC-393b-I04` Statement `SELECT a FROM x WHERE x.id IN (1, 'two', 3)`
  parses with `in-list` carrying mixed literal kinds in input order.
- `AC-393b-I05` Statement `SELECT a FROM x WHERE x.id IN ()` (empty
  list) parses as `Error(SyntaxError)` — empty IN-list is rejected.
- `AC-393b-I06` Statement `SELECT a FROM x WHERE x.id IN (SELECT id
  FROM y)` parses as `kind="in-subquery"` (NOT `in-list`) — confirms
  the lookahead routes correctly.

### S — Serialization (AC-393b-S)

- `AC-393b-S01` A successful WITH parse serializes with top-level
  `kind="with"` and the documented `recursive`, `ctes`, and
  `inner_statement` slots.
- `AC-393b-S02` A SELECT with a set-operation chain serializes its
  `set_operation` list with each entry's `operator` field set to the
  documented kebab-case discriminator.
- `AC-393b-S03` A FROM item with subquery source serializes its
  `source` slot with `kind="subquery"`.
- `AC-393b-S04` Every new expression primary (`in-list`, `in-subquery`,
  `exists`, `scalar-subquery`, `window-function`, `case`) serializes
  with the documented kebab-case `kind` discriminator.
- `AC-393b-S05` Every new AST variant round-trips through serde
  `to_string` → `from_str` and compares equal.

### F — TS facade (AC-393b-F)

- `AC-393b-F01` `parseSql("WITH t AS (SELECT 1) SELECT * FROM t")`
  resolves to a value whose `kind` is `"with"`.
- `AC-393b-F02` `parseSql("SELECT a FROM x UNION ALL SELECT a FROM y")`
  resolves to a SELECT whose `set_operation` list has length 1 and
  whose entry's operator is `"union-all"`.
- `AC-393b-F03` `parseSql("SELECT row_number() OVER (PARTITION BY a
  ORDER BY b) FROM x")` resolves to a SELECT whose first select-list
  item is a `window-function` with populated partition-by and order-by.
- `AC-393b-F04` `parseSql("SELECT CASE WHEN x.a > 0 THEN 'p' ELSE 'n'
  END FROM x")` resolves to a SELECT whose first select-list item is
  a `case` primary.
- `AC-393b-F05` `parseSql("DELETE FROM x WHERE x.id IN (1, 2, 3)")`
  resolves to a DELETE whose WHERE primary is `in-list`.
- `AC-393b-F06` `parseSqlPreloaded` returns the same wider shapes
  synchronously once preloaded; returns null when not preloaded
  (unchanged contract).
- `AC-393b-F07` The runtime guard `isSqlParseResult` accepts the new
  top-level `kind="with"` and every new expression primary kind
  without throwing.

### X — sqlSafety integration (AC-393b-X)

- `AC-393b-X01` `analyzeStatement("WITH t AS (SELECT 1) SELECT * FROM
  t")` returns `kind="select"`, `severity="info"`, `reasons=[]`.
- `AC-393b-X02` `analyzeStatement("WITH t AS (SELECT 1) INSERT INTO x
  SELECT * FROM t")` returns `kind="dml-insert"`, `severity="info"`,
  `reasons=[]` — inherits inner classification per D1.
- `AC-393b-X03` `analyzeStatement("WITH t AS (SELECT 1) UPDATE x SET
  a = 1 WHERE x.id IN (SELECT id FROM t)")` returns `kind="dml-update"`,
  `severity="danger"`, and a `reasons` list that is empty (the inner
  UPDATE has a WHERE so the sprint-392 "missing WHERE" reason does NOT
  fire).
- `AC-393b-X04` `analyzeStatement("WITH t AS (SELECT 1) UPDATE x SET
  a = 1")` returns `kind="dml-update"`, `severity="danger"`, and the
  `reasons` list includes the sprint-392 "WHERE 없는 UPDATE" string
  (verbatim per D2).
- `AC-393b-X05` `analyzeStatement("WITH t AS (SELECT 1) DELETE FROM x")`
  returns `kind="dml-delete"`, `severity="danger"`, reasons include
  "WHERE 없는 DELETE".
- `AC-393b-X06` `analyzeStatement("SELECT a FROM x UNION SELECT a FROM
  y")` returns `kind="select"`, `severity="info"`, `reasons=[]`.
- `AC-393b-X07` `analyzeStatement("DELETE FROM x WHERE x.id IN (1, 2,
  3)")` continues to return `kind="dml-delete"`, `severity="danger"`,
  with no extra reasons (IN-list does not escalate severity).
- `AC-393b-X08` The existing sqlSafety test suite passes unchanged
  (regression count zero).
- `AC-393b-X09` The return `StatementAnalysis` shape is unchanged.

### V — Verification (AC-393b-V)

- `AC-393b-V01` `cargo test` inside `src-tauri/sql-parser-core` passes,
  with the sprint-385 / 391 / 392 / 393a baseline tests still green
  and at least 80 new tests added (covering W + U + Q + O + C + I + S).
- `AC-393b-V02` `cargo test --test parse_sql_backend` passes; baseline
  regression count zero.
- `AC-393b-V03` `pnpm vitest run` passes; the post-sprint count exceeds
  the pre-sprint count by at least the new facade + sqlSafety tests
  (≥ 14).
- `AC-393b-V04` `pnpm tsc --noEmit` reports 0 errors.
- `AC-393b-V05` `pnpm lint` reports 0 errors.
- `AC-393b-V06` `cargo clippy --all-targets --all-features -- -D
  warnings` is clean.
- `AC-393b-V07` `pnpm build:sql-wasm` succeeds and the gzipped output
  is no larger than the sprint-393a gzipped output × 1.5.

## Design Bar / Quality Bar

- Hand-written recursive-descent retained. No parser-generator
  dependency.
- No `unwrap()` / `expect()` on user-input paths. TS facade `unknown` +
  guard.
- `parseSqlPreloaded` continues to be pure-sync, exception-free.
- The CTE-wrap classification must compose cleanly: the outer branch
  delegates to the same inner classifier code path that sprint-391 and
  sprint-392 callsites use, so a single set of unit tests in those
  prior sprints continues to cover the inner classification behavior.
- Set-operation chain ordering is *left-to-right input order* in the
  AST, never normalized. Reviewers must reject any code path that
  re-orders operands.

## Verification Plan

### Required commands

1. `cd src-tauri/sql-parser-core && cargo test` — all green.
2. `cd src-tauri && cargo test --test parse_sql_backend` — regression
   zero.
3. `cd src-tauri && cargo clippy --all-targets --all-features -- -D
   warnings` — clean.
4. `pnpm build:sql-wasm` — succeeds; gzipped measured.
5. `pnpm vitest run` — all green.
6. `pnpm tsc --noEmit` — 0 errors.
7. `pnpm lint` — 0 errors.

### Required evidence

- Rust unit test new count (≥ 80 across W + U + Q + O + C + I + S).
- TS facade test new count (≥ 7 across F).
- sqlSafety integration test new count (≥ 7 across X).
- WASM gzipped size after this sprint vs. sprint-393a baseline.

## Test Requirements

- Rust unit tests: ≥ 80 newly added.
- TS facade tests: ≥ 7 newly added.
- sqlSafety integration tests: ≥ 7 newly added; existing regression
  count zero.
- Vitest baseline delta strictly positive.

## Ownership

- Generator: general-purpose Agent (sprint-393b).
- Write scope: items listed under In Scope.
- Merge order: builds on sprint-393a. sprint-394 builds on this sprint's
  AST shapes for any CTE-wrap-of-DDL forms (though DDL additive itself
  does not wrap in WITH in this sprint).

## Exit Criteria

- Open P1 / P2: 0.
- AC PASS counts: W 10 + U 7 + Q 8 + O 8 + C 5 + I 6 + S 5 + F 7 +
  X 9 + V 7 = **72 AC**.
- Pre-commit and pre-push hooks green.
- PR open and linked.

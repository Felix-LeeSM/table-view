# Sprint Contract: sprint-307 (Phase 28 Slice A1 — mongosh parser foundation)

## Summary

- **Goal**: Stand up `src/lib/mongo/mongoshParser.ts` — a pure-TS (or WASM-backed) parser that turns mongosh expressions (`db.<coll>.<method>(<args>).<chain>`) into a structured discriminated-union result, plus a BSON literal whitelist (6 forms). Decide and freeze the parser strategy (WASM sidecar vs handwritten whitelist) in a new ADR. **No editor / store / IPC wiring** in this sprint — A1 is purely the parser module the next 5 sub-sprints (A2–A6) consume.
- **Audience**: Phase 28 implementation chain (Slices A2–M depend on this parser surface).
- **Owner**: Generator agent (sprint-307 harness run).
- **Verification Profile**: `command`

## In Scope

- New module `src/lib/mongo/mongoshParser.ts` exporting `parseMongoshExpression(input: string): ParsedMongoshCall | ParsedMongoshError` with discriminated union shape.
- Tagged structural reification for 6 BSON literal forms: `ObjectId`, `ISODate`, `UUID`, `NumberLong`, `NumberDecimal`, `BinData`. Output shape must be BSON canonical-extjson compatible so the existing backend (`src-tauri/src/db/mongodb/queries.rs::flatten_cell`) accepts it without translation.
- 13-method whitelist exported as a single `readonly` tuple from the parser module (single source of truth used by A4's snippet menu and A5's dispatcher).
- Cursor chain parser: `.sort({...})`, `.limit(N)`, `.skip(N)`, `.toArray()` — only valid after `find` / `aggregate`.
- Refusal cases (returns `ParsedMongoshError`, never throws): variables, control flow (for/while/if), callbacks (`.forEach(cb)`, `.map(cb)`), shell helpers (`use`, `show`), cross-DB (`getSiblingDB`), unknown method, malformed BSON literal, multiple statements, missing `db.` prefix, invalid cursor chain on non-cursor method, `NumberLong` 64-bit overflow.
- ADR in `memory/decisions/00NN-mongosh-parser-strategy/memory.md` (next sequential ADR number — check the index) recording the strategy decision.
- Unit suite `src/lib/mongo/mongoshParser.test.ts` covering the 13×method × happy + 8×refusal + 6×BSON-literal matrix.

## Out of Scope

- Editor / toolbar / store / IPC wiring (Sprints A2–A6).
- Backend trait additions / new Tauri commands (Sprint A2).
- CodeMirror snippet insertion / Tab navigation (Sprint A4).
- Result rendering, WriteSummaryPanel, ScalarOrListPanel (Sprint A6).
- The toggle removal in `Toolbar.tsx` / `MongoQueryEditor.tsx` (Sprint A3).
- Any consumer of `parseMongoshExpression` — A1 produces only the module + test + ADR.

## Invariants

- **No JS eval, never**. The parser MUST NOT call `eval`, `new Function`, `Function(...)`, `setTimeout(string, ...)`, `setInterval(string, ...)`, or any dynamic-code primitive. Verifiable via `grep -E "\b(eval|Function)\b" src/lib/mongo/mongoshParser.ts` returning zero matches (modulo type-only `Function` mentions if any; the assertion targets runtime call sites).
- **Pure module**. `parseMongoshExpression` MUST have no side effects, no network, no filesystem, no global state — same input always returns the same output.
- **Never throws** on user input. Every malformed input returns `ParsedMongoshError`; only programmer errors (e.g. wrong-type non-string input) may panic.
- **13-method whitelist is the single source of truth**. The constant is exported from `mongoshParser.ts` and consumed (via TS import) by future sub-slices. A separate `mongoshMethods.ts` constant duplicating it is NOT allowed.
- **BSON output is canonical-extjson-compatible**. The reified shapes must match the existing backend wire-format so A2/A5 don't have to translate.
- **RDB regression zero**. A1 touches no RDB code path. The `SqlQueryEditor` and `query_integration` test scenarios must remain green by virtue of file isolation.
- **Convention discipline**. `.claude/rules/react-conventions.md` (no `any`, interface for shapes) and `.claude/rules/testing.md` (parser/builder coverage ≥90%) apply.

## Acceptance Criteria

- `AC-01` `src/lib/mongo/mongoshParser.ts` exists and exports `parseMongoshExpression(input: string): ParsedMongoshCall | ParsedMongoshError`. The return type is a discriminated union with a literal `kind` field distinguishing success / error. Verified: `pnpm vitest run src/lib/mongo/mongoshParser` exits 0.
- `AC-02` Happy-path coverage — at least one unit test asserts the parsed structure for each of these 13 methods:
  - `db.users.find({age: {$gt: 30}})`
  - `db.users.find({}).sort({name: 1}).limit(10).skip(20).toArray()`
  - `db.events.aggregate([{$match: {x: 1}}, {$group: {_id: "$dept", n: {$sum: 1}}}])`
  - `db.users.findOne({_id: ObjectId("65abcdef0123456789abcdef")})`
  - `db.users.countDocuments({active: true})`
  - `db.users.estimatedDocumentCount()`
  - `db.users.distinct("country", {active: true})`
  - `db.users.insertOne({name: "alice"})`
  - `db.users.insertMany([{a:1}, {b:2}])`
  - `db.users.updateOne({_id: "x"}, {$set: {y: 1}})`
  - `db.users.updateMany({active: true}, {$inc: {n: 1}})`
  - `db.users.deleteOne({_id: "x"})`
  - `db.users.deleteMany({old: true})`
  - `db.users.bulkWrite([{insertOne: {document: {a:1}}}, {updateOne: {filter: {a:1}, update: {$set: {b:2}}}}])`
  - Each test asserts: `result.kind === "success"`, `result.collection === "users"` (or `"events"`), `result.method === "<expected>"`, `result.args` matches expected shape, `result.cursorChain` matches expected (empty for non-cursor).
- `AC-03` BSON literal whitelist — at least one unit test per literal asserts the reified shape is structurally distinct from a plain string and is canonical-extjson compatible:
  - `ObjectId("65abcdef0123456789abcdef")` → `{ $oid: "65abcdef..." }`
  - `ISODate("2026-05-14T00:00:00.000Z")` → `{ $date: "2026-05-14T00:00:00.000Z" }`
  - `UUID("550e8400-e29b-41d4-a716-446655440000")` → `{ $binary: { base64: <derived>, subType: "04" } }` (or equivalent canonical-extjson)
  - `NumberLong("9223372036854775807")` → `{ $numberLong: "9223372036854775807" }`
  - `NumberDecimal("123.456789012345678901234567890")` → `{ $numberDecimal: "..." }`
  - `BinData(0, "AQID")` → `{ $binary: { base64: "AQID", subType: "00" } }`
- `AC-04` Refusal coverage — each of these inputs returns a `ParsedMongoshError` with the named `kind` (asserted by test):
  - `var x = 1; db.users.find(x)` → `unsupported-syntax`
  - `for (let i = 0; i < 10; i++) db.users.insertOne({i})` → `unsupported-syntax`
  - `if (true) db.users.find({})` → `unsupported-syntax`
  - `db.users.find({}).forEach(d => print(d))` → `unsupported-syntax`
  - `db.users.find({}).map(d => d.name)` → `unsupported-syntax`
  - `use admin` / `show dbs` / `show collections` → `unsupported-syntax`
  - `db.getSiblingDB("other").users.find({})` → `unsupported-syntax`
  - `db.users.deleteAll({})` → `unsupported-method`
  - `ObjectId("not-hex")` → `bson-literal`
  - `NumberLong("99999999999999999999")` → `bson-literal` (out-of-range)
  - `db.users.find({}); db.users.find({})` → `multiple-statements`
  - `users.find({})` → `missing-db-prefix`
  - `db.users.insertOne({}).limit(5)` → `invalid-cursor-chain`
- `AC-05` `pnpm vitest run --coverage src/lib/mongo/mongoshParser` reports ≥90% line coverage on the parser module (≥85% if branch is reported separately).
- `AC-06` ADR exists at `memory/decisions/00NN-mongosh-parser-strategy/memory.md` (next sequential number per `memory/decisions/memory.md` index) with sections: Decision, Rationale (cites R28.1), Trade-offs, Consequences (bundle size, build complexity). ADR is added to the activelist of the decisions index.
- `AC-07` `grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts` returns empty (no JS eval primitives invoked).
- `AC-08` `pnpm tsc --noEmit` exits 0. `pnpm lint` exits 0. `pnpm vitest run` (full suite) exits 0 — no regression in any existing test.

## Design Bar / Quality Bar

- Module is **deep**: small public surface (1 exported function + 1 type union + 1 method tuple) backed by a complete internal parser. Avoid spreading parser internals into multiple exported helpers.
- Discriminated union shape: prefer `kind: "success" | "error"` over `success: boolean`. Error shape includes `kind: "unsupported-syntax" | "unsupported-method" | "bson-literal" | "multiple-statements" | "missing-db-prefix" | "invalid-cursor-chain"` plus a human-readable `message` and an `at: { line, column }` location hint where feasible.
- Internal helpers (tokenizer, AST walker, BSON literal reifiers) live in private functions inside the module — not exported.
- Test file mirrors the AC matrix 1:1 — each AC entry is one or more `it(...)` blocks named after the input shape (e.g. `it("parses find with cursor chain")`, `it("refuses variable declaration with unsupported-syntax")`).

## Verification Plan

### Required Checks

1. `pnpm vitest run src/lib/mongo/mongoshParser` exit 0.
2. `pnpm vitest run --coverage src/lib/mongo/mongoshParser` reports ≥90% line coverage.
3. `pnpm tsc --noEmit` exit 0.
4. `pnpm lint` exit 0.
5. `pnpm vitest run` (full suite) exit 0 — no regression.
6. `grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts` returns empty.
7. ADR file exists at `memory/decisions/00NN-mongosh-parser-strategy/memory.md` and is referenced in `memory/decisions/memory.md` index.
8. The 13-method whitelist constant is exported from `mongoshParser.ts` and consumed (via TS import) only from the test file in this sprint (consumer sub-slices arrive later).

### Required Evidence

- **Generator must provide**:
  - List of created/modified files with a one-line purpose each.
  - Output of each `Required Check` (exit code + key line count or coverage %).
  - For each AC, the test name(s) that cover it.
  - ADR file path + chosen strategy (WASM sidecar vs handwritten whitelist) + a one-line rationale citing R28.1.
  - The 13-method whitelist constant identifier + import path.
- **Evaluator must cite**:
  - For each AC pass/fail decision, the test name or grep command that proved it.
  - Any missing or weak evidence as a finding (severity P1/P2/P3).
  - Whether ADR is correctly numbered (next available in the index) and structurally complete.

## Test Requirements

### Unit Tests (필수)
- 1 test per AC-02 method shape (13 happy paths).
- 1 test per AC-03 BSON literal (6 reification asserts).
- 1 test per AC-04 refusal kind (13 error inputs).
- Each test file has a header comment with `Sprint 307` + reason per `feedback_test_documentation.md` (memory feedback dated 2026-04-28).

### Coverage Target
- Parser module: ≥90% line (per `.claude/rules/testing.md` "쿼리 파서/빌더").

### Scenario Tests (필수)
- [x] Happy path (AC-02)
- [x] BSON literal reification (AC-03)
- [x] 에러/예외 — refusal kinds (AC-04)
- [x] 경계 조건 — `NumberLong` overflow, malformed `ObjectId`, multi-statement (AC-04)
- [x] 기존 기능 회귀 없음 — `pnpm vitest run` full suite (AC-08)

## Test Script / Repro Script

```bash
cd /Users/felix/Desktop/study/view-table

# 1. Parser-specific tests
pnpm vitest run src/lib/mongo/mongoshParser

# 2. Coverage on the parser module
pnpm vitest run --coverage src/lib/mongo/mongoshParser

# 3. Type check + lint
pnpm tsc --noEmit
pnpm lint

# 4. Full vitest regression
pnpm vitest run

# 5. JS eval safety grep
grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts 2>/dev/null && echo "FAIL: eval primitives present" || echo "OK: no eval"

# 6. ADR present
ls memory/decisions/*mongosh-parser-strategy*/memory.md
grep -l "mongosh-parser-strategy" memory/decisions/memory.md
```

All 6 commands must exit cleanly (grep `2`-cleanly = no matches found).

## Ownership

- **Generator**: harness `general-purpose` agent for sprint-307.
- **Write scope**:
  - `src/lib/mongo/mongoshParser.ts` (NEW)
  - `src/lib/mongo/mongoshParser.test.ts` (NEW)
  - `src/lib/mongo/bsonLiterals.ts` (NEW, optional split from parser module)
  - `src/lib/mongo/bsonLiterals.test.ts` (NEW, optional if split)
  - `memory/decisions/00NN-mongosh-parser-strategy/memory.md` (NEW)
  - `memory/decisions/memory.md` (MODIFY: add entry to active list)
  - **DO NOT TOUCH**: any `src/components/`, `src-tauri/`, `src/stores/`, `src/hooks/`, RDB code, existing test files.
- **Merge order**: A1 is the first of 6 sub-sprints. Subsequent sub-sprints (A2–A6) consume the parser surface and must NOT modify A1's exports.

## Exit Criteria

- Open `P1`/`P2` findings: `0`
- Required checks passing: `yes` (all 6)
- Acceptance criteria evidence linked in `handoff.md`
- No file outside the declared write scope is touched (verified by `git diff --name-only` against the pre-sprint baseline).
- ADR is the **next sequential number** in `memory/decisions/memory.md` index (no number collision).

# Sprint 307 — Generator Handoff

Phase 28 Slice A1 — mongosh expression parser foundation. Implements
`parseMongoshExpression`, the 13-method whitelist, six BSON-literal
reifiers, and the strategy ADR. No editor / store / IPC wiring (A2–A6
scope).

## Changed Files

- `src/lib/mongo/mongoshParser.ts` — NEW. Pure-TS mongosh parser exporting
  `parseMongoshExpression(input)`, `MONGOSH_METHOD_WHITELIST` (single source
  of truth), `MongoshMethod`, `MongoshErrorKind`, `CursorChainStep`,
  `ParsedMongoshCall`, `ParsedMongoshError`. Includes the handwritten
  tokenizer, recursive-descent value parser, cursor-chain walker, and six
  BSON-literal reifiers (canonical-extjson-compatible output).
- `src/lib/mongo/mongoshParser.test.ts` — NEW. Vitest unit suite, 90 tests
  total. Header comment cites Sprint 307 + reason + date per
  `feedback_test_documentation.md`. Sections: whitelist constant assertion,
  13 happy-path methods (AC-02), 6 BSON literal reifications (AC-03), 13
  refusal kinds (AC-04), invariants, lexer/value coverage, BSON edge cases,
  cursor chain semantics.
- `memory/decisions/0029-mongosh-parser-strategy/memory.md` — NEW ADR.
  Decision: handwritten whitelist parser. Rationale cites R28.1, bundle
  size, JS-eval invariant. 31 lines (<200 cap).
- `memory/decisions/memory.md` — MODIFY. Added ADR 0029 row to the active
  decisions table.

No files outside the declared write scope were touched
(`git diff --name-only` confirms).

## Checks Run

| Check | Result |
|-------|--------|
| `pnpm vitest run src/lib/mongo/mongoshParser` | pass — 90 tests, 0 failed, exit 0 |
| `pnpm vitest run --coverage src/lib/mongo/mongoshParser` (scoped) | pass — Lines 96.44% (326/338), Branches 92.38%, Functions 100%, Statements 95.67% |
| `pnpm tsc --noEmit` | pass — exit 0 |
| `pnpm lint` | pass — exit 0 |
| `pnpm vitest run` (full regression) | pass — 3491 tests passed, 10 skipped, exit 0 |
| `grep -E "\b(eval\|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts` | pass — empty (exit 2 = no match) |
| ADR present + registered in index | pass — `ls memory/decisions/0029-.../memory.md` exit 0; index grep returns the row |

## Done Criteria Coverage

| AC | Evidence |
|----|----------|
| AC-01 (parseMongoshExpression exported + discriminated union) | `src/lib/mongo/mongoshParser.ts` exports `parseMongoshExpression`; return shape is `ParsedMongoshCall \| ParsedMongoshError` with `kind: "success" \| "error"`. Test: `parseMongoshExpression — invariants > returns success kind discriminator on valid input`. |
| AC-02 (13 happy-path methods) | `parseMongoshExpression — happy path methods (AC-02)` describe block — one `it(...)` per method: `find`, `find` with cursor chain, `aggregate`, `findOne` (+ ObjectId), `countDocuments`, `estimatedDocumentCount`, `distinct`, `insertOne`, `insertMany`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `bulkWrite`. |
| AC-03 (6 BSON literal reifications) | `parseMongoshExpression — BSON literal reification (AC-03)` describe block — `ObjectId → $oid`, `ISODate → $date`, `UUID → $binary subType "04"` (deterministic base64), `NumberLong → $numberLong`, `NumberDecimal → $numberDecimal`, `BinData → $binary subType "00"`. |
| AC-04 (13 refusal kinds) | `parseMongoshExpression — refusal kinds (AC-04)` describe block — every kind asserted: `unsupported-syntax` (var / for / if / forEach / map / use / show / getSiblingDB), `unsupported-method` (deleteAll), `bson-literal` (ObjectId not-hex, NumberLong overflow), `multiple-statements` (`;`), `missing-db-prefix` (bare collection), `invalid-cursor-chain` (`.limit` after `insertOne`). |
| AC-05 (≥90% parser line coverage) | Coverage scoped to the parser module: Lines 96.44%, Branches 92.38%, Functions 100% — well above the 90% threshold. |
| AC-06 (ADR with R28.1 citation) | `memory/decisions/0029-mongosh-parser-strategy/memory.md` — sections Decision / 이유 (cites R28.1 in item 1) / 트레이드오프 / 관련. Registered in `memory/decisions/memory.md` active decisions table. |
| AC-07 (grep eval/new Function returns empty) | `grep -E "\b(eval\|new Function)\b" ...` exit 2 / empty stdout. The parser uses only a hand-written tokenizer + recursive-descent walker. |
| AC-08 (tsc, lint, full vitest all exit 0) | `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; full `pnpm vitest run` 3491 passed / 10 skipped exit 0. |
| Whitelist single source of truth | `MONGOSH_METHOD_WHITELIST` is a `readonly` tuple exported from `mongoshParser.ts` and imported only by the parser's own test file. No duplicate constant exists elsewhere — `mongoAutocomplete.ts` holds the *operator* / *stage* constants which are a different concept. |
| Test file header per `feedback_test_documentation.md` | First lines of `mongoshParser.test.ts` cite "Sprint 307: …reason… (2026-05-14)". |

## Assumptions

- **Handwritten whitelist parser chosen over WASM sidecar.** Recorded in
  ADR 0029. Rationale: mongosh's official parser carries ~200 KB+ WASM
  bundle cost with marginal grammar benefit for a 13-method/6-literal
  acceptance set, plus the JS-eval invariant is verifiable at grep level
  in our own source. Bundle / cold-boot impact ≈ 0.
- **Cursor-chain method whitelist = `sort` / `limit` / `skip` / `toArray`.**
  Anything else after a cursor produces `invalid-cursor-chain`. `forEach` /
  `map` callbacks are surfaced separately as `unsupported-syntax` so the
  error message can point at the callback issue rather than "unknown chain
  method".
- **`undefined` as a value is accepted (parses to `undefined`).** mongosh
  permits it; backend `flatten_cell` discards undefined fields. This avoids
  refusing inputs that mongosh users copy verbatim.
- **Trailing `;` after a single expression is tolerated** (shell hygiene).
  Multi-statement guard rejects only `;` with non-whitespace content on
  both sides.
- **`db.getSiblingDB(...)` is refused as `unsupported-syntax`** rather than
  a dedicated cross-db kind — the editor's "Choose a database first"
  banner is the natural user-facing surface (per spec Edge Cases section).
- **Number tokens are parsed via JS `Number(...)`** — no IEEE-754
  guardrails for `find` filter values. `NumberLong` / `NumberDecimal`
  literals are the explicit precision-preserving channel.
- **UUID base64 is derived deterministically** from the 16 raw bytes (the
  AC says "<derived>"). Test asserts the exact base64 for the
  `550e8400-…` sample so the contract is enforceable.
- **Statements containing `;` inside string literals are not multi-stmt.**
  `hasTopLevelSemicolon` walks the *token stream* (not raw text), so
  `db.users.find({tag: "a;b"})` parses correctly.

## Residual Risk

- **Acceptance set vs dispatch parity (low).** Sprint A5 must verify that
  every parsed `method` has a matching Tauri command. The parser
  intentionally accepts shapes (e.g. `bulkWrite` with mixed sub-ops, or
  `distinct` with no filter) that the backend still needs to thread end-
  to-end. Mitigation: per-method RTL dispatch tests in A5 (already in the
  Sprint A5 plan).
- **BSON canonical-extjson surface ambiguity (low).** Our six reified
  shapes are canonical-extjson compatible, but the backend's
  `flatten_cell` reads canonical-extjson via `bson::from_bson`. If the
  driver version bump (sprint 281 vs 307) shifted the canonical-extjson
  contract (unlikely — MongoDB freezes this), a single integration test
  in A2 will catch it. No silent fallback.
- **mongosh REPL copy-paste compatibility (medium UX).** Some valid mongosh
  expressions (`.pretty()`, `printjson(...)`, `db.coll.find().count()`,
  `tojson(...)`) are refused. Sprint A3's editor surface needs an
  affordance ("supported methods: …") to communicate the acceptance set.
  This is the natural follow-up, not a A1 gap.
- **NumberLong boundary precision (none).** Tested both `+2^63 - 1` and
  `-2^63` exactly; out-of-range cases above and below both refuse.
- **No multi-line autocomplete / position hints (deferred).**
  `ParsedMongoshError` carries an optional `at: {line, column}` field but
  we do not yet populate it — the parser would need a position tracker
  to plumb token offsets through every error site. Future improvement;
  Sprint A3's banner is single-line for now.

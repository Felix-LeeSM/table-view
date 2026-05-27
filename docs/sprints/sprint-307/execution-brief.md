# Sprint Execution Brief: sprint-307 (Phase 28 Slice A1 — mongosh parser)

## Objective

Build `src/lib/mongo/mongoshParser.ts`, a pure-TS (or WASM-backed) module that turns mongosh expression strings like `db.<coll>.<method>(<args>).<chain>` into a structured discriminated-union result. Build BSON literal whitelist parsing for 6 forms (`ObjectId`, `ISODate`, `UUID`, `NumberLong`, `NumberDecimal`, `BinData`) producing canonical-extjson-compatible shapes. Freeze the parser strategy (WASM sidecar vs handwritten whitelist) in a new sequential ADR. **Module + tests + ADR only — no UI / store / IPC wiring.**

## Task Why

Slice A1 is the first sub-sprint of Phase 28 (MongoDB Full Support). The full Slice A replaces the Find/Aggregate toggle with a single mongosh editor where the user types `db.coll.method(args)`. A1's parser is the contract every later sub-slice (A2 backend / A3 editor / A4 snippet menu / A5 read dispatch / A6 write dispatch) consumes — it is the **architectural pivot** of Phase 28.

Phase 28 grill froze the design (`docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md`):
- Q14 chose option 2+ (mongosh LSP/parser, no JS eval) — this sprint executes that choice.
- The 13-method whitelist + 6 BSON literal whitelist is locked.
- TDD policy applies: parser/builder ≥90% line coverage (`.claude/rules/testing.md`).

## Scope Boundary

**Touch**:
- `src/lib/mongo/mongoshParser.ts` (NEW)
- `src/lib/mongo/mongoshParser.test.ts` (NEW)
- `src/lib/mongo/bsonLiterals.ts` (NEW, optional split)
- `src/lib/mongo/bsonLiterals.test.ts` (NEW, optional split)
- `docs/archives/decisions/00NN-mongosh-parser-strategy/memory.md` (NEW)
- `docs/archives/decisions/memory.md` (MODIFY index)

**DO NOT touch**:
- Any `src/components/` file (editor surface = Sprint A3)
- Any `src-tauri/` file (backend = Sprint A2)
- Any `src/stores/` file
- Any `src/hooks/` file
- Any existing test file outside this sprint's scope
- Any RDB code path

If a touch outside this list seems necessary, STOP and surface it as an assumption.

## Invariants

- **No JS eval, never** — no `eval`, `new Function`, `Function(...)`, `setTimeout(string,...)`, `setInterval(string,...)`.
- **Pure module** — no side effects, no network, no filesystem, no global state.
- **Never throws** on user input. Malformed input returns `ParsedMongoshError`. Only programmer errors (wrong-type non-string input) may panic.
- **13-method whitelist is the single source of truth** — exported once from the parser module; no duplicate constant.
- **BSON output is canonical-extjson-compatible** — match backend `flatten_cell` expectations.
- **Discriminated union return shape** — `kind: "success" | "error"` (not `success: boolean`).
- **TDD discipline**: vertical slice, RED → GREEN per test, one test → one minimum implementation, then next test. No bulk-write-tests-then-bulk-write-implementation.
- **No `any` in TypeScript** — use `unknown` + type narrowing; `interface` for prop/shape types.
- **Convention discipline** per `.claude/rules/react-conventions.md` and `.claude/rules/testing.md`.

## Done Criteria

1. `pnpm vitest run src/lib/mongo/mongoshParser` exits 0.
2. `pnpm vitest run --coverage src/lib/mongo/mongoshParser` reports ≥90% line coverage on the parser module.
3. `pnpm tsc --noEmit` exits 0.
4. `pnpm lint` exits 0.
5. `pnpm vitest run` (full suite) exits 0 — no regression.
6. `grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts` returns empty (zero matches).
7. ADR exists at `docs/archives/decisions/00NN-mongosh-parser-strategy/memory.md` (sequential ADR number after `0028`) with sections Decision / Rationale (cites R28.1) / Trade-offs / Consequences, AND is registered in the active list of `docs/archives/decisions/memory.md`.
8. The 13-method whitelist is exported as a single `readonly` tuple/array from `mongoshParser.ts` and imported by the parser test (no duplicate constant elsewhere).
9. Test suite covers the AC matrix from `contract.md`:
   - 13 happy-path methods (AC-02)
   - 6 BSON literal reifications (AC-03)
   - 13 refusal cases (AC-04, exact kind asserted)
10. Each new test file has a header comment with `Sprint 307` and reason per `feedback_test_documentation.md`.

## Verification Plan

- **Profile**: `command`
- **Required checks**:
  1. `pnpm vitest run src/lib/mongo/mongoshParser` exit 0
  2. `pnpm vitest run --coverage src/lib/mongo/mongoshParser` line ≥90%
  3. `pnpm tsc --noEmit` exit 0
  4. `pnpm lint` exit 0
  5. `pnpm vitest run` (full) exit 0
  6. `grep -E "\b(eval|new Function)\b" src/lib/mongo/mongoshParser.ts src/lib/mongo/bsonLiterals.ts` empty
  7. ADR file exists + registered in index
- **Required evidence**:
  - Per-AC test name(s) that prove it
  - Coverage % from check #2 (cite the report line)
  - ADR file path + chosen strategy + one-line R28.1 rationale
  - `git diff --name-only` snapshot showing zero out-of-scope files modified

## Evidence To Return

- **Changed files and purpose** — list `<path>: <one-line purpose>` for each.
- **Checks run and outcomes** — exit code + key metric line for each of the 7 required checks.
- **Done criteria coverage with evidence** — for each of the 10 done criteria, the test name / command / file path that proves it.
- **Assumptions made during implementation** — e.g. "chose handwritten parser over WASM because bundle-size cost of WASM mongosh-parser exceeds 200KB" (or whatever the actual decision is).
- **Residual risk or verification gaps** — anything the parser cannot yet handle that future slices will need (e.g. `bulkWrite` op shapes that are sparsely tested).

## TDD Workflow Reminder (per `.claude/skills/tdd`)

The TDD skill is loaded — follow it strictly:
1. **Plan**: list the testable behaviours from the AC matrix (32 behaviours = 13 happy + 6 BSON + 13 refusal). Prioritize the "tracer bullet" — a single happy-path `find()` parse — first.
2. **Tracer bullet**: write the first RED test (e.g. `it("parses db.users.find({age: {$gt: 30}})")`) → minimal implementation that turns it GREEN.
3. **Incremental vertical slices**: RED → GREEN, one behaviour at a time. No horizontal slicing (don't write all 32 tests, then write all parsing). Each test informs the next implementation step.
4. **Refactor only on GREEN**: extract tokenizer / AST walker / BSON literal reifiers once tests pass — never while red.

## References

- **Contract**: `docs/sprints/sprint-307/contract.md`
- **Spec**: `docs/sprints/sprint-307/spec.md`
- **Phase definition**: `docs/phases/phase-28.md`
- **Grill decisions**: `docs/archives/roadmaps/memory-roadmap/phase-28-mongo-full-support/memory.md`
- **Existing Mongo autocomplete (constants to reuse)**: `src/lib/mongo/mongoAutocomplete.ts` — `MONGO_QUERY_OPERATORS` (13 ops), `MONGO_AGGREGATE_STAGES`
- **Existing backend wire format**: `src-tauri/src/db/mongodb/queries.rs::flatten_cell` (BSON canonical-extjson expectation)
- **Conventions**: `.claude/rules/react-conventions.md`, `.claude/rules/testing.md`, `.claude/rules/test-scenarios.md`
- **ADR index**: `docs/archives/decisions/memory.md` — next available number is `0029` (sprint-296's `0028` is current latest)

import type { DatabaseType } from "@/types/connection";

/**
 * Issue #2116 — `src/types/adapterConformance.ts` is the single ledger for
 * adapter capability/DDL claims. Prose that restates a ledger fact is a copy,
 * and a copy goes stale the moment the ledger moves. PR #2103 kept turning up
 * stale copies it had no way to enumerate: a hand-written grep only sees the
 * wording it was written against, and that one missed line wraps and
 * contractions. This file is destination (c) of that issue — the committed
 * registry every surviving copy must be listed in, with the reason it survives
 * and the ledger facts it depends on.
 *
 * The guard that reads it is `capability_claim_registry.test.ts`.
 */

/** A ledger fact a prose copy restates, re-asserted against the live matrix. */
export interface ClaimFact {
  readonly dbType: DatabaseType;
  /** A `CONFORMANCE_CHECKS` id, e.g. `ddl.alterTable`. */
  readonly check: string;
  /** Which of the matrix's three per-area buckets the check must sit in. */
  readonly state: "supported" | "unsupported" | "deferred";
}

export interface CapabilityClaimRow {
  /** Repo-relative path, as `git ls-files` prints it. */
  readonly path: string;
  /**
   * Every phrase in this file the sweep matches, lowercased and
   * whitespace-collapsed. A phrase that stops matching fails the guard, so a
   * reworded copy cannot leave a dead row behind.
   */
  readonly phrases: readonly string[];
  /**
   * `ledger-dependent` — the prose restates `claims`, and the guard re-asserts
   * each fact, so flipping the ledger turns this row red and names the file.
   * `not-a-claim` — the sweep pattern is broader than the claim class and this
   * text is not an adapter capability statement.
   */
  readonly disposition: "ledger-dependent" | "not-a-claim";
  readonly claims?: readonly ClaimFact[];
  readonly reason: string;
}

/**
 * The four pattern classes of the #2116 inventory.
 *
 * `inventory` is the command the issue froze at rev dd1d9d0a, kept verbatim so
 * the guard can prove its own widening is load-bearing rather than cosmetic
 * (see the "widens the frozen inventory pattern" cases in the test). `pattern`
 * is what the guard actually sweeps with.
 */
export interface ClaimPattern {
  readonly id: ClaimPatternId;
  readonly pattern: RegExp;
  readonly inventory: RegExp;
}

export type ClaimPatternId =
  | "scope-narrowing"
  | "hidden-affordance"
  | "adapter-execution"
  | "atomicity-policy";

export const CLAIM_PATTERNS: readonly ClaimPattern[] = [
  {
    id: "scope-narrowing",
    // Widened: the frozen alternative was `SQLite structured DDL,` with a
    // trailing comma, which matched nothing in the tree it was written against
    // while four real claims used the same phrase without the comma. Anchoring
    // a claim pattern on punctuation is the same brittleness class as the
    // line-wrap and contraction misses.
    pattern:
      /bounded structured table creation|structured DDL beyond|structured DDL parity|other DDL surfaces|table\/index removal or rename|SQLite structured DDL|only create_table|create_table alone|bounded table-creation slice/gi,
    inventory:
      /bounded structured table creation|structured DDL beyond|structured DDL parity|Other DDL surfaces|table\/index removal or rename|SQLite structured DDL,|only create_table|create_table alone|bounded table-creation slice/gi,
  },
  {
    id: "hidden-affordance",
    pattern:
      /stays? hidden|가려져 있다|not yet a product-visible|claims table creation only|table creation alone/gi,
    inventory:
      /stay hidden|stays hidden|가려져 있다|not yet a product-visible|claims table creation only|table creation alone/gi,
  },
  {
    id: "adapter-execution",
    // Widened: the frozen alternation was `(can|cannot)`, which cannot see
    // `can't`. That is one of the two miss mechanisms #2103 hit, and the tree
    // still holds a live example (`IndexesEditor.tsx`, "adapter can't run it").
    pattern:
      /adapter (?:really )?can(?:not|[’']t| not)? (?:actually )?(?:execute|run)|adapter's DDL trait method executes|adapter rejects the write|adapter rejects rename|entry points the adapter really supports/gi,
    inventory:
      /adapter (?:really )?(?:can|cannot) (?:actually )?(?:execute|run)|adapter's DDL trait method executes|adapter rejects the write|adapter rejects rename|entry points the adapter really supports/gi,
  },
  {
    id: "atomicity-policy",
    // `policy C` takes a word boundary so it stays a label and does not start
    // matching "policy changes"; verified to keep the frozen hit count at 18.
    pattern:
      /partial-atomic|atomic policy|policy C\b|roll back the CREATE TABLE/gi,
    inventory:
      /partial-atomic|atomic policy|policy C|roll back the CREATE TABLE/gi,
  },
];

/**
 * Strip comment leaders, then collapse each block to one line.
 *
 * A capability claim is a sentence, and a sentence in this repo wraps: across
 * ~80-column markdown, across `///` and `//!` in Rust, across ` * ` in JSDoc. A
 * line-bounded sweep stops seeing the claim at the wrap, which is the miss
 * mechanism PR #2103 hit. Leaders come off first so a comment-only line
 * (`///`, `//!`, ` *`) becomes empty and then bounds a block the same way a
 * markdown blank line does — otherwise two unrelated doc-comment paragraphs
 * would fuse into one match window.
 *
 * The `!` is part of the leader alternative rather than an alternative of its
 * own: listing `//!` after `\/{2,3}` would never match, because the shorter
 * alternative wins first and leaves a bare `!` behind — which is neither empty
 * (so a `//!` line stops bounding blocks) nor strippable (so a claim wrapped
 * inside a `//!` block stays invisible). `src-tauri/` carries ~3000 `//!`
 * lines, one of them the SQLite native-DDL module header.
 *
 * Same contract as `src/types/queryLanguage.docs.test.ts` and
 * `unsupported_boundary_contracts.test.ts`, extended to source comments.
 */
export function normalizeProse(text: string): string {
  return text
    .replace(/^[^\S\n]*(?:\/{2,3}!?|\/\*+|\*\/|\*|#+|--)[^\S\n]?/gm, "")
    .split(/\n(?:[^\S\n]*\n)+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length > 0)
    .join("\n");
}

export interface ClaimHit {
  readonly patternId: ClaimPatternId;
  /** Lowercased matched text — the registry key. */
  readonly phrase: string;
}

/** Every claim-pattern hit in one file's text, after normalization. */
export function findClaimHits(text: string): readonly ClaimHit[] {
  const normalized = normalizeProse(text);
  return CLAIM_PATTERNS.flatMap(({ id, pattern }) =>
    [...normalized.matchAll(pattern)].map((match) => ({
      patternId: id,
      phrase: match[0].toLowerCase(),
    })),
  );
}

/**
 * The sweep's only exclusion. Both files quote every registered phrase by
 * construction, so sweeping them would register the registry against itself.
 * The test proves this exclusion removes a non-zero number of hits — the
 * frozen inventory's own `docs/archives/**`, `*.json` and `*.lock` clauses
 * removed zero, and no other exclusion survived that measurement.
 */
export const SWEEP_SELF_REFERENCE_PATHS: readonly string[] = [
  "tests/fixtures/capability_claim_registry.ts",
  "tests/fixtures/capability_claim_registry.test.ts",
];

/**
 * The 33 files the issue's frozen inventory named, at rev dd1d9d0a.
 *
 * This is the acceptance criterion in list form: every one of those 69 hits
 * must end up deleted, generated, or registered, so every file that still
 * exists must carry a row. Reproduce the list with the four `git grep -l`
 * commands in the issue body, unioned and sorted.
 */
export const FROZEN_INVENTORY_PATHS: readonly string[] = [
  "docs/contributor-guide/release/release-notes-support-matrix.md",
  "docs/contributor-guide/smoke-matrix/sqlite-file-dbms.md",
  "docs/product/current-support-snapshot.md",
  "docs/product/known-limitations-cross-cutting.md",
  "docs/product/known-limitations-rdbms.md",
  "docs/product/query-language-support-surface-matrix.md",
  "docs/roadmap/follow-up-queue.md",
  "docs/roadmap/h2.md",
  "src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs",
  "src-tauri/table-view-core/src/db/duckdb/ddl.rs",
  "src-tauri/table-view-core/src/db/postgres/mutations.rs",
  "src-tauri/table-view-core/src/db/traits.rs",
  "src-tauri/table-view-core/src/models/data_source.rs",
  "src-tauri/table-view-core/src/models/schema/ddl.rs",
  "src-tauri/tests/schema_integration.rs",
  "src/components/query/QueryHistoryPanel.per-tab.test.tsx",
  "src/components/schema/CreateTableDialog.constraints-chain.test.tsx",
  "src/components/schema/CreateTableDialog.constraints.test.tsx",
  "src/components/schema/CreateTableDialog.indexes.test.tsx",
  "src/components/schema/CreateTableDialog.tsx",
  "src/components/schema/CreateTableDialog/useCreateTableForm.ts",
  "src/components/schema/SchemaTree.tsx",
  "src/components/schema/SchemaTree/rows.tsx",
  "src/components/schema/StructurePanel.ddl-gate.test.tsx",
  "src/components/schema/StructurePanel.triggers.test.tsx",
  "src/components/schema/StructurePanel.tsx",
  "src/components/structure/ColumnsEditor.tsx",
  "src/components/structure/ConstraintsEditor.tsx",
  "src/components/structure/IndexesEditor.tsx",
  "src/types/dataSource.test.ts",
  "src/types/dataSource.ts",
  "src/types/schema.ts",
  "src/types/supportsDdl.test.ts",
];

/** SQLite's shipped DDL slice: `CREATE TABLE` through the Structure dialog. */
const SQLITE_CREATE_TABLE: readonly ClaimFact[] = [
  { dbType: "sqlite", check: "ddl.createTable", state: "supported" },
];

/**
 * The DDL SQLite runs natively. #2103 opened these three in the Rust adapter
 * and #1804 moved the ledger to match, closing the drift the previous
 * `SQLITE_ADAPTER_AHEAD_OF_LEDGER` set existed to record.
 */
const SQLITE_NATIVE_DDL: readonly ClaimFact[] = [
  { dbType: "sqlite", check: "ddl.alterTable", state: "supported" },
  { dbType: "sqlite", check: "ddl.createIndex", state: "supported" },
  { dbType: "sqlite", check: "ddl.dropObject", state: "supported" },
];

/**
 * The boundary #1804 deliberately did not cross. SQLite fixes a column's type,
 * NOT NULL and DEFAULT — and any constraint — when the table is created, so
 * changing one needs the 12-step rebuild the 2026-07-25 owner grill ruled out.
 * Unsupported on both sides: the adapter refuses both, preview included.
 */
const SQLITE_NEEDS_REBUILD: readonly ClaimFact[] = [
  { dbType: "sqlite", check: "ddl.modifyColumn", state: "unsupported" },
  { dbType: "sqlite", check: "ddl.alterConstraint", state: "unsupported" },
];

/** What a page states when it describes the whole SQLite DDL boundary. */
const SQLITE_DDL_BOUNDARY: readonly ClaimFact[] = [
  ...SQLITE_CREATE_TABLE,
  ...SQLITE_NATIVE_DDL,
  ...SQLITE_NEEDS_REBUILD,
];

/** DuckDB's ADR 0051 Stage 2b slices — planned, so deferred, not unsupported. */
const DUCKDB_STAGE_2B: readonly ClaimFact[] = [
  { dbType: "duckdb", check: "ddl.alterConstraint", state: "deferred" },
  { dbType: "duckdb", check: "ddl.identityColumn", state: "deferred" },
];

/** The four DDL actions a gate comment means by "all four" / "these four". */
const BASE_DDL_ACTIONS = [
  "ddl.createTable",
  "ddl.alterTable",
  "ddl.createIndex",
  "ddl.dropObject",
] as const;

/**
 * `supported` facts for one check set across the engines a comment contrasts
 * with SQLite. Each call site lists exactly the engines and checks its prose
 * names, so a row can be read against the sentence it is registered for.
 */
function supportedDdl(
  dbTypes: readonly DatabaseType[],
  checks: readonly string[],
): readonly ClaimFact[] {
  return dbTypes.flatMap((dbType) =>
    checks.map((check) => ({ dbType, check, state: "supported" as const })),
  );
}

/** The two engines whose hidden constraint/identity controls the docs name. */
const HIDDEN_CONSTRAINT_CONTROLS: readonly ClaimFact[] = [
  ...DUCKDB_STAGE_2B,
  { dbType: "sqlite", check: "ddl.alterConstraint", state: "unsupported" },
  { dbType: "sqlite", check: "ddl.identityColumn", state: "unsupported" },
];

/**
 * Why so much of `src/**` is `not-a-claim`: those comments describe the *gate*
 * ("when the flag is false the control hides"), which is true for every engine
 * and stays true whatever the ledger says. Only prose that names an engine can
 * be falsified by a ledger move, and that prose is what carries `claims`.
 *
 * What the guard checks is placement, not truthfulness. It proves a matched
 * sentence is registered and that a `ledger-dependent` row's `claims` still
 * hold in the matrix — it never reads the sentence. A `not-a-claim` row is
 * taken at its word, and nothing compares a `ledger-dependent` row's `claims`
 * against the prose they were chosen for, so both stay a human judgement
 * recorded in `reason` and reviewable by opening the cited lines.
 *
 * ponytail: the key is (path, phrase), so a second copy of an
 * already-registered phrase inside an already-registered file is not caught —
 * adding "the SQLite adapter cannot run ALTER" to `ColumnsEditor.tsx` reuses
 * the registered "adapter cannot run". Every engine-naming copy found at rev
 * dd1d9d0a lives in docs, where the phrases are specific enough for this to
 * bite. Upgrade path if that changes: key on the phrase plus a fixed window of
 * surrounding normalized text, and accept the churn on nearby edits.
 */
export const CAPABILITY_CLAIM_REGISTRY: readonly CapabilityClaimRow[] = [
  {
    path: "docs/contributor-guide/release/release-notes-support-matrix.md",
    phrases: [],
    disposition: "ledger-dependent",
    claims: [...SQLITE_NATIVE_DDL, ...SQLITE_NEEDS_REBUILD],
    reason:
      "Retired phrase, live claim. The SQLite row said 'Structured DDL parity " +
      "and sqlite-cli execution remain unsupported'; #1804 reworded it to name " +
      "what SQLite runs natively and what a table rebuild would be needed for, " +
      "which no pattern class matches. Product-facing, so it states the " +
      "boundary rather than pointing at a TypeScript module.",
  },
  {
    path: "docs/contributor-guide/smoke-matrix/sqlite-file-dbms.md",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "Smoke matrix states what the SQLite desktop smoke does and does not " +
      "cover; the evidence map is the page's whole purpose and cannot be " +
      "replaced by a ledger pointer.",
  },
  {
    path: "docs/product/current-boundaries.md",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "The SQLite bullet reads 'SQLite structured DDL … remain future " +
      "promotion gates' while the ledger has claimed ddl.createTable since " +
      "#874. The frozen inventory could not see it — the phrase wraps across " +
      "a line and the frozen alternative required a trailing comma.",
  },
  {
    path: "docs/product/current-support-snapshot.md",
    phrases: ["sqlite structured ddl"],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "The phrase opens the `## SQLite` section's DDL sentence, which is " +
      "where a reader looks for the current boundary, so the sentence stays " +
      "and these claims are what a ledger move measures it against. It has " +
      "to be a phrase rather than a retired one: the file's other row keeps " +
      "`structured ddl parity` for the PostgreSQL section, so this file never " +
      "sweeps clean and a phrase-less row here would be red.",
  },
  {
    path: "docs/product/current-support-snapshot.md",
    phrases: ["structured ddl parity"],
    disposition: "not-a-claim",
    reason:
      "The file's only 'structured DDL parity' is :33, under `## PostgreSQL`, " +
      "listing what PostgreSQL support does not guarantee (roles/users, " +
      "extension management, DB-level import/export). None of those has a " +
      "CONFORMANCE_CHECKS id — the `ddl.*` checks cover table, column, " +
      "index and constraint actions only — so there is no fact to bind, and " +
      "binding it to the SQLite claims, as this row used to, made a ledger " +
      "flip name a file section that never mentioned SQLite.",
  },
  {
    path: "docs/product/known-limitations-cross-cutting.md",
    phrases: ["bounded structured table creation"],
    disposition: "ledger-dependent",
    claims: SQLITE_CREATE_TABLE,
    reason:
      "The SQLite smoke sentence (:127) in `### Runtime E2E smoke coverage` " +
      "restates the shipped slice. The surrounding non-widening list is " +
      "phrased per smoke rather than per capability, so only the table " +
      "creation claim maps onto a ledger check.",
  },
  {
    path: "docs/product/known-limitations-cross-cutting.md",
    phrases: ["structured ddl parity"],
    disposition: "not-a-claim",
    reason:
      "Same section, but :122 is the PostgreSQL smoke sentence — 'it does not " +
      "widen roles/users, extension management, profiler, import/export, " +
      "broader admin, or broader structured DDL parity'. None of those " +
      "surfaces has a CONFORMANCE_CHECKS id, so nothing binds; postgresql's " +
      "own `ddl.*` checks are all supported and say nothing about them.",
  },
  {
    path: "docs/product/known-limitations-rdbms.md",
    phrases: ["stay hidden"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_DDL_BOUNDARY, ...DUCKDB_STAGE_2B],
    reason:
      "The three scope-narrowing phrases sit in `### SQLite` (:127-:136). " +
      "'stay hidden' occurs twice and in neither case for SQLite: :79 is the " +
      "MySQL-family trigger controls, which the ledger models no check for, " +
      "and :167 is DuckDB's Constraints/Identity pair. The SQLite " +
      "identityColumn fact this row used to carry appears nowhere in the " +
      "file, so a flip named a page with no basis for it.",
  },
  {
    path: "docs/product/query-language-support-surface-matrix.md",
    phrases: ["stay hidden"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_DDL_BOUNDARY, ...DUCKDB_STAGE_2B],
    reason:
      "`## SQLite SQL` (:113, :122) states the CREATE TABLE-only boundary, " +
      "and `## DuckDB SQL` (:162) ties hidden controls to ddl.alterConstraint " +
      "/ ddl.identityColumn. The page's second 'stay hidden' (:240) is under " +
      "`## Valkey redis-command target` for unpromoted completion families, " +
      "which is not a DDL claim; one phrase cannot separate the two uses.",
  },
  {
    path: "docs/product/query-language-support-surface-matrix.md",
    phrases: ["structured ddl parity"],
    disposition: "not-a-claim",
    reason:
      "The file's only 'structured DDL parity' is :41, under `## PostgreSQL " +
      "SQL`, saying roles/users and broader parity are not modeled. Neither " +
      "has a CONFORMANCE_CHECKS id, so nothing binds.",
  },
  {
    path: "docs/roadmap/follow-up-queue.md",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "Retired phrase, live claim. The entry scoped queued SQLite file-DBMS " +
      "work to the 'bounded structured table creation' slice; #1804 reworded " +
      "it to the DDL SQLite runs natively plus the rebuild-requiring changes " +
      "held back, which no pattern class matches. It is still the queue entry " +
      "a ledger move has to reopen, so it carries the whole boundary.",
  },
  {
    path: "docs/roadmap/h2.md",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "H2 roadmap records what #874 did and did not promote; the non-claim " +
      "list is the point of the entry.",
  },
  {
    path: "e2e/smoke/sqlite.spec.ts",
    phrases: ["sqlite structured ddl"],
    disposition: "ledger-dependent",
    claims: SQLITE_CREATE_TABLE,
    reason:
      "Smoke step name for the runtime proof behind ddl.createTable. If the " +
      "ledger ever drops the claim this step is asserting a capability the " +
      "product no longer offers.",
  },
  {
    path: "src-tauri/table-view-core/src/db/adapters/sqlite/ddl_native.rs",
    phrases: ["sqlite structured ddl"],
    disposition: "ledger-dependent",
    claims: SQLITE_NATIVE_DDL,
    reason:
      "Module header for the DDL #1804 opened natively. It states what the " +
      "adapter executes, which is currently wider than what the ledger " +
      "claims, so the row pins the three checks that differ. Moving any of " +
      "them turns this row red, which is the reread this header and the " +
      "SQLite `ddl` block in src/types/dataSource.ts have to get together.",
  },
  {
    path: "src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_CREATE_TABLE,
    reason:
      "Retired phrase, live claim. The raw-DDL rejection message used to name " +
      "the 'bounded table-creation slice'; #1804 reworded it to 'use the " +
      "Create Table dialog for the structured DDL that is open today' (:108), " +
      "which no pattern class matches. That sentence points the user at what " +
      "ddl.createTable claims, so the row carries the fact and a flip still " +
      "names the file — a phrase-less row is legal only while the file really " +
      "sweeps clean, which the frozen-inventory test asserts.",
  },
  {
    path: "src-tauri/table-view-core/src/db/duckdb/ddl.rs",
    phrases: ["stays hidden"],
    disposition: "ledger-dependent",
    claims: [
      { dbType: "duckdb", check: "ddl.alterConstraint", state: "deferred" },
    ],
    reason:
      "Comment on the DuckDB add_constraint probe: if the call starts " +
      "returning Ok the capability must flip with it. That is a standing " +
      "instruction to move the ledger, so it is bound to the ledger fact.",
  },
  {
    path: "src-tauri/table-view-core/src/db/duckdb/ddl.rs",
    phrases: ["atomic policy", "roll back the create table"],
    disposition: "ledger-dependent",
    claims: [
      { dbType: "duckdb", check: "ddl.alterConstraint", state: "deferred" },
    ],
    reason:
      "Not the shared chain contract, despite the wording: :99-107 documents " +
      "why DuckDB overrides `create_table_plan` instead of inheriting it, and " +
      "the reason is that `add_constraint` is Unsupported until Stage 2b, so " +
      "the default body would create the table and only then fail. Promoting " +
      "ddl.alterConstraint removes the override's justification.",
  },
  {
    path: "src-tauri/table-view-core/src/db/postgres/mutations.rs",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "PostgreSQL's own `COMMENT ON COLUMN` chain runs under policy C. It " +
      "names one engine and is true of it, but CONFORMANCE_CHECKS models no " +
      "atomicity check, so no ledger move can falsify it.",
  },
  {
    path: "src-tauri/table-view-core/src/db/traits.rs",
    phrases: ["atomic policy", "policy c"],
    disposition: "not-a-claim",
    reason:
      "Trait-level default impl for the partial-atomic chain, plus the #1804 " +
      "note that SQLite overrides it with a stricter single transaction. It " +
      "does name an engine, but what it says about that engine is transaction " +
      "semantics, and CONFORMANCE_CHECKS models no atomicity check — there is " +
      "no ledger fact a move could break.",
  },
  {
    path: "src-tauri/table-view-core/src/models/data_source.rs",
    phrases: [],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_NATIVE_DDL],
    reason:
      "Retired phrase, live claim. The SQLITE_RDB_CAPABILITIES declaration " +
      "comment ended 'the exact surface is the per-action ddl.* capability " +
      "set in src/types/dataSource.ts', which #1804 made false — the adapter " +
      "is now wider than that set — so that sentence is deleted and nothing " +
      "left in the file matches a pattern class. What is left still " +
      "enumerates which DDL the wired adapter runs, so the row carries the " +
      "facts a ledger move has to name the file for.",
  },
  {
    path: "src-tauri/table-view-core/src/models/schema/ddl.rs",
    phrases: ["atomic policy", "partial-atomic"],
    disposition: "not-a-claim",
    reason:
      "DDL request/response model docs, and since #1804 the SOT for who owns " +
      "the atomic policy: C is the default and an adapter may be stricter, " +
      "which SQLite now is. It names an engine, but what it says about that " +
      "engine is transaction semantics, and CONFORMANCE_CHECKS models no " +
      "atomicity check — no ledger move can falsify it.",
  },
  {
    path: "src-tauri/tests/schema_integration.rs",
    phrases: ["only create_table"],
    disposition: "not-a-claim",
    reason:
      "Pattern accident: the text is 'preview-only create_table_plan must not " +
      "create the table', so 'only create_table' spans the end of " +
      "'preview-only' and the start of 'create_table_plan'. It asserts " +
      "preview behaviour, not a capability boundary.",
  },
  {
    path: "src/components/query/QueryHistoryPanel.per-tab.test.tsx",
    phrases: ["stays hidden"],
    disposition: "not-a-claim",
    reason:
      "Pagination: 'Load more stays hidden until the current page is fully " +
      "revealed.' The hidden-affordance pattern is broader than the DDL " +
      "capability class and this is the collateral it picks up.",
  },
  {
    path: "src/components/schema/CreateTableDialog.constraints-chain.test.tsx",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Test header describing the chain this suite mocks and asserts: table " +
      "plus COMMENT in one transaction, then indexes and constraints each in " +
      "their own. It reports the mocked scenario, not an engine's capability.",
  },
  {
    path: "src/components/schema/CreateTableDialog.constraints.test.tsx",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Same mocked-chain header as the constraints-chain suite; it reports " +
      "what these tests drive, not an engine's capability.",
  },
  {
    path: "src/components/schema/CreateTableDialog.indexes.test.tsx",
    phrases: ["partial-atomic", "policy c", "roll back the create table"],
    disposition: "not-a-claim",
    reason:
      "Header for the declared-index leg of the mocked chain (the DataGrip " +
      "pattern), down to the PostgreSQL-shaped error text it asserts. " +
      "Rollback behaviour of a mocked call, not a capability.",
  },
  {
    path: "src/components/schema/CreateTableDialog.tsx",
    phrases: [],
    disposition: "not-a-claim",
    reason:
      "Component doc for the commit path. It stated policy C flatly, which " +
      "#1804 made false for SQLite, so the sentence is deleted and the file " +
      "sweeps clean. The atomic-policy SOT is db/traits.rs (:425-433) and " +
      "models/schema/ddl.rs, both of which #1804 updated. Transaction " +
      "semantics either way, which the ledger models no check for.",
  },
  {
    path: "src/components/schema/CreateTableDialog/useCreateTableForm.ts",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Hook docs for the preview/commit closures. The policy-C sentence in " +
      "the module doc, which #1804 made false for SQLite, is deleted; what " +
      "still matches is the inline comment on the execute path (:504). " +
      "Transaction semantics, not capability.",
  },
  {
    path: "src/components/schema/SchemaTree.tsx",
    phrases: ["adapter can execute"],
    disposition: "ledger-dependent",
    claims: supportedDdl(
      ["sqlite", "duckdb", "mssql", "oracle"],
      ["ddl.createTable", "ddl.alterTable", "ddl.dropObject"],
    ),
    reason:
      "The comment states the gate rule and then works four engines through " +
      "it: 'DuckDB (#1070), MSSQL (#1071), Oracle (#1072) and SQLite (#1804) " +
      "claim all three, so every entry shows.' Each of those is a ledger " +
      "fact, which is why this row is not the engine-agnostic gate note it " +
      "was first registered as. SQLite moved into the claiming set with " +
      "#1804 — it was the one engine the sentence used to carve out.",
  },
  {
    path: "src/components/schema/SchemaTree/rows.tsx",
    phrases: ["adapter rejects rename"],
    disposition: "not-a-claim",
    reason:
      "Explains why the rename affordance is gated on `canAlterTable` rather " +
      "than opening a dialog that errors. Gate mechanics, engine-agnostic.",
  },
  {
    path: "src/components/schema/StructurePanel.ddl-gate.test.tsx",
    phrases: ["stays hidden"],
    disposition: "ledger-dependent",
    claims: [
      { dbType: "duckdb", check: "ddl.alterConstraint", state: "deferred" },
      ...SQLITE_DDL_BOUNDARY,
      ...supportedDdl(["postgresql"], BASE_DDL_ACTIONS),
    ],
    reason:
      "The header names three engines and asserts a ledger fact for each: " +
      "'SQLite — Columns tab shows + Column and per-row Delete, Indexes tab " +
      "shows Create index + drop-index, per-row Edit stays disabled on " +
      "modifyColumn', 'PostgreSQL (all DDL true) — both editors keep their " +
      "mutation controls', and 'DuckDB — Add constraint stays hidden " +
      "(alterConstraint false)'. Carrying only the DuckDB one, as this row " +
      "once did, left a sqlite ddl.alterTable flip unable to name the file " +
      "whose header asserts it.",
  },
  {
    path: "src/components/schema/StructurePanel.ddl-gate.test.tsx",
    phrases: ["adapter rejects the write"],
    disposition: "not-a-claim",
    reason:
      "Same header's statement of the gate rule for every RDB engine. Found " +
      "only after normalization — it wraps across 'the' / '// write', the " +
      "line-wrap blind spot #2103's sweeps could not see.",
  },
  {
    path: "src/components/schema/StructurePanel.triggers.test.tsx",
    phrases: ["stay hidden"],
    disposition: "not-a-claim",
    reason:
      "MySQL/MariaDB trigger create/drop controls. The ledger enumerates no " +
      "trigger check, so there is no fact to bind; promoting trigger CRUD " +
      "would mean adding a CONFORMANCE_CHECKS entry first.",
  },
  {
    path: "src/components/schema/StructurePanel.tsx",
    phrases: ["adapter rejects the write"],
    disposition: "ledger-dependent",
    claims: [
      ...SQLITE_DDL_BOUNDARY,
      ...supportedDdl(["duckdb", "mssql", "oracle"], BASE_DDL_ACTIONS),
    ],
    reason:
      "The comment states the gate rule and then works four engines through " +
      "it (:114-122), the same shape as the SchemaTree one: 'SQLite claims " +
      "only createTable, so its column / index editors are view-only; DuckDB " +
      "(#1070), MSSQL (#1071) and Oracle (#1072) now claim these four, so " +
      "their editors are live.' Every one of those is a ledger fact.",
  },
  {
    path: "src/components/structure/ColumnsEditor.tsx",
    phrases: ["adapter can run", "adapter cannot run"],
    disposition: "not-a-claim",
    reason:
      "Prop docs and JSX comments for the `canAlterTable` gate — 'when false " +
      "the row stays read-only'. True for every engine, names none.",
  },
  {
    path: "src/components/structure/ConstraintsEditor.tsx",
    phrases: [
      "adapter can run",
      "adapter can't run",
      "adapter cannot run",
      "adapter rejects the write",
    ],
    disposition: "not-a-claim",
    reason:
      "Prop docs and JSX comments for the `canAlterConstraint` gate. The " +
      "contraction here wraps across a line as well ('adapter can't' / '// " +
      "run ALTER TABLE ADD CONSTRAINT'), so both #2103 blind spots stack on " +
      "one sentence. The block names DuckDB as the engine the gate exists " +
      "for, but only as the reason `alterConstraint` split off " +
      "`alterTable` — the gate rule it states holds for every engine.",
  },
  {
    path: "src/components/structure/IndexesEditor.tsx",
    phrases: ["adapter can run", "adapter can't run", "adapter cannot run"],
    disposition: "not-a-claim",
    reason:
      "Prop docs and JSX comments for the `canCreateIndex` / `canDropObject` " +
      "gates. 'adapter can't run it' is the contraction the frozen " +
      "`(can|cannot)` alternation could not see.",
  },
  {
    path: "src/types/dataSource.test.ts",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "Retired phrase, live claim. Both comments grounded the SQLite `ddl` " +
      "flag literals on the adapter refusing everything but create_table, " +
      "which #1804 falsified, so both are deleted and the file sweeps clean. " +
      "The assertions themselves still pin the four flags, so a ledger move " +
      "has to name this file.",
  },
  {
    path: "src/types/dataSource.ts",
    phrases: ["adapter can run", "stay hidden", "stays hidden"],
    disposition: "ledger-dependent",
    claims: HIDDEN_CONSTRAINT_CONTROLS,
    reason:
      "This file feeds the ledger, and all three surviving phrases sit in " +
      "the alterConstraint and identityColumn docs, which name engines " +
      "('SQLite/DuckDB keep this false so the constraint controls stay " +
      "hidden', 'they keep the base false and the checkbox stays hidden'). " +
      "The `supportsDdl` doc, `supportsRowEditing`'s DDL paragraph and " +
      "SQLite's own `ddl` block each grounded a flag on what the wired " +
      "adapter can execute, which #1804 falsified, so those sentences are " +
      "deleted — with them go the create_table-only claims this row carried.",
  },
  {
    path: "src/types/schema.ts",
    phrases: [],
    disposition: "not-a-claim",
    reason:
      "Retired phrase. The `CreateTablePlanRequest` doc stated policy C for " +
      "every engine, which #1804 made false for SQLite, so the sentence is " +
      "deleted and the file sweeps clean. Transaction semantics either way, " +
      "which the ledger models no check for.",
  },
  {
    path: "src/types/supportsDdl.test.ts",
    phrases: [],
    disposition: "ledger-dependent",
    claims: SQLITE_DDL_BOUNDARY,
    reason:
      "The guard test for `supportsDdl`. Its header grounded the SQLite row " +
      "on the adapter refusing everything but create_table, which #1804 " +
      "falsified, so that bullet is deleted. What still matches is the case " +
      "name 'claims only createTable for SQLite (adapter wires create_table " +
      "alone)'.",
  },
];

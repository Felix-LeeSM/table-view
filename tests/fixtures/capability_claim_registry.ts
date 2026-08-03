import type { DatabaseType } from "@/types/connection";

/**
 * Issue #2116 — `src/types/adapterConformance.ts` is the single ledger for
 * adapter capability/DDL claims. Prose that restates a ledger fact is a copy,
 * and a copy goes stale the moment the ledger moves: PR #2103 spent three
 * review rounds on exactly that, and each round's sweep missed a different
 * slice (no command at all, then a line-wrap blind spot, then a contraction
 * blind spot). This file is destination (c) of that issue — the committed
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
 * ~80-column markdown, across `///` in Rust, across ` * ` in JSDoc. A
 * line-bounded sweep stops seeing the claim at the wrap, which is how PR
 * #2103's second round missed a slice. Leaders come off first so a
 * comment-only line (`///`, ` *`) becomes empty and then bounds a block the
 * same way a markdown blank line does — otherwise two unrelated doc-comment
 * paragraphs would fuse into one match window.
 *
 * Same contract as `src/types/queryLanguage.docs.test.ts` and
 * `unsupported_boundary_contracts.test.ts`, extended to source comments.
 */
export function normalizeProse(text: string): string {
  return text
    .replace(
      /^[^\S\n]*(?:\/{2,3}|\/\*+|\*\/|\*|#+|--|\/{2}!|\/{3}!)[^\S\n]?/gm,
      "",
    )
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

/** Everything SQLite's wired adapter still answers `Unsupported` to. */
const SQLITE_BEYOND_CREATE_TABLE: readonly ClaimFact[] = [
  { dbType: "sqlite", check: "ddl.alterTable", state: "unsupported" },
  { dbType: "sqlite", check: "ddl.createIndex", state: "unsupported" },
  { dbType: "sqlite", check: "ddl.dropObject", state: "unsupported" },
  { dbType: "sqlite", check: "ddl.alterConstraint", state: "unsupported" },
];

/** DuckDB's ADR 0051 Stage 2b slices — planned, so deferred, not unsupported. */
const DUCKDB_STAGE_2B: readonly ClaimFact[] = [
  { dbType: "duckdb", check: "ddl.alterConstraint", state: "deferred" },
  { dbType: "duckdb", check: "ddl.identityColumn", state: "deferred" },
];

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
    phrases: ["structured ddl parity"],
    disposition: "ledger-dependent",
    claims: SQLITE_BEYOND_CREATE_TABLE,
    reason:
      "Release-notes matrix row for SQLite: 'Structured DDL parity and " +
      "sqlite-cli execution remain unsupported.' Product-facing, so it states " +
      "the boundary rather than pointing at a TypeScript module.",
  },
  {
    path: "docs/contributor-guide/smoke-matrix/sqlite-file-dbms.md",
    phrases: [
      "bounded structured table creation",
      "structured ddl beyond",
      "structured ddl parity",
    ],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Smoke matrix states what the SQLite desktop smoke does and does not " +
      "cover; the evidence map is the page's whole purpose and cannot be " +
      "replaced by a ledger pointer.",
  },
  {
    path: "docs/product/current-boundaries.md",
    phrases: ["bounded structured table creation", "structured ddl beyond"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Issue #2116 corrected this bullet: it read 'SQLite structured DDL … " +
      "remain future promotion gates' while the ledger has claimed " +
      "ddl.createTable since #874. The frozen inventory could not see it — " +
      "the phrase wrapped across a line and the frozen alternative required a " +
      "trailing comma.",
  },
  {
    path: "docs/product/current-support-snapshot.md",
    phrases: [
      "bounded structured table creation",
      "structured ddl parity",
      "table/index removal or rename",
    ],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Per-engine support snapshot; the SQLite section is where a reader " +
      "looks for the current boundary, so the sentence stays and the ledger " +
      "link keeps it honest.",
  },
  {
    path: "docs/product/known-limitations-cross-cutting.md",
    phrases: ["bounded structured table creation", "structured ddl parity"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Cross-cutting limitations page enumerates what each smoke does not " +
      "widen; the SQLite clause restates the ledger's DDL boundary.",
  },
  {
    path: "docs/product/known-limitations-rdbms.md",
    phrases: [
      "bounded structured table creation",
      "structured ddl parity",
      "table/index removal or rename",
      "stay hidden",
    ],
    disposition: "ledger-dependent",
    claims: [
      ...SQLITE_CREATE_TABLE,
      ...SQLITE_BEYOND_CREATE_TABLE,
      ...HIDDEN_CONSTRAINT_CONTROLS,
    ],
    reason:
      "Carries both the SQLite DDL boundary and the constraint/Identity " +
      "hidden-control claim that names ddl.alterConstraint and " +
      "ddl.identityColumn. The same 'stay hidden' phrase also covers the " +
      "MySQL-family trigger controls, which the ledger models no check for; " +
      "one phrase cannot separate the two uses.",
  },
  {
    path: "docs/product/query-language-support-surface-matrix.md",
    phrases: [
      "bounded structured table creation",
      "structured ddl parity",
      "table/index removal or rename",
      "stay hidden",
    ],
    disposition: "ledger-dependent",
    claims: [
      ...SQLITE_CREATE_TABLE,
      ...SQLITE_BEYOND_CREATE_TABLE,
      ...DUCKDB_STAGE_2B,
    ],
    reason:
      "Per-language surface matrix: the SQLite section states the CREATE " +
      "TABLE-only boundary and the DuckDB section ties hidden controls to " +
      "ddl.alterConstraint / ddl.identityColumn. The page also uses 'stay " +
      "hidden' for Redis completion families, which is not a DDL claim.",
  },
  {
    path: "docs/roadmap/follow-up-queue.md",
    phrases: ["bounded structured table creation"],
    disposition: "ledger-dependent",
    claims: SQLITE_CREATE_TABLE,
    reason:
      "Scopes queued SQLite file-DBMS work to the shipped slice; widening the " +
      "ledger is exactly the event that should reopen this queue entry.",
  },
  {
    path: "docs/roadmap/h2.md",
    phrases: [
      "bounded structured table creation",
      "structured ddl parity",
      "table/index removal or rename",
    ],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
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
    path: "src-tauri/table-view-core/src/db/adapters/sqlite/ddl.rs",
    phrases: ["sqlite structured ddl"],
    disposition: "ledger-dependent",
    claims: [
      ...SQLITE_CREATE_TABLE,
      { dbType: "sqlite", check: "ddl.createIndex", state: "unsupported" },
      { dbType: "sqlite", check: "ddl.alterConstraint", state: "unsupported" },
    ],
    reason:
      "The adapter that makes the ledger true, plus the two user-visible " +
      "`Unsupported` error strings ('does not support index creation' / " +
      "'standalone constraints'). Wiring either path without moving the " +
      "ledger is the drift this row exists to catch.",
  },
  {
    path: "src-tauri/table-view-core/src/db/adapters/sqlite/queries.rs",
    phrases: ["bounded table-creation slice"],
    disposition: "ledger-dependent",
    claims: SQLITE_CREATE_TABLE,
    reason:
      "Raw-DDL rejection message points the user at the structured slice the " +
      "ledger claims; the sentence is user-facing error copy.",
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
    disposition: "not-a-claim",
    reason:
      "Transaction semantics of the CREATE TABLE chain (an index failure does " +
      "not roll back the table). Identical for every adapter and unaffected " +
      "by any capability flag, so the ledger holds no fact to bind it to.",
  },
  {
    path: "src-tauri/table-view-core/src/db/postgres/mutations.rs",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Same partial-atomic chain contract as duckdb/ddl.rs — transaction " +
      "semantics, not an adapter capability claim.",
  },
  {
    path: "src-tauri/table-view-core/src/db/traits.rs",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Trait-level default impl documenting the partial-atomic chain every " +
      "adapter inherits; describes ordering, not support.",
  },
  {
    path: "src-tauri/table-view-core/src/models/data_source.rs",
    phrases: ["other ddl surfaces"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Rust-side SQLITE_RDB_CAPABILITIES declaration comment. This is the " +
      "backend half of the same claim the TypeScript ledger holds, so the two " +
      "must move together.",
  },
  {
    path: "src-tauri/table-view-core/src/models/schema/ddl.rs",
    phrases: ["atomic policy", "partial-atomic"],
    disposition: "not-a-claim",
    reason:
      "DDL request/response model docs for the partial-atomic commit chain — " +
      "transaction semantics shared by every engine.",
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
      "Test header describing the partial-atomic commit chain under test — " +
      "transaction semantics, engine-independent.",
  },
  {
    path: "src/components/schema/CreateTableDialog.constraints.test.tsx",
    phrases: ["atomic policy"],
    disposition: "not-a-claim",
    reason:
      "Same partial-atomic chain header as the constraints-chain test — " +
      "transaction semantics, engine-independent.",
  },
  {
    path: "src/components/schema/CreateTableDialog.indexes.test.tsx",
    phrases: ["partial-atomic", "policy c", "roll back the create table"],
    disposition: "not-a-claim",
    reason:
      "Test header for the declared-index leg of the partial-atomic chain " +
      "(the DataGrip pattern); describes rollback behaviour, not support.",
  },
  {
    path: "src/components/schema/CreateTableDialog.tsx",
    phrases: ["partial-atomic", "policy c", "roll back the create table"],
    disposition: "not-a-claim",
    reason:
      "Component doc comment for the commit path's rollback contract — " +
      "transaction semantics, identical for every engine that reaches it.",
  },
  {
    path: "src/components/schema/CreateTableDialog/useCreateTableForm.ts",
    phrases: [
      "atomic policy",
      "partial-atomic",
      "policy c",
      "roll back the create table",
    ],
    disposition: "not-a-claim",
    reason:
      "Hook doc comments for the preview/commit closures under the same " +
      "partial-atomic contract — transaction semantics, not capability.",
  },
  {
    path: "src/components/schema/SchemaTree.tsx",
    phrases: ["adapter can execute"],
    disposition: "not-a-claim",
    reason:
      "Describes the gate itself — each schema-tree DDL entry reads its own " +
      "`ddl.*` flag. Names no engine, so no ledger move can falsify it.",
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
    ],
    reason:
      "The DuckDB case in this test's header states 'Add constraint stays " +
      "hidden (alterConstraint false)', which is the ledger fact the test " +
      "asserts.",
  },
  {
    path: "src/components/schema/StructurePanel.ddl-gate.test.tsx",
    phrases: ["adapter rejects the write"],
    disposition: "not-a-claim",
    reason:
      "Same header's statement of the gate rule for every RDB engine. Found " +
      "only after normalization — it wraps across 'the' / '// write', which " +
      "is one of the two blind spots #2103 lost a round to.",
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
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "The comment states the gate rule and then names SQLite: 'SQLite claims " +
      "only createTable'. The engine-specific half is what a ledger move " +
      "falsifies.",
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
      "one sentence.",
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
    phrases: ["only create_table"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "Both comments justify the SQLite ddl flag literals the test asserts: " +
      "'wired SqliteAdapter executes only create_table; other DDL trait " +
      "methods return Unsupported'.",
  },
  {
    path: "src/types/dataSource.ts",
    phrases: [
      "stay hidden",
      "stays hidden",
      "entry points the adapter really supports",
    ],
    disposition: "ledger-dependent",
    claims: [
      ...SQLITE_CREATE_TABLE,
      ...SQLITE_BEYOND_CREATE_TABLE,
      ...HIDDEN_CONSTRAINT_CONTROLS,
    ],
    reason:
      "Capability declarations name their engines: 'SQLite/DuckDB keep this " +
      "false so the constraint controls stay hidden' and 'e.g. SQLite: " +
      "createTable true, alter/index/drop false'. This file feeds the ledger, " +
      "so its comments and the matrix must move together.",
  },
  {
    path: "src/types/dataSource.ts",
    phrases: [
      "adapter can actually execute",
      "adapter can run",
      "adapter's ddl trait method executes",
    ],
    disposition: "not-a-claim",
    reason:
      "Doc comments defining what a `ddl.*` flag means — grounded on whether " +
      "the trait method executes or returns Unsupported. Definitions of the " +
      "ledger's own vocabulary, not copies of a per-engine fact.",
  },
  {
    path: "src/types/schema.ts",
    phrases: ["atomic policy", "partial-atomic"],
    disposition: "not-a-claim",
    reason:
      "Schema DTO doc for the commit-time rollback contract — transaction " +
      "semantics shared across engines.",
  },
  {
    path: "src/types/supportsDdl.test.ts",
    phrases: ["adapter can actually execute", "create_table alone"],
    disposition: "ledger-dependent",
    claims: [...SQLITE_CREATE_TABLE, ...SQLITE_BEYOND_CREATE_TABLE],
    reason:
      "The guard test for `supportsDdl`; its header lists per-engine grounds " +
      "and one case is named 'claims only createTable for SQLite (adapter " +
      "wires create_table alone)'.",
  },
];

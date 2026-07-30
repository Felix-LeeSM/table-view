# H7 Ops, Security, And Reliability Smoke Matrix

Smoke matrix band. Parent index:
[`docs/contributor-guide/testing-and-quality.md`](../testing-and-quality.md).
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../../product/known-limitations.md).

This matrix is the H7 gate-alignment record. It separates the current automated
gate surface from future ops/security/a11y/perf work so docs do not imply
routine coverage that is not wired into CI or hooks.

## PR/main CI gate surface

Current evidence:

- `.github/workflows/ci.yml`
- `.github/workflows/e2e-smoke.yml`

Merge-blocking membership is deliberately not restated here. The `pr_to_main`
ruleset's required contexts are listed once, in
[`memory/runbook/pr-merge-gates/memory.md`](../../../memory/runbook/pr-merge-gates/memory.md).
Nothing verifies that a copy kept here still matches the workflows, and three
copies across the repo had already gone stale by #1845.

What the individual jobs own:

- `Frontend Checks` aggregates the three-shard vitest matrix, applies
  `vite.config.ts`'s coverage thresholds to the merged report, and runs
  `pnpm lint` and `pnpm build`.

- `Dependency Security` runs `cargo deny check bans licenses sources` in
  `src-tauri`. RUSTSEC advisories are decoupled into `Dependency Advisories`,
  which is `continue-on-error` so one new external advisory cannot turn every
  open PR red at once.

- `Rust Static Analysis` runs `cargo fmt --check` and
  `cargo clippy --all-targets --all-features -- -D warnings`. There are no local
  git hooks, so this is the only place either check runs.

- `Integration Tests (Docker)` runs the Rust integration coverage cutoffs
  (`cargo llvm-cov nextest --profile push`, lines 80 / functions 75 /
  regions 80, written as literals in the workflow).

- `Detect Change Scope`, `PR Body Contract` and `Runtime Happy Path` are
  name-only jobs: required contexts that cannot fail and verify nothing.

No job is change-gated — every job runs on every push and pull request, so a
docs-only PR pays for the full suite and no skipped check ever stands in for an
unverified one. Full a11y, perf, and macOS/Windows runtime smoke are not routine
blocking checks.

## Runtime Happy Path E2E

Current evidence:

- `.github/workflows/e2e-smoke.yml`
- `e2e/smoke/postgres.spec.ts`
- `e2e/smoke/postgres-safe-mode.spec.ts`
- `e2e/smoke/postgres-explain.spec.ts`
- `e2e/smoke/postgres-extension-completion.spec.ts`
- `e2e/smoke/postgres-cancellation.spec.ts`
- `e2e/smoke/postgres-structure-ddl.spec.ts`
- `e2e/smoke/erd-dense.spec.ts`
- `e2e/smoke/mysql.spec.ts`
- `e2e/smoke/mariadb.spec.ts`
- `e2e/smoke/sqlite.spec.ts`
- `e2e/smoke/duckdb.spec.ts`
- `e2e/smoke/duckdb-file-analytics.spec.ts`
- `e2e/smoke/mongodb.spec.ts`
- `e2e/smoke/redis.spec.ts`
- `e2e/smoke/valkey.spec.ts`
- `e2e/smoke/elasticsearch.spec.ts`
- `e2e/smoke/opensearch.spec.ts`
- `e2e/smoke/mssql.spec.ts`
- `e2e/smoke/oracle.spec.ts`

Current gap / routing:

The remote runtime gate builds the app on Ubuntu and executes wired PostgreSQL,
MySQL, MariaDB, SQLite, DuckDB `.duckdb`, DuckDB file analytics, MongoDB, Redis,
Valkey, Elasticsearch, OpenSearch, MSSQL, and Oracle smoke specs. MSSQL/Oracle
smoke is bounded to representative connect, seeded catalog browse, SELECT/DML,
destructive Safe Mode confirmation, cancellation, and grid edit paths and does
not create structured
DDL/raw-admin/full-parser-completion/PLSQL/full-T-SQL/full-Oracle semantics
claims. DuckDB `.duckdb` smoke is scoped to open/browse/SELECT/history/read-only
evidence; DuckDB file analytics smoke is scoped to registered deterministic CSV
source -> global editor SELECT -> result grid -> `FILE` history/source evidence
-> no absolute local path in visible UI. MySQL/MariaDB smoke includes the narrow
seeded CALL result path behind WARN preview, not broad routine execution
support. The PostgreSQL Structure DDL smoke is scoped to one table plus one
index with history/source and schema refresh proof. The dense ERD smoke is
scoped to graph render/search/selection/zoom/fit/desktop+narrow screenshot
evidence and does not claim FK row navigation, schema diff, migration impact, or
data compare. The workflow contract test keeps matrix keys, spec paths, script
default routing, and SQLite/DuckDB visible assertion evidence aligned.
`wdio.smoke.conf.ts` can discover more smoke specs, but
 must wire a spec before it becomes part of the routine
remote gate.

## Non-routine E2E smoke specs

Current evidence:

- `e2e/smoke/history-source-5.spec.ts`
- `e2e/smoke/phase-28-slice-A.spec.ts`
- `e2e/reset-to-default-audit.e2e.ts`

Current gap / routing:

These are scenario inventory or local/manual regression assets unless a
workflow/script invokes them. They do not currently expand the Runtime Happy
Path claim.

## Destructive/admin operation safety

Current evidence:

- `src-tauri/src/commands/rdb/ddl.rs`
- `src/components/datagrid/useDataGridEdit.safe-mode.test.ts`
- `src-tauri/src/commands/document/**`
- `src-tauri/src/db/kv_trait.rs`
- `src-tauri/src/db/search_destructive.rs`
- `src-tauri/src/db/search_live_destructive.rs`
- `docs/product/query-language-support.md`

Current gap / routing:

Current safety is source-specific: RDB DDL preview/confirm, RDB Safe Mode
confirmation paths, Mongo safety confirmation, Redis typed confirmation keys,
and Search fixture/live delete-by-query preview plan estimates with actual
execution unsupported. There is no universal dry-run, actual live Search admin
execution, admin audit log, role/user/permission UI, or security dashboard
claim.

## Credential and local-first privacy

Current evidence:

- `memory/engineering/architecture/state-management/memory.md`
- `docs/product/README.md`
- `docs/product/known-limitations.md`
- `src-tauri/src/commands/connection/crud.rs`
- `src-tauri/src/commands/connection/io.rs`
- `src-tauri/src/commands/keyring.rs`
- `src-tauri/tests/keyring_new_user.rs`
- `src-tauri/tests/keyring_linux_fallback.rs`
- `src/features/connection/components/ConnectionDialog.urlInput.test.tsx`
- `src/features/connection/components/ImportExportDialog.test.tsx`
- `src/features/connection/components/ImportExportDialog.ac149.test.tsx`
- `src/features/connection/components/KeyringFallbackToast.test.tsx`

Current gap / routing:

Current contract evidence covers save-password tri-state, redacted list
payloads, backend-only stored-password lookup, export password omission, import
password re-entry, empty keyring fallback sentinel writes, and secret-free
alert/status/aria-live feedback. DuckDB file analytics public payloads redact
absolute paths. Credential rotation, KDF changes, ACL, cloud credential UI,
code-signing, provider-secret decisions, broad key lifecycle smoke, and
multi-user security flows require threat-model handoff before promotion.

## Security decision process

Current evidence:


Current gap / routing:

Password, credential, encryption, KDF, file-sharing, ACL, code-signing,
supply-chain, or multi-user decisions need a threat-model handoff before option
grilling. H7 does not lock new security architecture by documentation-only
claim.

## Dependency security

Current evidence:

- `.github/workflows/ci.yml`
- `src-tauri/deny.toml`
- `docs/archives/risks/active-risk-register-2026-05-27.md`

Current gap / routing:

`cargo deny check` runs on local Rust/full pre-push routes and in CI as two
jobs: the blocking PR/main Dependency Security job runs
`cargo deny check bans licenses sources`, and the non-blocking Dependency
Advisories job runs `cargo deny check advisories` (decoupled 2026-07-02 so one
new RUSTSEC advisory cannot turn every unrelated PR and main push red at once).
Both jobs pin `cargo-deny` 0.19.9 and cache the installed binary/registry
inputs; the blocking job prints `src-tauri/deny.toml` plus `[advisories].ignore`
IDs. The blocking gate fails on denied licenses, banned crates, or untrusted
sources; new unignored advisories surface as the non-blocking advisory signal.
Tracked advisory ignores remain bounded follow-ups, including `hickory-proto`
through `mongodb 3.6.0`, `rustls-pemfile` through `oracle-rs 0.1.7`, `rsa 0.9`
through `sqlx-mysql`, and `quick-xml` (RUSTSEC-2026-0194/0195) through
`plist 1.8.0`. Node audit is deferred; runtime dependency upgrades remain
separate PRs.

## A11y

Current evidence:

`src/components/schema/SchemaTree.a11y-smoke.test.tsx`,
`src/components/datagrid/DataGridTable.a11y-smoke.test.tsx`,
`src/features/connection/components/ConnectionDialog.a11y-smoke.test.tsx`,
`src/features/connection/components/ImportExportDialog.a11y-smoke.test.tsx`,
component tests using roles/labels, and `.github/workflows/ci.yml` advisory
contrast step

Current gap / routing:

Critical component smoke covers SchemaTree tree/treeitem roles, DataGrid
grid/gridcell/edit feedback, ConnectionDialog labels/error feedback,
Import/Export labels/error feedback, and secret-free alert/status/aria-live
regions for credential/recovery paths. Routine VoiceOver/NVDA, focus-order,
Quick Open, candidate-source UI, and 72-theme strict WCAG gates are not wired.
Promote from the follow-up table only when a feature lane gives the check a
concrete owner and budget.

## Performance

Current evidence:

- `src-tauri/tests/snapshot_perf.rs`
- `src/components/schema/SchemaTree.perfFixtures.ts`
- `src/components/schema/SchemaTree.virtualization.test.tsx`
- `src/components/datagrid/DataGridTable.perfFixtures.ts`
- `src/components/datagrid/DataGridTable.virtualization.test.tsx`
- `src/lib/perf/advisoryTiming.ts`
- `docs/product/known-limitations.md`

Current gap / routing:

Snapshot perf keeps backend boot-state p95 budget. SchemaTree/DataGrid component
perf smoke has deterministic 1k/10k and page-size 1000 fixtures, virtualization
DOM-bound assertions, and advisory p50/p95/env output. These are calibration
signals only; they are not routine FPS, scroll, wheel-to-paint,
graph/vector/stream renderer, or CI-blocking latency budgets. Promote
FPS/latency budgets only with owner, runtime cost, and failure triage.

## Link checking

Current evidence:

- `package.json`
- `.github/workflows/ci.yml`

Current gap / routing:

`pnpm docs:links` checks active docs (`README.md`, `AGENTS.md`, `CLAUDE.md`,
`docs/ROADMAP.md`, `docs/product/**`, `docs/contributor-guide/**`,
`docs/roadmap/**`) for relative target and anchor resolution while excluding
`docs/archives/**` and `docs/sprints/**` as default source roots. CI runs it as advisory only; blocking
promotion remains future work after owner/runtime cost/actionability settle.

## Platform smoke

Current evidence:

- `.github/workflows/platform-smoke-canary.yml`
- `.github/workflows/e2e-smoke.yml`
- `.github/workflows/ci.yml`

Current gap / routing:

Runtime Happy Path remains the only blocking desktop runtime gate and is
Ubuntu/Linux only. The opt-in `workflow_dispatch` platform canary runs separate
macOS arm64 and Windows x86_64 install/Tauri no-bundle build jobs for evidence
gathering only; the Windows canary is pinned to `windows-2022` and sets
`CXXFLAGS=/std:c++17` for the MSVC DuckDB build. Canary failures are logged by
platform job and summary, but the canary is not required until owner, cost,
triage path, and repeated green runs exist. This does not prove macOS or Windows
desktop runtime support.

## E2E isolation

Current evidence:

- `e2e/fixtures/seed-smoke.ts`

Current gap / routing:

The current script gives each wired spec its own app data directory and resets
the matching fixture before each `run_wdio` invocation by passing the spec key
into `seed-smoke.ts`. App data directory isolation only separates local app
state; it does not reset external databases. PostgreSQL, MongoDB, MySQL,
MariaDB, Redis, and Valkey reset through their existing idempotent fixtures.
SQLite and DuckDB file-backed smokes keep their local-file behavior and have no
external DB reset. This does not add Cassandra, DynamoDB, graph, vector, stream,
or broader MSSQL/Oracle/Search service coverage beyond the already wired bounded
runtime specs.

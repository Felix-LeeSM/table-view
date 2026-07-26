# Testing And Quality Follow-Ups

This page collects developer-facing verification gaps and quality follow-ups.
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../product/known-limitations.md). Future
sequencing lives in [`docs/ROADMAP.md`](../ROADMAP.md). The retired risk register
is archived at
[`docs/archives/risks/active-risk-register-2026-05-27.md`](../archives/risks/active-risk-register-2026-05-27.md).

## Fixture And Test Topology SOT

Fixture/test topology is a support-claim control, not a product support
expansion. The durable rule owner is
`memory/engineering/conventions/testing-scenarios/fixtures/memory.md`; the
current evidence inventory is
[`docs/contributor-guide/fixture-test-topology-inventory.md`](fixture-test-topology-inventory.md);
the Refactor 05 support-claim audit ledger is
[`docs/archives/audits/refactor-05-support-claims-ledger-2026-06-12.md`](../archives/audits/refactor-05-support-claims-ledger-2026-06-12.md);
the product-facing support boundary stays in `docs/product/**`.

| Surface | Owner | Rule |
|---|---|---|
| DBMS-first E2E seeds | `e2e/fixtures/<dbms>/<function>/...` | Runtime seed topology is DBMS-first, then capability/function. Existing active functions are `query`, `document`, `kv`, and `search`; future `completion`, `catalog`, `explain`, `errors`, `edit`, `safety`, or `metadata` roots need a consuming test and promotion decision. |
| Smoke promotion decisions | `e2e/fixtures/smoke-routing-decisions.json` | Every fixture/root records `unit-only`, `integration-backed`, `dormant E2E`, or `blocking E2E` with cost/risk/support-claim impact before it can be cited in smoke evidence. |
| Shared contract fixtures | `tests/fixtures/**` | Shared TS/Rust/parser/support-boundary fixtures are contract evidence only. Unsupported-boundary fixtures are negative evidence and do not widen runtime support. |
| Backend adapter fixture harness | `src-tauri/src/db/fixtures.rs`, `src-tauri/tests/fixture_harness.rs` | Adapter fixtures are requested by profile/family/paradigm/capability. Missing fixture diagnostics are failures, not silent skips. Current embedded harness coverage is Search-only. |
| Generator/profile specs | `fixtures/**`, `scripts/fixtures/*.test.ts` | Generator/profile specs validate fixture tooling and local setup. Profile existence is not runtime support. |
| Test placement | `src/**`, `src-tauri/tests`, `e2e/smoke`, `scripts/fixtures` | Frontend unit/component tests stay near their feature/domain; Rust integration stays under `src-tauri/tests`; routine desktop smoke stays under script-wired `e2e/smoke`; fixture tooling tests stay under `scripts/fixtures`. |

Promotion gate: fixture path + consuming contract/integration/E2E test +
product docs or known-limitation review + smoke-routing decision. Fixture
existence alone is never runtime evidence.

Refactor 04 closure evidence is #750 -> #833, #751 -> #835, #752 -> #836,
#753 -> #843, #754 -> #838, #769 -> #837, #770 -> #839, #771 -> #842,
#772 -> #840, and #773 -> #841. Parent #575 and milestone #40 closed after #755
landed and live GitHub showed no open Refactor 04 child issues.

## Backend And Integration Coverage

| Area | Follow-up |
|---|---|
| Tauri commands | Add mock coverage for async connection commands such as connect, disconnect, and keep-alive behavior. |
| Integration skip policy | Normalize skip behavior between query and schema integration tests. |
| Docker-backed integration | Document or automate local DB service bootstrap for schema integration tests. |
| MariaDB deltas | Keep `RETURNING` returned-row runtime support, routine/default behavior, procedure-management, trigger CRUD, completion-runtime, admin/import/export, and full workbench claims behind separate MariaDB-specific promotion gates. Current `RETURNING` evidence is profile/completion plus a version-aware completion suggestion gate, structural parser/Safe Mode classification, and focused `mariadb:11` runtime characterization showing server-accepted `DELETE ... RETURNING` side effect with no returned-row or affected-row-count adapter support claim; current row-edit and bounded table/index/constraint DDL evidence is limited to the tested MySQL-family path under MariaDB identity, with smoke coverage for the bounded Structure DDL path. |
| Fixture inventory | Keep `scripts/fixtures/dbms-seeds.test.ts` aligned with every static DBMS fixture before product docs mention fixture evidence. |

## Local Development And CI

| Area | Follow-up |
|---|---|
| Local DB ports | Make local DB service ports deterministic or self-allocating instead of relying on partial env override. |
| macOS smoke | Keep macOS E2E deferred until tauri-driver WKWebView support or an alternate mac smoke path exists. |
| Right-click E2E | Add an alternate context-menu trigger or wait for tauri-driver W3C Actions support. |
| E2E isolation | App-local state (`connections.json`, prefs, safe-mode flags) is emptied per session by `beforeSession` in `wdio.smoke.conf.ts` (`scripts/e2e-smoke-data-dir.ts`), so a `specFileRetries` retry no longer inherits the previous attempt's connections (#1836). Remaining: DB-server fixtures are still seeded once per spec-file run, not per retry. |
| Masked E2E flakes | `wdio.smoke.conf.ts` sets `specFileRetries: 1`, so a first-attempt `no such window` crash is recovered in the same run and never shows in the workflow pass/fail tally. The `e2e-smoke` and `e2e-smoke-file-backed` jobs tee their run log and a post-step (`scripts/e2e-smoke-flake-summary.sh`) counts `no such window` + `RETRYING` markers into the job summary with a non-failing warning annotation. Read that summary on green runs; tracked in #1293. |
| Link checker | Add an internal-doc link checker after archive routing settles. |
| Dependency security | Track `hickory-proto` advisory exposure through `mongodb 3.6.0`, `rustls-pemfile` exposure through `oracle-rs 0.1.7`, and `quick-xml` DoS advisories (RUSTSEC-2026-0194/0195) through `plist 1.8.0`; remove deny ignores when upstream dependency updates make it possible. |

## Static Lint Gate

`pnpm lint` runs `scripts/check-eslint-static-policy.ts`. The wrapper runs the
full ESLint config and then enforces the Refactor 00 static policy from
`docs/archives/audits/refactor-00-static-hardening-2026-06-09.md`:

| Gate | Current policy | Triage owner |
|---|---|---|
| `max-lines` | Existing 22 warnings are an exact allowlist. New entries and stale entries fail. | The PR touching the file removes new debt or shrinks the allowlist. |
| Hidden TS/TSX lint candidates | Only generated wasm artifacts under `src/lib/sql/wasm/**` and `src/lib/mongo/wasm/**` may be ignored. | The PR adding a broad ignore must either narrow it or document generated-artifact ownership. |
| `src/features/**` imports | Feature production modules may use feature-local code, feature public APIs, `@lib`, `@/types`, and `@components/ui`; cross-feature internal imports fail and must route through `src/features/<domain>/index.ts`. Imports from legacy components, hooks, stores, pages, router, or app shell still fail unless they are an explicit public-facade exception. | The PR adding a feature dependency owns reusable extraction, public API export, or removal of the dependency. |

Coverage thresholds are governed by
[`docs/quality/coverage-ratchet.md`](../quality/coverage-ratchet.md), E2E
breadth stays with #581, and CI cache or parallelism with #582. Static lint
changes should not edit those gates.

## Smoke Matrix Bands

The per-band smoke matrices live in [`smoke-matrix/`](smoke-matrix/).
Each band is its own file so an agent loads only the band it needs;
this page stays the index plus the cross-band policy sections.

| Band | Scope |
|---|---|
| [`h1-data-source.md`](smoke-matrix/h1-data-source.md) | Cross-adapter architecture boundary: profile/capability/adapter-contract registry, query-language and result-envelope ownership, and the connect-to-query journey for PostgreSQL, MySQL, MariaDB, MongoDB, Redis, Elasticsearch/OpenSearch, and DuckDB |
| [`h2-rdbms-parity.md`](smoke-matrix/h2-rdbms-parity.md) | RDBMS parity lanes and their closure audits: PostgreSQL, MySQL, MariaDB, SQLite, and DuckDB `.duckdb` runtime smoke |
| [`postgresql-query-workbench.md`](smoke-matrix/postgresql-query-workbench.md) | PostgreSQL lane detail: query execution, catalog/workbench metadata, parser and Safe Mode, completion and installed extensions, edit semantics, Explain, cancellation |
| [`sqlite-file-dbms.md`](smoke-matrix/sqlite-file-dbms.md) | SQLite lane detail: file connection lifecycle, writable-file DML, catalog browse, row edit, DDL and unsupported `ALTER` behavior |
| [`h3-duckdb-file-analytics.md`](smoke-matrix/h3-duckdb-file-analytics.md) | DuckDB `.duckdb` runtime plus registered CSV/Parquet/JSON/NDJSON analytics, and the local-file privacy/export and extension/`COPY` gates |
| [`h4-rdbms-intelligence.md`](smoke-matrix/h4-rdbms-intelligence.md) | Schema metadata cache, ERD graph input and renderer, dependency view, migration impact, schema diff, FK row navigation |
| [`h5-non-rdbms.md`](smoke-matrix/h5-non-rdbms.md) | Non-RDBMS paradigms: MongoDB, Redis/Valkey, and Elasticsearch/OpenSearch Search, with their closure audits |
| [`h6-wider-source-candidates.md`](smoke-matrix/h6-wider-source-candidates.md) | MSSQL and Oracle runtime/smoke guardrails plus unpromoted wide-column, cloud-document, graph, vector, and stream candidates |
| [`h7-ops-security-reliability.md`](smoke-matrix/h7-ops-security-reliability.md) | CI/hook gate surface, destructive-operation safety, credential and local-first privacy, dependency security, a11y, performance, platform smoke, E2E isolation |

Band sizes are not restated here — `scripts/hooks/check-doc-size.sh` owns that
number, so duplicating it would only create a claim nothing verifies.

## Pre-Release Verification Gate

Use this gate before pushing a `v*.*.*` release tag, manually dispatching the
release workflow, or publishing a draft GitHub Release. The gate is tied to one
exact commit SHA; if the SHA changes, rerun the gate.

Required local evidence:

- Source state: record the intended release SHA and confirm the release worktree
  has no unrelated source changes with `git status --short --branch`.
- Hook path: normal signed commit and pre-push path-routed gates must pass. Hook
  bypass flags remain forbidden by git policy.
- Frontend/build lane: `pnpm wasm:size`, `pnpm lint`,
  `pnpm exec vitest run --coverage --coverage.reporter=text-summary`, and
  `pnpm build`. The former `pnpm test -- --run --coverage ...` form did NOT
  measure coverage: pnpm 10 forwards the `--`, so vitest received
  `run -- --run --coverage ...` and treats everything after `--` as non-flag
  arguments. It exited 0 without collecting coverage or applying the
  vite.config.ts thresholds, so this lane produced no coverage evidence.
- Rust lane: `cargo test --manifest-path src-tauri/Cargo.toml --lib --test storage_integration`,
  `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --lib`, and
  `cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend`.
- Docker integration lane: with required services available,
  `cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration --test mongo_integration --test fixture_loading --test redis_integration`.
- Documentation lane: docs changed for the release must pass Prettier and local
  link/target review for the touched docs.

Required remote evidence on the exact release SHA:

- CI passes: PR Body Contract where applicable, Frontend Checks, Rust Unit And
  Storage Tests, and Integration Tests (Docker).
- Runtime Happy Path passes: Prepare E2E runtime artifacts plus the wired
  PostgreSQL, MySQL, MariaDB, SQLite, DuckDB `.duckdb`, DuckDB file analytics,
  MongoDB, Redis, Valkey, Elasticsearch, OpenSearch, MSSQL, and Oracle matrix
  checks.
- `main` push checks pass on the merge commit before a release tag is pushed.
- Release workflow output is packaging evidence only. Draft bundle creation and
  checksum upload do not replace CI or Runtime Happy Path evidence.

Deferred or non-blocking checks must stay explicit:

- Theme contrast is advisory today.
- Link checking, a11y beyond the critical component smoke set, perf budgets,
  macOS/Windows desktop runtime smoke, and per-spec database fixture reset are
  not routine release blockers unless a release issue explicitly promotes one of
  them. (Rust llvm-cov integration cutoffs became a routine blocking check on
  2026-07-03 — the CI `Integration Tests (Docker)` job enforces them.)
- Non-routine E2E specs remain scenario inventory or manual regression evidence
  until a workflow/script invokes them.
- No support claim can ship on fixture-only evidence. Fixture files, profile
  rows, generator tests, and compatibility inventories become live runtime
  evidence only when the matching workflow/script/test path is wired and green.
  Exceptions require a visible issue or release note entry; they must not be
  hidden as a flaky pass.

## Frontend Test Quality

| Area | Follow-up |
|---|---|
| CSS assertions | Prefer role, label, or behavior assertions over class-name assertions. |
| Shortcut tests | Move Mod-Enter coverage toward browser/smoke coverage or a stable keymap seam. |
| Over-mocking | Reduce `MainArea` child over-mocking so prop contract drift is visible. |
| Theme icons | Use accessible labels or visual smoke for icon distinction instead of SVG-shape assertions. |
| Test data shape | Reuse production types/builders rather than duplicating `ConnectionConfigLike` shapes. |
| Drag and drop | Add behavior-level DnD coverage for dragged connection state. |

## Refactor Follow-Up

The code smell audit Part A candidates remain archived at
[`docs/archives/audits/code-smell-audit-2026-05-15.md`](../archives/audits/code-smell-audit-2026-05-15.md).
Promote candidates into sprint contracts only when they intersect current
feature work or remove active maintenance cost.

# Testing And Quality Follow-Ups

This page collects developer-facing verification gaps and quality follow-ups.
User-visible support boundaries live in
[`docs/product/known-limitations.md`](../product/known-limitations.md) and its
`known-limitations-{rdbms,non-rdbms,cross-cutting}.md` children. Future
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
| Shared contract fixtures | `tests/fixtures/**` | Shared TS/Rust/parser/support-boundary fixtures are contract evidence only. Unsupported-boundary fixtures are negative evidence and do not widen runtime support. |
| Backend adapter fixture harness | `src-tauri/table-view-core/src/db/fixtures.rs`, `src-tauri/tests/fixture_harness.rs` | Adapter fixtures are requested by profile/family/paradigm/capability. Missing fixture diagnostics are failures, not silent skips. Current embedded harness coverage is Search-only. |
| Generator/profile specs | `fixtures/**` | Profile existence is not runtime support. |
| Test placement | `src/**`, `src-tauri/tests`, `e2e/smoke` | Frontend unit/component tests stay near their feature/domain; Rust integration stays under `src-tauri/tests`; desktop smoke stays under `e2e/smoke`, which nothing wires automatically. |

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
| Fixture inventory | Nothing checks that the fixture inventory matches the docs. Read `e2e/fixtures/<dbms>/` before product docs cite fixture evidence. |

## Local Development And CI

| Area | Follow-up |
|---|---|
| Local DB ports | Make local DB service ports deterministic or self-allocating instead of relying on partial env override. |
| macOS smoke | Keep macOS E2E deferred until tauri-driver WKWebView support or an alternate mac smoke path exists. |
| Right-click E2E | Add an alternate context-menu trigger or wait for tauri-driver W3C Actions support. |
| E2E isolation | App-local state (`connections.json`, prefs, safe-mode flags) is emptied per session by `beforeSession` in `wdio.smoke.conf.ts` (`e2e/support/smoke-data-dir.ts`), so a `specFileRetries` retry no longer inherits the previous attempt's connections (#1836). Remaining: DB-server fixtures are still seeded once per spec-file run, not per retry. |
| Masked E2E flakes | `wdio.smoke.conf.ts` sets `specFileRetries: 1`, so a first-attempt `no such window` crash is recovered in the same run and never shows in that run's pass/fail tally. No flake tally exists — nothing counts `no such window` or `RETRYING` markers; tracked in #1293. |
| Link checker | Add an internal-doc link checker after archive routing settles. |
| Dependency security | Track `hickory-proto` advisory exposure through `mongodb 3.6.0`, `rustls-pemfile` exposure through `oracle-rs 0.1.7`, and `quick-xml` DoS advisories (RUSTSEC-2026-0194/0195) through `plist 1.8.0`; remove deny ignores when upstream dependency updates make it possible. |

## Static Lint Gate

`pnpm lint` runs two engines with disjoint policy spaces: `biome check .`
(formatter + the generic lint rules, configured in `biome.jsonc`) and then
`eslint .` (the repo-specific guards only — `tv-local/*`, the
`no-restricted-syntax`/`no-restricted-imports` blocks, react-hooks,
`@typescript-eslint/no-deprecated`, `no-console`, `max-lines`). A rule belongs
to exactly one engine; `eslint.config.js` deliberately extends no preset.
`eslint.config.js` keeps `max-lines` as a warning and
the feature-import rule as an error. **Nothing enforces the rules below** — they
come from the Refactor 00 static policy in
`docs/archives/audits/refactor-00-static-hardening-2026-06-09.md`, and no check
reads the allowlists:

| Gate | Current policy | Triage owner |
|---|---|---|
| `max-lines` | Existing 19 warnings are an exact allowlist. New entries and stale entries fail. `src/components/search/SearchIndexDetailPanel.tsx` joined the list at 705 effective lines when the Biome format migration expanded it past 700; splitting it is follow-up work, not lint adoption. | The PR touching the file removes new debt or shrinks the allowlist. |
| Hidden TS/TSX lint candidates | Only generated wasm artifacts under `src/lib/sql/wasm/**` and `src/lib/mongo/wasm/**` may be ignored. | The PR adding a broad ignore must either narrow it or document generated-artifact ownership. |
| `src/features/**` imports | Feature production modules may use feature-local code, feature public APIs, `@lib`, `@/types`, and `@components/ui`; cross-feature internal imports fail and must route through `src/features/<domain>/index.ts`. Imports from legacy components, hooks, stores, pages, router, or app shell still fail unless they are an explicit public-facade exception. | The PR adding a feature dependency owns reusable extraction, public API export, or removal of the dependency. |

Coverage thresholds are governed by `vite.config.ts` (frontend) and the
`--fail-under-*` literals in `.github/workflows/ci.yml` (Rust integration) —
those two files are the only places the numbers live. E2E breadth stays with #581, and
CI cache or parallelism with #582. Static lint changes should not edit those
gates.

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
| [`h4-rdbms-intelligence.md`](smoke-matrix/h4-rdbms-intelligence.md) | Schema metadata cache, ERD graph input and React Flow canvas, dependency view, migration impact, schema diff, FK row navigation |
| [`h5-non-rdbms.md`](smoke-matrix/h5-non-rdbms.md) | Non-RDBMS paradigms: MongoDB, Redis/Valkey, and Elasticsearch/OpenSearch Search, with their closure audits |
| [`h6-wider-source-candidates.md`](smoke-matrix/h6-wider-source-candidates.md) | MSSQL and Oracle runtime/smoke guardrails plus unpromoted wide-column, cloud-document, graph, vector, and stream candidates |
| [`h7-ops-security-reliability.md`](smoke-matrix/h7-ops-security-reliability.md) | CI gate surface, destructive-operation safety, credential and local-first privacy, dependency security, a11y, performance, platform smoke, E2E isolation |

Band sizes are not restated here. No size gate exists, so a band size written
here would be a number nothing verifies.

## Pre-Release Verification Gate

Use this gate before pushing a `v*.*.*` release tag, manually dispatching the
release workflow, or publishing a draft GitHub Release. The gate is tied to one
exact commit SHA; if the SHA changes, rerun the gate.

Required local evidence:

- Source state: record the intended release SHA and confirm the release worktree
  has no unrelated source changes with `git status --short --branch`.
- Commit path: there are no local hooks. Commits must still be signed, and
  bypass flags remain forbidden by git policy.
- Frontend/build lane: `pnpm lint`,
  `pnpm exec vitest run --coverage --coverage.reporter=text-summary`, and
  `pnpm build`. The former `pnpm test -- --run --coverage ...` form did NOT
  measure coverage: pnpm 10 forwards the `--`, so vitest received
  `run -- --run --coverage ...` and treats everything after `--` as non-flag
  arguments. It exited 0 without collecting coverage or applying the
  vite.config.ts thresholds, so this lane produced no coverage evidence.
- Rust lane, in this order:
  `cargo test --manifest-path src-tauri/Cargo.toml --lib --test storage_integration`,
  `cargo test --manifest-path src-tauri/table-view-core/Cargo.toml --lib`,
  `cargo test --manifest-path src-tauri/sql-parser-core/Cargo.toml --lib`,
  `cargo test --manifest-path src-tauri/Cargo.toml --test parse_sql_backend`, and
  `cargo test --manifest-path src-tauri/Cargo.toml --test keyring_migration --test keyring_new_user --test keyring_linux_fallback`.
  `table-view-core` and `sql-parser-core` are path dependencies, not workspace
  members, so the app manifest's `--lib` never reaches either one. `--test` is an
  allowlist on top of that: an integration binary that no line names never runs,
  which is how the three `keyring_*` binaries stayed outside CI until #1815. Drop
  a line and the lane still exits 0 with those crates' unit tests — or those
  binaries — unrun, the same reason CI wires them as separate steps
  (`.github/workflows/ci.yml:358-401`).
- Docker integration lane: with required services available,
  `cargo test --manifest-path src-tauri/Cargo.toml --test schema_integration --test query_integration --test mongo_integration --test fixture_loading --test redis_integration`.
- Documentation lane: `git diff --check` on the touched docs plus local
  link/target review. **No formatter covers docs markdown, on purpose.**
  Prettier was removed when Biome landed, `biome.jsonc` excludes `docs/`
  outright, and Biome 2.5.6 does not format markdown at all — so there is
  nothing to run and this lane must not be written as if there were. Reviewer
  judgement is the whole gate here; do not treat a docs-only change as
  machine-verified.

Required remote evidence on the exact release SHA:

- Every required context in the `pr_to_main` ruleset passes. That list lives in
  one place, `memory/runbook/pr-merge-gates/memory.md`. Do not copy it here — a
  copy kept here once listed five of the then-eight. The count is not stable
  either: #2037 took it to **seven** by deleting the name-only
  `Detect Change Scope` job, and no stub context is left — `PR Body Contract`
  became a real check in that same PR, so all seven required contexts now
  assert something. Read the list from GitHub rather than from prose:

  ```bash
  gh api repos/{owner}/{repo}/rulesets/15755265 \
    --jq '.rules[] | select(.type=="required_status_checks")
          | .parameters.required_status_checks[].context'
  ```
- Runtime smoke runs in CI, scoped to the change.
  `.github/workflows/e2e-smoke.yml` maps the PR's changed paths to a spec subset
  through `e2e/scope-map.mjs` and runs only those, so a green PR proves the
  specs its own paths select and nothing else — a PR that selects 0 specs proves
  no desktop runtime behavior at all. The full suite runs on push to main, on
  the nightly schedule, and on a PR carrying `e2e:full` once a push follows the
  label — the workflow does not listen to label events. Run the suite by hand
  on the release SHA when the release needs evidence the PR runs did not
  produce — the full sequence (debug build, seed, then
  `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke pnpm test:e2e:smoke`) is in
  README 「E2E Smoke」. Without that variable the specs drive the app against
  your real connection store (`src-tauri/table-view-core/src/storage/mod.rs` `data_dir_override`).
- `main` push checks pass on the merge commit before a release tag is pushed.
- Release workflow output is packaging evidence only. Draft bundle creation and
  checksum upload do not replace CI or runtime smoke evidence.

Deferred or non-blocking checks must stay explicit:

- Theme contrast is advisory today.
- Link checking, a11y beyond the critical component smoke set, perf budgets,
  macOS/Windows desktop runtime smoke, and per-spec database fixture reset are
  not routine release blockers unless a release issue explicitly promotes one of
  them. (Rust llvm-cov integration cutoffs became a routine blocking check on
  2026-07-03 — the CI `Integration Tests (Docker)` job enforces them.)
- An E2E spec is CI evidence for the changes that select it and manual evidence
  otherwise. `e2e/scope-map.mjs` decides which specs a PR runs; the full suite
  runs on push to `main`, on the nightly schedule, and on `workflow_dispatch`.
- No support claim can ship on fixture-only evidence. Fixture files, profile
  rows, generator tests, and compatibility inventories become live runtime
  evidence only when a matching workflow or test path runs them green.
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

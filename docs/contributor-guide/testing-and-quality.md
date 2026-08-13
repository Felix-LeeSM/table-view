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
| Test placement | `src/**`, `src-tauri/tests`, `src-tauri/<member>/tests`, `e2e/smoke` | Frontend unit/component tests stay near their feature/domain; Rust integration for the app package stays under `src-tauri/tests`, and a workspace member keeps its own beside its manifest — `tvw`'s live engine coverage is `src-tauri/tvw/tests/query_url_live.rs` (#2323); desktop smoke stays under `e2e/smoke`, which nothing wires automatically. |

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

## What The Rust Coverage Gate Grades

On job `91580953608` (head `44beea9c`) the `Integration Tests (Docker)` llvm-cov
gate's per-file table carries 65 rows, none under `table-view-core`, over a
`TOTAL` of 30,195 regions / 2,831 functions / 21,550 lines.

Measured on `dd1d9d0a` (macOS):

```bash
cd src-tauri
cargo llvm-cov nextest --profile push --lib --ignore-run-fail --json \
  | jq '{files: [.data[0].files[].filename]
           | {total: length, core: map(select(test("table-view-core"))) | length},
         totals: .data[0].totals
           | {regions: .regions.count, functions: .functions.count, lines: .lines.count}}'
```

It reports 64 files, 0 of them under `table-view-core`, over totals of 30,475
regions / 2,842 functions / 21,694 lines.

The crate's own unit coverage on `dd1d9d0a` is 69.17% regions / 65.76%
functions / 69.54% lines over 1,204 tests, and its `TOTAL` row counts 65,446
regions. Run this one from `src-tauri` as well — `-p` selects the member, and
selection is what decides whose sources land in the report:

```bash
cd src-tauri
cargo llvm-cov -p table-view-core --lib --summary-only
```

Read a job with
`gh api --allow-escape-sequences repos/{owner}/{repo}/actions/jobs/<job-id>/logs`
while GitHub still retains that run's logs; without that flag `gh` prints a
one-line notice instead of the log.

## Local Development And CI

| Area | Follow-up |
|---|---|
| Local DB ports | Make local DB service ports deterministic or self-allocating instead of relying on partial env override. |
| macOS smoke | Keep macOS E2E deferred until tauri-driver WKWebView support or an alternate mac smoke path exists. |
| Right-click E2E | Add an alternate context-menu trigger or wait for tauri-driver W3C Actions support. |
| E2E isolation | App-local state (`connections.json`, prefs, safe-mode flags) is emptied per session by `beforeSession` in `wdio.smoke.conf.ts` (`e2e/support/smoke-data-dir.ts`), so a `specFileRetries` retry no longer inherits the previous attempt's connections (#1836). Remaining: DB-server fixtures are still seeded once per spec-file run, not per retry. |
| Masked E2E flakes | `wdio.smoke.conf.ts` sets `specFileRetries: 1`, so a first-attempt `no such window` crash is recovered in the same run and never shows in that run's pass/fail tally. No flake tally exists — nothing counts `no such window` or `RETRYING` markers, so detection stays a hand-run `grep "no such window"` over a green run's log; the `specFileRetries` comment in `wdio.smoke.conf.ts` owns that instruction. The 2026-07-04 census that named the class was #1293. |
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

Coverage thresholds sit in two layers. The floors: `vite.config.ts` (frontend)
and the `--fail-under-*` literals in `.github/workflows/ci.yml` (Rust
integration). Above the frontend floor, a ratchet: `coverage-baseline.json`
carries the last measured frontend total and `scripts/check-coverage-ratchet.mjs`
fails `Frontend Checks` when the merged report drops below it — that script's
header owns the tolerance and the procedure for raising the baseline. So a
frontend coverage red the `vite.config.ts` numbers cannot explain is the
ratchet: look for `FAIL <metric>` in the job log. E2E breadth stays with
`e2e/scope-map.mjs` (the spec universe and the changed-path routing) and the
`Runtime Happy Path` job in `.github/workflows/e2e-smoke.yml`; CI cache and
parallelism stay with `.github/workflows/ci.yml` and
`.github/workflows/e2e-smoke.yml` — read each file's own cache steps and job
matrices rather than a list here, including the in-file notes on why one CI job
deliberately has no `Swatinem/rust-cache` and why the smoke job stays serial.
Static lint changes should not edit those gates.

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
- Rust lane:
  `cd src-tauri && cargo test --workspace --lib --test storage_integration --test parse_sql_backend --test keyring_migration --test keyring_new_user --test keyring_linux_fallback`.
  Since #2161 the Rust crates are one Cargo workspace rooted at
  `src-tauri/Cargo.toml`, so `--workspace --lib` runs every member's unit tests
  and a crate added later arrives already covered. This lane was a command per
  manifest before, because a cargo invocation reaches only the package it is
  invoked on, and the same omission was found three times — #1769 (`table-view-core`),
  sprint-390 (`sql-parser-core`), #2098 (`mongosh-parser-core`) — each time with
  CI green while those unit tests sat unrun.
  `--test` is a different matter and stays hand-listed: it is an allowlist, so
  an integration binary that no line names never runs, which is how the three
  `keyring_*` binaries stayed outside CI until #1815. Dropping `--workspace`
  un-runs whole crates; dropping a `--test` name un-runs that binary; both still
  exit 0. CI runs the identical command (the `Rust Unit And Storage Tests` job in
  `.github/workflows/ci.yml`). Since #2113 the second failure mode is measured rather
  than noticed one binary at a time: `scripts/check-ci-test-calls.sh` compares
  the integration targets under `src-tauri/tests` against the `--test` names CI
  calls, and fails unless each uncalled one carries a reason in
  `ci-uncalled-tests.txt`. It runs in the `PR Body Contract` job, so adding a
  test binary **under that root** without wiring it in is red. The scan root is
  `src-tauri/tests` alone, so a workspace member's own `src-tauri/<member>/tests`
  binary sits outside the population it grades: leaving that one uncalled stays
  green, and `ci-uncalled-tests.txt` cannot absorb it either — the gate fails a
  listed name whose target it cannot find. #2336 owns widening the scan; until it
  lands, this gate does not hold a member crate's `--test` line. That script's
  header states what it counts as a target and as a call, and running it prints
  the current tally — quote that output rather than re-deriving the comparison by
  hand. Closing the entries the file was seeded with is a separate issue.
- Docker integration lane: with required services available,
  `cd src-tauri && cargo test --test schema_integration --test query_integration --test mongo_integration --test fixture_loading --test redis_integration`.
  `tvw`'s live engine coverage is a binary in another workspace member, so
  `--test` alone does not select it and it needs its own call plus the host
  variables that gate it — leave them unset and the three server engines print
  `SKIP:` instead of running. The skip still reports PASS, and libtest hides a
  passing test's stdout unless the run carries `-- --nocapture`:
  `cd src-tauri && PGHOST=127.0.0.1 MYSQL_HOST=127.0.0.1 MARIADB_HOST=127.0.0.1 cargo test -p tvw --test query_url_live -- --nocapture`.
  CI spells the same cargo call in the `CLI Live Query (Docker)` job without
  that flag; `skip()` asserts on `CI`, so with that variable set an unset gate
  fails rather than printing.
- Documentation lane: `git diff --check` on the touched docs plus
  `pnpm docs:links`, which fails on an internal markdown link whose file or
  heading does not exist and runs in CI inside the frontend test shards.
  **No formatter covers docs markdown, on purpose.** Prettier was removed when
  Biome landed, `biome.jsonc` excludes `docs/` outright, and Biome 2.5.6 does
  not format markdown at all — so there is nothing to run and this lane must not
  be written as if there were. Link targets are what this lane's machine checks
  read out of the text; `git diff --check` warns about whitespace errors and
  conflict markers, not meaning. Prose, structure, external URLs, and whether a
  resolving link points at the right document remain reviewer judgement.

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
  your real connection store: the smoke run drives a real binary, and a real
  binary injects that store at boot
  (`src-tauri/table-view-core/src/storage/mod.rs` `init_production_data_dir`).
  Rust tests inject nothing, so they cannot reach it at all — they fail instead
  (#2184).
- `main` push checks pass on the merge commit before a release tag is pushed.
- Release workflow output is packaging evidence only. Draft bundle creation and
  checksum upload do not replace CI or runtime smoke evidence.

Deferred or non-blocking checks must stay explicit:

- Theme contrast is advisory today.
- Parser WASM size is advisory today (#2127). The CI
  `WASM Size Budget (non-blocking)` job builds both parser crates with
  wasm-pack and grades the gzip bytes against the budgets in
  `scripts/check-wasm-size.sh`. That job name is absent from the `pr_to_main`
  ruleset, so an over-budget PR reports red and still merges; promoting the
  budget to blocking means adding the name to that ruleset.
- A11y beyond the critical component smoke set, perf budgets, macOS/Windows
  desktop runtime smoke, and per-spec database fixture reset are not routine
  release blockers unless a release issue explicitly promotes one of them. Two
  entries have already left this list by being promoted: Rust llvm-cov
  integration cutoffs on 2026-07-03, enforced by the CI
  `Integration Tests (Docker)` job, and internal-doc link checking in #2125,
  enforced by `scripts/__tests__/docs-links.test.ts` inside the frontend test
  shards.
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

## Shell Suite Harness Quality

`scripts/**/*.test.sh` 는 `set -uo pipefail` 아래에서 단언을 돌린다. 그 안에서
`printf '%s\n' "$X" | grep -q …` 로 부분 문자열을 판정하면 **판정이 파이프 status 에
실린다**. `grep -q` 는 첫 일치에서 stdin 을 안 비우고 빠지고, 왼쪽 writer 가 파이프
버퍼(64KiB)를 넘겨 써야 하면 EPIPE → SIGPIPE 로 141 이 되며, `pipefail` 이 그 141 을
파이프라인 status 로 올린다. 부호가 양인 헬퍼(「있어야 한다」)에서는 거짓 red 로
나타나고, 부호가 반대인 헬퍼(「없어야 한다」)에서는 **조용한 거짓 green** 이 된다 —
후자는 red 를 안 남겨 로그로 못 찾는다. 기전·경계 실측·처방은 issue #2314 · #2319 와
`scripts/review/measure-rounds.test.sh` · `scripts/release/verify-tag-ci.test.sh` 의
`contains()` 주석에 있다.

`scripts/review/measure-rounds.test.sh` 는 #2314 가, `scripts/release/` 의
`cargo-package-version.test.sh` · `checksum-sidecars.test.sh` ·
`verify-tag-ci.test.sh` 는 #2319 가 닫았다. 같은 형태가 남은 **후보**는 이 명령이
낸다. 낸 줄이 곧 결함은 아니다 — 파이프 왼쪽이 writer 인지, 그 자리에 `pipefail` 이
걸렸는지, 그리고 실행되는 줄인지 기전을 설명하는 주석인지를 줄마다 따로 봐야 한다.
닫힌 파일도 그 주석 때문에 계속 걸린다:

```
git grep -n '| *grep -q'
```

pathspec 을 안 건다. `scripts/**/*.sh` 로 좁히면 `scripts/` 바로 아래 `.sh` 일곱
개와 `.github/workflows/` 가 통째로 빠진다. 주석을 빼고 보려면 뒤에
`| grep -v ':[0-9]*:[[:space:]]*#'` 를 잇는다.

**위험한 자리는 일치가 앞쪽에서 날 수 있는 판정이다.** `grep` 이 늦게 빠질수록 왼쪽
writer 가 쓸 것을 다 밀어 넣고 끝나 EPIPE 가 안 난다. #2314 의 PR 이
`scripts/release/fixtures/release-verify-tag-ci-job.txt`(`wc -c` 6662)를 8-way 동시로
1000 회씩 돌려 잰 값이 그것이다 — needle 이 첫 줄일 때 0 · 3 · 7/8000 이 뒤집혔고
마지막 줄일 때는 0/8000 이었다. 버퍼보다 작은 payload 도 **확률로는 뒤집힌다.**

**처방은 판정을 헬퍼 하나로 모으고 그 안에서 파이프를 없애는 것이다.** 리터럴
부분 문자열은 `case "$1" in *"$2"*)` 로 간다 — 따옴표 친 확장은 glob 메타문자까지
리터럴이라 `grep -F` 와 뜻이 같고, 프로세스도 파이프도 안 만들어 SIGPIPE 가 성립할
자리 자체가 없다. 줄머리 앵커처럼 `case` 로 못 옮기는 정규식은 grep 을 두되 파이프
대신 here-string 으로 먹인다 (`grep -qE -- "$2" <<<"$1"`) — here-string 은
파이프라인이 아니라서 `pipefail` 이 올릴 남의 status 가 애초에 없고 `$?` 는 grep
것 하나뿐이다. **`set -o pipefail` 을 지우는 것은 답이 아니다** — 그 파일의 다른
파이프라인 실패를 같이 놓친다.

**회귀 가드의 payload 는 파이프 버퍼(64KiB)의 두 배 위로 잡고 그 크기 자체를
단언한다.** 버퍼 언저리는 아직 스케줄링 경합이라 확률로만 나타나고, 누가 payload 를
줄이면 나머지 단언이 green 이어도 아무것도 안 지키기 때문이다. 2026-08-13 macOS 실측
(bash 3.2.57 + BSD grep 2.6.0, 4-way 동시 × 200, 첫 줄 일치, 옛 파이프 형태,
flip = 있는 것을 「없음」으로 낸 횟수): 8041B 0/800 · 70057B 799/800 · 200055B
800/800. 같은 판에서 `case` 형태와 here-string 형태는 세 크기 모두 0/800 이었다.
재현 명령은 PR #2318 body 「기전의 경계」절의 `race.sh` 다.

**부호가 반대인 가드를 빠뜨리지 않는다.** 「없어야 한다」쪽은 뒤집혀도 red 를 안
남기므로 「없어야 할 것이 실제로 있는데 통과」를 재현하는 단언을 따로 남긴다 —
올바른 동작이 곧 FAIL 이라 서브셸에서 불러 출력만 보고 카운터 증가는 버린다. 그
형태는 `scripts/release/verify-tag-ci.test.sh` 와
`scripts/release/checksum-sidecars.test.sh` 의 `assertion helpers (#2319)` 절에 있다.

**「실제로 무엇이 CI 를 막고 있는가」는 산문에 안 적는다** — 그날 안에 낡는다. #2314
의 PR 이 「오늘 CI 를 막고 있는 자리가 아니다」를 커밋(`45a91592`, committer date
`2026-08-12T06:52:54Z`)한 지 5분 28초 뒤, 부호가 양인 `verify-tag-ci.test.sh` 의
`assert_has` 가 바로 그 PR 의 required check `Frontend Checks` 를 red 로 만들었다
(`2026-08-12T06:58:22Z`). 두 종점을 내는 명령:

```
gh api repos/Felix-LeeSM/table-view/commits/45a91592 --jq .commit.committer.date
gh api repos/Felix-LeeSM/table-view/actions/runs/31571727127/jobs --paginate \
  --jq '.jobs[] | select(.conclusion!="success")
        | [.name,.conclusion,.started_at,.completed_at] | @tsv'
```

지금 무엇이 red 인지는 이 명령이 낸다:

```
gh run list -R Felix-LeeSM/table-view --workflow ci.yml --status failure --limit 20
```

## Refactor Follow-Up

The code smell audit Part A candidates remain archived at
[`docs/archives/audits/code-smell-audit-2026-05-15.md`](../archives/audits/code-smell-audit-2026-05-15.md).
Promote candidates into sprint contracts only when they intersect current
feature work or remove active maintenance cost.

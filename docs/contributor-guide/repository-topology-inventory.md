---
title: Repository Topology SOT
type: refactor-evidence
issue: 732
updated: 2026-06-10
---

# Repository Topology SOT

This is the Refactor 01 final directory topology SOT for issue #732. It
publishes the durable ownership, lifecycle, cleanup, and migration
constraints produced by issues #728 through #731.

It does not move directories, delete local data, change runtime behavior, or
widen product support claims. Product-visible limitations stay in product docs;
future sequencing stays in `docs/ROADMAP.md`.

## Refactor 01 Final SOT

Current GitHub closure state checked on 2026-06-12:

- #728 closed through PR #794 and created the topology inventory.
- #729 closed through PR #797 and fenced generated/cache/tmp/worktree paths.
- #730 closed through PR #798 and published source-root migration constraints.
- #731 closed through PR #801.
- #732 is closed.
- Parent #572 is closed.
- Milestone `09.10 - Refactor 01 - Directory Topology` is closed with 0 open and
  6 closed issues.

Durable SOT routing:

- This file owns root ownership, lifecycle, git-tracking, cleanup, and
  contributor-facing topology summary.
- [`source-root-migration-constraints.md`](source-root-migration-constraints.md)
  owns later Refactor 02/03 source movement constraints and compatibility export
  requirements.
- `memory/runbook/worktree/memory.md` owns work-copy isolation (independent
  clones outside the repository root) and primary checkout guard behavior.

## Before Tree Snippet

Current repository roots are interleaved by implementation area, generated
output, local caches, evidence, and agent workflow:

```text
.
|-- src/
|-- src-tauri/
|-- tests/
|-- e2e/
|-- fixtures/
|-- docs/
|-- memory/
|-- .github/
|-- node_modules/           # local dependency cache, gitignored
|-- target/                 # local Rust target cache, gitignored
|-- src-tauri/target/       # local Rust/Tauri target cache, gitignored
|-- cargo-target/           # CI/local cache mount, gitignored
|-- dist/                   # build output, gitignored
|-- .vite/                  # Vite cache, gitignored
|-- coverage/               # coverage output, gitignored
|-- test-results/           # test output, gitignored
|-- tmp/                    # scratch, gitignored
`-- worktrees/              # linked worktrees, gitignored
```

## Target Classification Snippet

Refactor 01 target topology is ownership-based, not cosmetic. No source move
happens in #728.

```text
source/
  frontend: src/, public/, app config
  backend: src-tauri/src/, src-tauri/tests/, src-tauri/table-view-core/,
    parser crates
  committed generated inputs: src/lib/*/wasm/, src-tauri/gen/, src-tauri/icons/

fixtures-and-tests/
  static fixtures: fixtures/, tests/fixtures/, e2e/fixtures/
  smoke specs and report mount: e2e/

workflow-and-policy/
  docs: docs/
  agent memory: memory/
  CI: .github/

local-generated-cache-tmp/
  dependencies and build cache: node_modules/, target/, src-tauri/target/,
    cargo-target/, .vite/
  build/test output: dist/, coverage/, test-results/, wdio-report/,
    e2e/wdio-report/
  scratch and local state: tmp/, worktrees/, .claude/worktrees/, .env*
```

## Final Lifecycle Rules

- Tracked source roots include `src/`, `public/`, `src-tauri/src/`,
  `src-tauri/tests/`, `src-tauri/table-view-core/`, parser crates, CI workflows,
  docs, and memory.
- Committed generated inputs include `src/lib/*/wasm/`, `src-tauri/gen/`, and
  `src-tauri/icons/`. They stay source-visible and must not be hidden by
  generated/cache/tmp/worktree fences.
- Root-local `node_modules/`, `target/`, `src-tauri/target/`, `cargo-target/`,
  `dist/`, `.vite/`, `coverage/`, `test-results/`, `wdio-report/`, `tmp/`, and
  `worktrees/` are local generated/cache/tmp/worktree surfaces. They are not
  planning, docs, lint, or test source roots unless a script explicitly names a
  file inside them.
- `worktrees/` and `.claude/worktrees/` contain active local state. Clean them
  only through the worktree cleanup runbook; dirty worktrees are preserved and
  reported.
- Primary checkout is orchestration-only. Source, docs, app config, manifests,
  and CI files are changed in independent clone copies
  (`memory/runbook/worktree/memory.md`); legacy linked worktrees are no longer
  created. Primary updates only the allowed agent contracts (`AGENTS.md`,
  `memory/`, `.agents/`).

## Migration Constraints

Later source movement PRs must use
[`source-root-migration-constraints.md`](source-root-migration-constraints.md).
The short form:

- Refactor 02 owns frontend source moves. Refactor 03 owns backend adapter/module
  moves. Do not mix those moves with generated/cache fencing.
- Preserve existing public TypeScript and Rust import/module reachability with
  compatibility exports until consumers are migrated or a cleanup issue removes
  them with evidence.
- Tests, fixtures, and committed generated inputs move only with the behavior or
  generator contract they prove.
- Each migration PR lists moved roots, compatibility exports, old/new path
  search evidence, selected checks, and an explicit statement that #729 fence
  behavior was not weakened.

## Ownership Inventory

#### Ownership

| Root / pattern | Class | Owner | Lifecycle |
| --- | --- | --- | --- |
| `src/` | source | Frontend runtime and UI owners | Hand-authored application source |
| `public/` | source assets | Frontend asset owners | Hand-authored static assets |
| `src-tauri/src/` | source | Rust backend owners | Hand-authored backend source |
| `src-tauri/tests/` | source tests | Rust backend owners | Hand-authored integration tests |
| `src-tauri/table-view-core/` | source crate | Rust backend owners | Hand-authored headless backend core: DB adapters, wire models, local storage, error types. A path dependency of `src-tauri/Cargo.toml` rather than a workspace member, so it carries its own `Cargo.lock` |
| `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/` | source crates | Query-language owners | Hand-authored Rust parser crates |
| `src/lib/sql/wasm/`, `src/lib/mongo/wasm/` | generated committed input | Query-language owners | Regenerated by `pnpm build:sql-wasm` and `pnpm build:mongosh-wasm`; `.gitignore` is reset to comment-only |
| `src-tauri/gen/` | generated committed input | Tauri schema owners | Regenerated by Tauri schema tooling |
| `src-tauri/icons-src/`, `src-tauri/icons/` | source plus generated committed assets | Release and packaging owners | Generated icon outputs are committed except ignored `partial-info.plist` |
| `.github/` | CI workflow source plus issue templates | CI and release owners | Hand-authored GitHub Actions workflows; `.github/ISSUE_TEMPLATE/` holds the `task` and `raw` templates |
| `fixtures/`, `tests/fixtures/`, `e2e/fixtures/` | fixtures | Fixture and test owners | Static DBMS/test seed inputs |
| `e2e/` | smoke source plus report mount | E2E smoke owners | Specs and helpers are source; `e2e/wdio-report/` is host-only output with tracked `.gitkeep` |
| `docs/` | human docs and evidence | Documentation owners | Hand-authored docs, archives, product docs |
| `memory/` | agent rule memory | Agent workflow and engineering rule owners | Active rule files named `memory.md`; hand-maintained indexes under `memory/index/` |
| `node_modules/` | dependency cache | Package manager | Installed by `pnpm install --frozen-lockfile` |
| `dist/`, `.vite/`, `coverage/`, `test-results/` | build and test output | Build/test tools | Regenerated by Vite, Vitest, coverage, and test runners |
| `wdio-report/`, `e2e/wdio-report/` | E2E report output | E2E smoke owners | Generated by WebdriverIO smoke runs; `e2e/wdio-report/.gitkeep` preserves mount root |
| `target/`, `src-tauri/target/`, `cargo-target/` | Rust build cache | Rust toolchain and CI cache owners | Regenerated by Cargo, Tauri, nextest, llvm-cov, and CI cache restore |
| `tmp/` | scratch | Current local process or script | Ephemeral local scratch files |
| `worktrees/`, `.claude/worktrees/` | local linked worktree state (legacy — new work copies are independent clones outside the repo root; `memory/runbook/worktree/memory.md`) | Active agents and user sessions | Created by `git worktree add`; may contain dirty user or agent work |
| `.env`, `.env.*`, `.env.example` | secrets and template | Runtime config owners | Local secrets stay local; `.env.example` documents non-secret defaults |

#### Tracking, Visibility, And Cleanup

| Root / pattern | Git tracking | CI visibility | Cleanup policy | Boundary note / next owner |
| --- | --- | --- | --- | --- |
| `src/` | tracked | CI frontend jobs; CI builds and tests it | No automatic cleanup | Source root; not generated or cache |
| `public/` | tracked | CI frontend jobs; Vite build input | No automatic cleanup | Product asset root |
| `src-tauri/src/` | tracked | CI Rust jobs; CI cargo checks, tests, and coverage | No automatic cleanup | Backend source root |
| `src-tauri/tests/` | tracked | CI Rust jobs; CI cargo test targets | No automatic cleanup | Test source, not fixture cache |
| `src-tauri/table-view-core/` | tracked | The coverage boundary is measured in [`testing-and-quality.md`](testing-and-quality.md) | No automatic cleanup | Backend source crate |
| `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/` | tracked | CI Rust jobs; wasm build scripts consume these crates | No automatic cleanup | Source crates that generate committed wasm artifacts |
| `src/lib/sql/wasm/`, `src/lib/mongo/wasm/` | tracked intentionally | ESLint ignores generated glue; Vite build consumes artifacts; CI sees them as frontend build input | Regenerate from parser crates, do not delete as cache | Generated but committed; the generated-fencing child must not classify this as disposable cache |
| `src-tauri/gen/` | tracked | CI Rust jobs cover it because it is under `src-tauri/`; CI packaging can consume schemas | Regenerate from Tauri tooling, do not ad hoc edit when stale | Generated but committed reference output |
| `src-tauri/icons-src/`, `src-tauri/icons/` | mostly tracked; `src-tauri/icons/Compiled/partial-info.plist` gitignored | CI Rust jobs by path; release builds consume committed icons | Regenerate icons by hand — do not clean the icon tree wholesale | Generated output is product packaging input, not disposable cache |
| `.github/` | tracked | CI workflow route plus GitHub Actions execution | No automatic cleanup | Workflow changes are the only way to widen automated checks |
| `fixtures/`, `tests/fixtures/`, `e2e/fixtures/` | tracked | `tests/` and `e2e/` are frontend-route inputs; `.dockerignore` explicitly keeps required fixture inputs | Reset only through fixture scripts or fixture-specific PRs | Fixture evidence is not runtime support claim unless wired into smoke |
| `e2e/` | mixed tracked and gitignored | Frontend route locally; `.github/workflows/e2e-smoke.yml` runs the specs `e2e/scope-map.mjs` selects from a change, and every spec on push to `main` / nightly / dispatch | Delete report contents only, keep `.gitkeep` | Report output is not source |
| `docs/` | tracked | No docs-only lane: every CI job runs on every event | No automatic cleanup; archive retired records instead | The final-docs child owns durable topology publication |
| `memory/` | tracked | The `PR Body Contract` job runs `scripts/check-memory-doc-size.sh` over every `memory.md` for the 200-line / 12,000-character cap; nothing checks memory structure, and the indexes are hand-maintained | No cleanup; split memory files through memory workflow only | Not a docs backlog; active agent rules |
| `node_modules/` | gitignored | Not a CI source input; CI restores or installs dependencies | Remove only to repair dependency state, then reinstall | Cache, not source or planning surface |
| `dist/`, `.vite/`, `coverage/`, `test-results/` | gitignored | Ignored by lint/Vite where configured; CI may upload or inspect generated outputs during a run | Safe to delete after preserving needed logs | Output, not source; do not route planning through these roots |
| `wdio-report/`, `e2e/wdio-report/` | report contents gitignored; `.gitkeep` tracked | Written only by a local `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke pnpm test:e2e:smoke` run; nothing uploads them | Delete report contents only | Host-only report output |
| `target/`, `src-tauri/target/`, `cargo-target/` | gitignored | `src-tauri/target/` is required for local warm-start but not a tracked source root | Clean only for cache repair or disk pressure; never delete as #728 evidence | Cache boundary; later fencing may add policy, #728 does not delete |
| `tmp/` | gitignored | Not a CI input unless a workflow explicitly names a file inside it | Safe to delete only after confirming no running process depends on it | Scratch, not issue evidence SOT |
| `worktrees/`, `.claude/worktrees/` | gitignored; excluded from Vite, Vitest, ESLint, Biome, and dev-server fs access | Not a CI input | Clean only through the worktree cleanup runbook; dirty worktrees are preserved and reported | Local state, not source, cache, fixture, or planning surface |
| `.env`, `.env.*`, `.env.example` | `.env*` gitignored except `.env.example` | Not inspected by agents; `.dockerignore` excludes local secrets | Do not delete or read local secrets; update only `.env.example` for documented defaults | Secret boundary |

## Verification Notes

- `git status --short` before worktree edits was clean.
- No directory moves, source moves, cache deletion, tmp deletion, or worktree
  cleanup happened in this PR.
- No markdown formatter exists: Prettier was removed when Biome landed,
  `biome.jsonc` excludes `docs/`, and Biome 2.5.6 does not format markdown.
  A dedicated internal markdown link checker does exist since #2125 —
  `scripts/docs-links.ts`, blocking through the frontend test shards — so a
  docs-only inventory like this one gets `git diff --check`, that gate on its
  link targets, and reading the diff. Nothing mechanical reads the prose.

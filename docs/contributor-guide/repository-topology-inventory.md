---
title: Repository Topology SOT
type: refactor-evidence
issue: 732
updated: 2026-06-10
---

# Repository Topology SOT

> **2026-07-30 (#2033):** `scripts/`, `.githooks/`, `.agents/`, `.claude/`,
> `.codex/`, `lefthook.yml` 이 삭제됐다. 그 행들은 아래 표에서 제거했고, 로컬
> 훅(pre-push/pre-commit) 을 전제하던 서술은 CI 기준으로 바꿨다 — 지금 이 repo 에
> 로컬 git hook 은 하나도 없다.

This is the Refactor 01 final directory topology SOT for issue #732. It
publishes the durable ownership, lifecycle, cleanup, hook-routing, and migration
constraints produced by issues #728 through #731.

It does not move directories, delete local data, change runtime behavior, or
widen product support claims. Product-visible limitations stay in product docs;
future sequencing stays in `docs/ROADMAP.md`.

## Refactor 01 Final SOT

Current GitHub closure state checked on 2026-06-12:

- #728 closed through PR #794 and created the topology inventory.
- #729 closed through PR #797 and fenced generated/cache/tmp/worktree paths.
- #730 closed through PR #798 and published source-root migration constraints.
- #731 closed through PR #801 and aligned hook path taxonomy, source-edit guard,
  and pre-push routing.
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
- `scripts/hooks/analyze/path-classifier.sh`, `pre-push-path-router.sh`, and
  `check-main-worktree-source-edit.sh` own executable path classification.
- `memory/workflow/hooks/memory.md` (deleted in #2033) owned the hook taxonomy contract only, not the
  classifier table.
- `memory/runbook/worktree/memory.md` owns linked-worktree lifecycle and primary
  checkout guard behavior.

## Before Tree Snippet

Current repository roots are interleaved by implementation area, generated
output, local caches, evidence, and agent workflow:

```text
.
|-- src/
|-- src-tauri/
|-- scripts/
|-- tests/
|-- e2e/
|-- fixtures/
|-- docs/
|-- memory/
|-- .agents/
|-- .claude/
|-- .codex/
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
  backend: src-tauri/src/, src-tauri/tests/, parser crates
  committed generated inputs: src/lib/*/wasm/, src-tauri/gen/, src-tauri/icons/

fixtures-and-tests/
  fixture generators: scripts/fixtures/
  static fixtures: fixtures/, tests/fixtures/, e2e/fixtures/
  smoke specs and report mount: e2e/

workflow-and-policy/
  docs: docs/
  agent memory: memory/
  agent and hook source: .agents/, .claude/, .codex/, .githooks/, scripts/hooks/
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
  `src-tauri/tests/`, parser crates, scripts, hook source, CI workflows, docs,
  and memory.
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
- Primary checkout is orchestration-only. Source, docs, scripts, app config,
  manifests, agent source, and CI files are changed in linked worktrees, while
  primary may create linked worktree targets and update allowed agent contracts.
- Unknown or mixed source paths route conservatively through full gates. Docs,
  hook/tooling, generated/cache, memory, CI, frontend, and Rust routes follow the
  executable classifier and hook tests, not copied markdown tables.

## Migration Constraints

Later source movement PRs must use
[`source-root-migration-constraints.md`](source-root-migration-constraints.md).
The short form:

- Refactor 02 owns frontend source moves. Refactor 03 owns backend adapter/module
  moves. Do not mix those moves with generated/cache fencing or hook taxonomy
  changes.
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
| `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/` | source crates | Query-language owners | Hand-authored Rust parser crates |
| `src/lib/sql/wasm/`, `src/lib/mongo/wasm/` | generated committed input | Query-language owners | Regenerated by `pnpm build:sql-wasm` and `pnpm build:mongosh-wasm`; `.gitignore` is reset to comment-only |
| `src-tauri/gen/` | generated committed input | Tauri schema owners | Regenerated by Tauri schema tooling |
| `src-tauri/icons-src/`, `src-tauri/icons/` | source plus generated committed assets | Release and packaging owners | Generated icon outputs are committed except ignored `partial-info.plist`; the build script (`scripts/build-icons.sh`) was deleted in #2033 |
| `.github/` | CI workflow source | CI and release owners | Hand-authored GitHub Actions workflows |
| `fixtures/`, `tests/fixtures/`, `e2e/fixtures/` | fixtures | Fixture and test owners | Static DBMS/test seed inputs (the generator code under `scripts/fixtures/` was deleted in #2033) |
| `e2e/` | smoke source plus report mount | E2E smoke owners | Specs and helpers are source; `e2e/wdio-report/` is host-only output with tracked `.gitkeep` |
| `docs/` | human docs and evidence | Documentation owners | Hand-authored docs, sprint evidence, archives, product docs |
| `memory/` | agent rule memory | Agent workflow and engineering rule owners | Active rule files named `memory.md`; hand-maintained indexes under `memory/index/` |
| `node_modules/` | dependency cache | Package manager | Installed by `pnpm install --frozen-lockfile` |
| `dist/`, `.vite/`, `coverage/`, `test-results/` | build and test output | Build/test tools | Regenerated by Vite, Vitest, coverage, and test runners |
| `wdio-report/`, `e2e/wdio-report/` | E2E report output | E2E smoke owners | Generated by WebdriverIO smoke runs; `e2e/wdio-report/.gitkeep` preserves mount root |
| `target/`, `src-tauri/target/`, `cargo-target/` | Rust build cache | Rust toolchain and CI cache owners | Regenerated by Cargo, Tauri, nextest, llvm-cov, and CI cache restore |
| `tmp/` | scratch | Current local process or script | Ephemeral local scratch files |
| `worktrees/`, `.claude/worktrees/` | local linked worktree state | Active agents and user sessions | Created by `git worktree add` (the helper scripts were deleted in #2033); may contain dirty user or agent work |
| `.env`, `.env.*`, `.env.example` | secrets and template | Runtime config owners | Local secrets stay local; `.env.example` documents non-secret defaults |

#### Tracking, Visibility, And Cleanup

| Root / pattern | Git tracking | Hook / CI visibility | Cleanup policy | Boundary note / next owner |
| --- | --- | --- | --- | --- |
| `src/` | tracked | CI frontend jobs; CI builds and tests it | No automatic cleanup | Source root; not generated or cache |
| `public/` | tracked | CI frontend jobs; Vite build input | No automatic cleanup | Product asset root |
| `src-tauri/src/` | tracked | CI Rust jobs; CI cargo checks, tests, and coverage | No automatic cleanup | Backend source root |
| `src-tauri/tests/` | tracked | CI Rust jobs; CI cargo test targets | No automatic cleanup | Test source, not fixture cache |
| `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/` | tracked | CI Rust jobs; wasm build scripts consume these crates | No automatic cleanup | Source crates that generate committed wasm artifacts |
| `src/lib/sql/wasm/`, `src/lib/mongo/wasm/` | tracked intentionally | ESLint ignores generated glue; Vite build consumes artifacts; CI sees them as frontend build input | Regenerate from parser crates, do not delete as cache | Generated but committed; the generated-fencing child must not classify this as disposable cache |
| `src-tauri/gen/` | tracked | CI Rust jobs cover it because it is under `src-tauri/`; CI packaging can consume schemas | Regenerate from Tauri tooling, do not ad hoc edit when stale | Generated but committed reference output |
| `src-tauri/icons-src/`, `src-tauri/icons/` | mostly tracked; `src-tauri/icons/Compiled/partial-info.plist` gitignored | CI Rust jobs by path; release builds consume committed icons | `pnpm icons:build` was deleted in #2033 — do not clean the icon tree wholesale | Generated output is product packaging input, not disposable cache |
| `.github/` | tracked | CI workflow route plus GitHub Actions execution | No automatic cleanup | Workflow changes can widen local and remote checks |
| `scripts/fixtures/`, `fixtures/`, `tests/fixtures/`, `e2e/fixtures/` | tracked | `scripts/fixtures/` uses TypeScript route; `tests/` and `e2e/` use frontend route; `.dockerignore` explicitly keeps required fixture inputs | Reset only through fixture scripts or fixture-specific PRs | Fixture evidence is not runtime support claim unless wired into smoke |
| `e2e/` | mixed tracked and gitignored | Frontend route locally; `.github/workflows/e2e-smoke.yml` runs remote smoke | Delete report contents only, keep `.gitkeep` | Report output is not source |
| `docs/` | tracked | No docs-only lane: every CI job runs on every event since #2033 removed the change classifier | No automatic cleanup; archive retired records instead | The final-docs child owns durable topology publication |
| `memory/` | tracked | Memory route runs structure and size checks; `scripts/regenerate-indexes.sh` updates indexes | No cleanup; split memory files through memory workflow only | Not a docs backlog; active agent rules |
| `node_modules/` | gitignored | Not a CI source input; CI restores or installs dependencies | Remove only to repair dependency state, then reinstall | Cache, not source or planning surface |
| `dist/`, `.vite/`, `coverage/`, `test-results/` | gitignored | Ignored by lint/Vite where configured; CI may upload or inspect generated outputs during a run | Safe to delete after preserving needed logs | Output, not source; do not route planning through these roots |
| `wdio-report/`, `e2e/wdio-report/` | report contents gitignored; `.gitkeep` tracked | Remote E2E workflow uploads report artifacts | Delete report contents only | Host-only report output |
| `target/`, `src-tauri/target/`, `cargo-target/` | gitignored | `src-tauri/target/` is required for local warm-start but not a tracked source root | Clean only for cache repair or disk pressure; never delete as #728 evidence | Cache boundary; later fencing may add policy, #728 does not delete |
| `tmp/` | gitignored | Not hook or CI input unless a script explicitly names a file inside it | Safe to delete only after confirming no running process depends on it | Scratch, not issue evidence SOT |
| `worktrees/`, `.claude/worktrees/` | gitignored; excluded from Vite, Vitest, ESLint, and dev-server fs access | Not CI input; primary worktree edit guard allows linked target paths but blocks primary source edits | Use `scripts/worktree-cleanup.sh`; dirty worktrees are preserved and reported | Local state, not source, cache, fixture, or planning surface |
| `.env`, `.env.*`, `.env.example` | `.env*` gitignored except `.env.example` | Not inspected by agents; `.dockerignore` excludes local secrets | Do not delete or read local secrets; update only `.env.example` for documented defaults | Secret boundary |

## Verification Notes

- `git status --short` before worktree edits was clean.
- No directory moves, source moves, cache deletion, tmp deletion, or worktree
  cleanup happened in this PR.
- No dedicated internal markdown link checker exists in the repo today; use
  Prettier and `git diff --check` for this docs-only inventory.

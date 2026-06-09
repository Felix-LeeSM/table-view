---
title: Repository Topology SOT
type: refactor-evidence
issue: 732
updated: 2026-06-10
---

# Repository Topology SOT

This is the Refactor 01 final directory topology SOT for issue #732. It
publishes the durable ownership, lifecycle, cleanup, hook-routing, and migration
constraints produced by issues #728 through #731.

It does not move directories, delete local data, change runtime behavior, or
widen product support claims. Product-visible limitations stay in product docs;
future sequencing stays in `docs/ROADMAP.md`.

## Refactor 01 Final SOT

Live GitHub state checked on 2026-06-10:

- #728 closed through PR #794 and created the topology inventory.
- #729 closed through PR #797 and fenced generated/cache/tmp/worktree paths.
- #730 closed through PR #798 and published source-root migration constraints.
- #731 closed through PR #801 and aligned hook path taxonomy, source-edit guard,
  and pre-push routing.
- #732 owns this final docs publication only. Parent #572 closure is separate
  GitHub administration after this PR merges.

Durable SOT routing:

- This file owns root ownership, lifecycle, git-tracking, cleanup, and
  contributor-facing topology summary.
- [`source-root-migration-constraints.md`](source-root-migration-constraints.md)
  owns later Refactor 02/03 source movement constraints and compatibility export
  requirements.
- `scripts/hooks/path-classifier.sh`, `pre-push-path-router.sh`, and
  `check-main-worktree-source-edit.sh` own executable path classification.
- `memory/workflow/hooks/memory.md` owns the hook taxonomy contract only, not the
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

| Root / pattern                                                       | Class                                  | Owner                                      | Lifecycle                                                                                                           | Git tracking                                                             | Hook / CI visibility                                                                                                                        | Cleanup policy                                                                          | Boundary note / next owner                                                                      |
| -------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/`                                                               | source                                 | Frontend runtime and UI owners             | Hand-authored application source                                                                                    | tracked                                                                  | Pre-push frontend route runs TypeScript, lint, Vitest, and coverage; CI builds and tests it                                                 | No automatic cleanup                                                                    | Source root; not generated or cache                                                             |
| `public/`                                                            | source assets                          | Frontend asset owners                      | Hand-authored static assets                                                                                         | tracked                                                                  | Pre-push frontend route; Vite build input                                                                                                   | No automatic cleanup                                                                    | Product asset root                                                                              |
| `src-tauri/src/`                                                     | source                                 | Rust backend owners                        | Hand-authored backend source                                                                                        | tracked                                                                  | Pre-push Rust route; CI cargo checks, tests, and coverage                                                                                   | No automatic cleanup                                                                    | Backend source root                                                                             |
| `src-tauri/tests/`                                                   | source tests                           | Rust backend owners                        | Hand-authored integration tests                                                                                     | tracked                                                                  | Pre-push Rust route; CI cargo test targets                                                                                                  | No automatic cleanup                                                                    | Test source, not fixture cache                                                                  |
| `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/`       | source crates                          | Query-language owners                      | Hand-authored Rust parser crates                                                                                    | tracked                                                                  | Pre-push Rust route; wasm build scripts consume these crates                                                                                | No automatic cleanup                                                                    | Source crates that generate committed wasm artifacts                                            |
| `src/lib/sql/wasm/`, `src/lib/mongo/wasm/`                           | generated committed input              | Query-language owners                      | Regenerated by `pnpm build:sql-wasm` and `pnpm build:mongosh-wasm`; `.gitignore` is reset to comment-only           | tracked intentionally                                                    | ESLint ignores generated glue; Vite build consumes artifacts; CI sees them as frontend build input                                          | Regenerate from parser crates, do not delete as cache                                   | Generated but committed; the generated-fencing child must not classify this as disposable cache |
| `src-tauri/gen/`                                                     | generated committed input              | Tauri schema owners                        | Regenerated by Tauri schema tooling                                                                                 | tracked                                                                  | Pre-push Rust route because it is under `src-tauri/`; CI packaging can consume schemas                                                      | Regenerate from Tauri tooling, do not ad hoc edit when stale                            | Generated but committed reference output                                                        |
| `src-tauri/icons-src/`, `src-tauri/icons/`                           | source plus generated committed assets | Release and packaging owners               | Source SVGs feed `scripts/build-icons.sh`; generated icon outputs are committed except ignored `partial-info.plist` | mostly tracked; `src-tauri/icons/Compiled/partial-info.plist` gitignored | Pre-push Rust route by path; release builds consume committed icons                                                                         | Re-run `pnpm icons:build`; do not clean icon tree wholesale                             | Generated output is product packaging input, not disposable cache                               |
| `scripts/`                                                           | tooling source                         | Developer tooling owners                   | Hand-authored scripts and CLIs                                                                                      | tracked                                                                  | `.ts` scripts trigger frontend route; hook scripts trigger hook route; unknown script paths route conservatively                            | No automatic cleanup                                                                    | Tooling source, not scratch                                                                     |
| `scripts/hooks/`, `.githooks/`, `lefthook.yml`                       | hook source                            | Workflow and git-policy owners             | Hand-authored hook/router source                                                                                    | tracked                                                                  | Hook route runs shell syntax, lefthook validation, router tests, target-cache tests, and related checks                                     | No automatic cleanup                                                                    | Path-router ownership lives here; the hook-routing child owns routing changes                   |
| `.github/`                                                           | CI workflow source                     | CI and release owners                      | Hand-authored GitHub Actions workflows                                                                              | tracked                                                                  | CI workflow route plus GitHub Actions execution                                                                                             | No automatic cleanup                                                                    | Workflow changes can widen local and remote checks                                              |
| `scripts/fixtures/`, `fixtures/`, `tests/fixtures/`, `e2e/fixtures/` | fixtures                               | Fixture and test owners                    | Generator code plus static DBMS/test seed inputs                                                                    | tracked                                                                  | `scripts/fixtures/` uses TypeScript route; `tests/` and `e2e/` use frontend route; `.dockerignore` explicitly keeps required fixture inputs | Reset only through fixture scripts or fixture-specific PRs                              | Fixture evidence is not runtime support claim unless wired into smoke                           |
| `e2e/`                                                               | smoke source plus report mount         | E2E smoke owners                           | Specs and helpers are source; `e2e/wdio-report/` is host-only output with tracked `.gitkeep`                        | mixed tracked and gitignored                                             | Frontend route locally; `.github/workflows/e2e-smoke.yml` runs remote smoke                                                                 | Delete report contents only, keep `.gitkeep`                                            | Report output is not source                                                                     |
| `docs/`                                                              | human docs and evidence                | Documentation owners                       | Hand-authored docs, sprint evidence, archives, product docs                                                         | tracked                                                                  | Docs-only pre-push skips TS/Rust gates after signed-commit and coverage-ratchet checks                                                      | No automatic cleanup; archive retired records instead                                   | The final-docs child owns durable topology publication                                          |
| `memory/`                                                            | agent rule memory                      | Agent workflow and engineering rule owners | Active rule files named `memory.md`; generated indexes under `memory/index/`                                        | tracked                                                                  | Memory route runs structure and size checks; `scripts/regenerate-indexes.sh` updates indexes                                                | No cleanup; split memory files through memory workflow only                             | Not a docs backlog; active agent rules                                                          |
| `.agents/`, `.claude/`, `.codex/`                                    | agent source and wrapper config        | Agent workflow owners                      | Tracked skills, agents, hook wrappers, and local agent config source                                                | tracked except local-only settings                                       | Agent route skips TS/Rust unless mixed with other paths; app source edits from primary are blocked by edit policy                           | No automatic cleanup; `.claude/worktrees/` is separate local state                      | Skill source is `.agents/skills/<name>/SKILL.md`; wrappers point to memory                      |
| `node_modules/`                                                      | dependency cache                       | Package manager                            | Installed by `pnpm install --frozen-lockfile`                                                                       | gitignored                                                               | Not a CI source input; CI restores or installs dependencies                                                                                 | Remove only to repair dependency state, then reinstall                                  | Cache, not source or planning surface                                                           |
| `dist/`, `.vite/`, `coverage/`, `test-results/`                      | build and test output                  | Build/test tools                           | Regenerated by Vite, Vitest, coverage, and test runners                                                             | gitignored                                                               | Ignored by lint/Vite where configured; CI may upload or inspect generated outputs during a run                                              | Safe to delete after preserving needed logs                                             | Output, not source; do not route planning through these roots                                   |
| `wdio-report/`, `e2e/wdio-report/`                                   | E2E report output                      | E2E smoke owners                           | Generated by WebdriverIO smoke runs; `e2e/wdio-report/.gitkeep` preserves mount root                                | report contents gitignored; `.gitkeep` tracked                           | Remote E2E workflow uploads report artifacts                                                                                                | Delete report contents only                                                             | Host-only report output                                                                         |
| `target/`, `src-tauri/target/`, `cargo-target/`                      | Rust build cache                       | Rust toolchain and CI cache owners         | Regenerated by Cargo, Tauri, nextest, llvm-cov, and CI cache restore                                                | gitignored                                                               | `src-tauri/target/` is required for local warm-start but not a tracked source root                                                          | Clean only for cache repair or disk pressure; never delete as #728 evidence             | Cache boundary; later fencing may add policy, #728 does not delete                              |
| `tmp/`                                                               | scratch                                | Current local process or script            | Ephemeral local scratch files                                                                                       | gitignored                                                               | Not hook or CI input unless a script explicitly names a file inside it                                                                      | Safe to delete only after confirming no running process depends on it                   | Scratch, not issue evidence SOT                                                                 |
| `worktrees/`, `.claude/worktrees/`                                   | local linked worktree state            | Active agents and user sessions            | Created by worktree helpers; may contain dirty user or agent work                                                   | gitignored; excluded from Vite, Vitest, ESLint, and dev-server fs access | Not CI input; primary worktree edit guard allows linked target paths but blocks primary source edits                                        | Use `scripts/worktree-cleanup.sh`; dirty worktrees are preserved and reported           | Local state, not source, cache, fixture, or planning surface                                    |
| `.env`, `.env.*`, `.env.example`                                     | secrets and template                   | Runtime config owners                      | Local secrets stay local; `.env.example` documents non-secret defaults                                              | `.env*` gitignored except `.env.example`                                 | Not inspected by agents; `.dockerignore` excludes local secrets                                                                             | Do not delete or read local secrets; update only `.env.example` for documented defaults | Secret boundary                                                                                 |

## Verification Notes

- `git status --short` before worktree edits was clean.
- No directory moves, source moves, cache deletion, tmp deletion, or worktree
  cleanup happened in this PR.
- No dedicated internal markdown link checker exists in the repo today; use
  Prettier and `git diff --check` for this docs-only inventory.

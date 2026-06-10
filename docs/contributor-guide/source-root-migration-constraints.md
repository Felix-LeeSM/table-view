---
title: Source Root Migration Constraints
type: refactor-contract
issue: 730
updated: 2026-06-11
---

# Source Root Migration Constraints

This is the Refactor 01 source-root migration contract for issue #730. It
defines constraints that later Refactor 02 and Refactor 03 PRs must obey before
moving frontend or backend code.

Refactor 02 is no longer read from this document as an active implementation
plan. Its durable frontend import-boundary, public API, compatibility, and test
placement rules live in `memory/engineering/conventions/frontend/memory.md`,
`memory/engineering/conventions/react/memory.md`, and
`memory/engineering/conventions/refactoring/memory.md`.

This document is constraints-only. It does not move source roots, rename import
paths, change hook routing, change ignore rules, or migrate frontend/backend
domains.

The scoped surfaces are source roots, test roots, fixture roots, public API
roots, compatibility exports, and committed generated inputs.

## Inputs

- Refactor 01 final repository topology and lifecycle SOT:
  [`repository-topology-inventory.md`](repository-topology-inventory.md).
- #729 generated/cache/tmp/worktree fencing is a prerequisite when a later move
  relies on root-local cache/tmp/worktree paths staying outside source routing.
  This document does not duplicate #729 ignore or hook-router rules.
- Refactor 02 was the domain-first frontend migration. Its final SOT is the
  frontend/react/refactoring memory listed above; this document remains the
  Refactor 01 phase contract.
- Refactor 03 is the later backend adapter module migration.

## Execution Gate

Refactor 02 and Refactor 03 source moves must not start until the active DBMS
query, completion, smoke, and support-claim parity milestones that protect the
current source layout are complete or explicitly re-scoped in GitHub issues.

Each migration PR must keep one issue to one PR, list every moved root, and
state the compatibility export plan before moving files.

## Non-Goals For #730

- No `src/**` moves.
- No `src-tauri/**` moves.
- No test-root, fixture-root, generated-artifact, hook, script, config, package,
  Vite, ESLint, or `.gitignore` changes.
- No domain-first frontend implementation.
- No backend adapter module implementation.
- No product support-claim change.

## Root Movement Matrix

| Surface                           | Current root                                                         | Refactor 02 frontend move                                                           | Refactor 03 backend move                                                        | Constraints                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend runtime source           | `src/`                                                               | Allowed only inside a dedicated Refactor 02 PR                                      | Forbidden except consumer import updates needed by backend contracts            | Keep app behavior unchanged; preserve old public import specifiers through compatibility exports until cleanup PRs remove them.          |
| Frontend static assets            | `public/`                                                            | Allowed only if asset references, Vite build inputs, and tests are updated together | Forbidden                                                                       | Do not convert asset movement into product copy or UI behavior changes.                                                                  |
| Backend runtime source            | `src-tauri/src/`                                                     | Forbidden except typed client/API references caused by frontend imports             | Allowed only inside a dedicated Refactor 03 PR                                  | Preserve IPC command names, payload shapes, `DatabaseType` values, adapter factories, and result envelopes.                              |
| Rust integration tests            | `src-tauri/tests/`                                                   | Forbidden                                                                           | Allowed only when the moved backend module contract is exercised in the same PR | Tests move with the contract they prove; do not delete coverage as part of root cleanup.                                                 |
| Parser crates                     | `src-tauri/sql-parser-core/`, `src-tauri/mongosh-parser-core/`       | Forbidden                                                                           | Forbidden unless the parser crate itself is the issue scope                     | Parser crate moves require separate WASM build and generated-artifact evidence.                                                          |
| Committed generated inputs        | `src/lib/*/wasm/`, `src-tauri/gen/`, `src-tauri/icons/`              | Forbidden as disposable cache; allowed only through generator-owner PRs             | Forbidden as disposable cache; allowed only through generator-owner PRs         | These are generated but committed inputs. They must stay source-visible and must not be hidden by cache/tmp/worktree policies.           |
| Frontend tests                    | `src/**/*.test.ts`, `src/**/*.test.tsx`, `tests/`                    | Move with the frontend contract they prove                                          | Move only for shared contract updates caused by backend API changes             | Keep assertions on user-facing invariants and import compatibility, not old directory trivia.                                            |
| Fixtures and fixture generators   | `fixtures/`, `tests/fixtures/`, `e2e/fixtures/`, `scripts/fixtures/` | Forbidden unless the issue explicitly owns fixture routing                          | Forbidden unless the issue explicitly owns fixture routing                      | Fixture data and generator code are committed inputs. Do not treat them as tmp output or support-claim promotion by themselves.          |
| E2E smoke source and report mount | `e2e/`                                                               | Smoke spec moves require smoke routing proof                                        | Smoke spec moves require smoke routing proof                                    | Preserve `e2e/wdio-report/.gitkeep`; report output remains local generated output.                                                       |
| Tooling, hooks, CI, and docs      | `scripts/`, `.githooks/`, `.github/`, `docs/`, `memory/`             | Forbidden unless the migration issue names that policy surface                      | Forbidden unless the migration issue names that policy surface                  | Keep hook/path-router, workflow memory, and docs SOT changes out of source moves unless they are required and documented in the PR body. |

## Compatibility Export Constraints

Source-root migration PRs must make moved modules reachable through stable
compatibility exports until all consumers are updated in the same PR or a
follow-up cleanup issue is opened.

For post-Refactor 02 frontend work, this is not permission to add new consumer
imports from compatibility barrels or legacy feature roots. New consumer imports
must use the feature public API unless a fresh issue records compatibility owner,
horizon, and removal/preservation evidence.

Frontend constraints:

- Preserve existing public TypeScript import specifiers with explicit named
  re-exports from the old path.
- Prefer small compatibility files over broad barrel exports that hide side
  effects or widen the public API.
- Keep route/component/store/hook behavior unchanged while paths move.
- Add or update tests that import through the old public path when compatibility
  exports remain.

Backend constraints:

- Preserve Rust module reachability with `pub mod` or `pub use` from the old
  module boundary until consumers migrate.
- Preserve Tauri command names, request/response payloads, schema generation
  outputs, adapter factory names, and source capability fields.
- Do not move parser crates, generated schemas, or generated WASM artifacts as
  incidental backend cleanup.
- Remove compatibility exports only in a later cleanup PR that proves no
  downstream import still depends on them.

Generated-artifact constraints:

- `src/lib/sql/wasm/`, `src/lib/mongo/wasm/`, `src-tauri/gen/`, and
  `src-tauri/icons/` remain committed generated inputs.
- Regenerate these artifacts with their owner command when their source changes;
  do not hand-edit stale generated output to satisfy a path move.
- If a later PR must change a generated committed path, the PR must include the
  generator command, consumer import updates, and build/test evidence.

## Test, Fixture, And Generated Input Rules

- Tests move only with the behavior or contract they prove.
- Static fixtures and fixture generators stay in their current roots unless a
  fixture-owned issue changes that routing.
- Fixture-only evidence does not widen runtime support claims. Smoke wiring or
  focused runtime tests must prove any support-claim change.
- Local generated/cache/tmp/worktree paths stay outside source ownership per
  #729; committed generated inputs stay tracked source-visible paths per #728.
- A source-root migration PR must list all moved test, fixture, and generated
  committed-input paths in its PR body.

## Verification Requirements For Later Migration PRs

Every Refactor 02 or Refactor 03 migration PR must include:

- Before/after moved-path inventory.
- Compatibility export inventory.
- Import/reference search proving old and new paths are covered.
- Targeted frontend, backend, parser, fixture, or smoke checks selected by the
  moved roots.
- `git diff --check` and docs formatting checks for touched docs.
- Explicit statement that generated/cache/tmp/worktree fence behavior from #729
  was not weakened.

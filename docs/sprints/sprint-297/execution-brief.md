# Sprint Execution Brief: sprint-297

## Objective

Replace the dead Docker full-suite E2E path with a smoke-only E2E harness:
PostgreSQL and MongoDB each get an independent happy path spec under
`e2e/smoke/`, CI runs them on Linux host with DB service containers, and the
workflow is informational while stability data accumulates.

## Task Why

The existing E2E path is skipped and operationally dead. It mixes Docker image
freshness, Tauri/Vite build memory, Xvfb/WebKit timing, DB seed, and too many
feature scenarios into one failure surface. Sprint 297 restores runtime
observability with the smallest user-facing happy paths and removes the broken
runner so there is one active E2E story.

## Scope Boundary

- Remove the legacy full E2E suite and Docker E2E runner.
- Add smoke E2E for PostgreSQL and MongoDB only.
- Use WebdriverIO + `tauri-driver`; do not add Playwright.
- Use GitHub Actions service containers for DBs; do not run app/WebDriver in
  Docker.
- Do not touch unrelated dirty files or sprint-295/296 implementation changes.
- Do not make E2E a required branch protection gate in this sprint.

## Invariants

- `postgres`, `mongo`, and `mysql` DB services remain available for local dev /
  integration tests.
- Production `pnpm build` remains the correctness check for release frontend
  build.
- Smoke specs use public UI behavior and labels.
- `TABLE_VIEW_TEST_DATA_DIR` isolates app storage per DBMS smoke.
- No new runtime dependency.

## Done Criteria

1. Active Docker E2E runner references are gone from product scripts, active
   docs, compose config, and active workflows.
2. `e2e/smoke/postgres.spec.ts` and `e2e/smoke/mongodb.spec.ts` exist and are
   independently runnable.
3. `wdio.smoke.conf.ts` targets only smoke specs and does not rebuild Tauri in
   `onPrepare`.
4. `scripts/e2e-smoke-ci.sh` seeds DB fixtures, builds Tauri once with
   `tauri.e2e.conf.json`, and runs smoke specs under Xvfb.
5. `.github/workflows/e2e-smoke.yml` runs on push/manual dispatch, uses GHA
   Postgres/Mongo services, configures pnpm/rust cache correctly, uploads
   artifacts, and is informational.
6. README / `.env.example` / `docs/PLAN.md` / `lefthook.yml` reflect the new
   smoke policy and no longer instruct users to run Docker E2E.
7. Required static and command checks pass or blockers are documented.

## Verification Plan

- Profile: `mixed`
- Required checks:
  1. `rg "Dockerfile.e2e|run-e2e-docker|test:e2e:docker|table-view-e2e" package.json docker-compose.yml README.md .env.example scripts e2e .github`
  2. `find e2e -maxdepth 2 -type f | sort`
  3. `rg "workflow_dispatch|continue-on-error: true|cache-workspace-crates|services:" .github/workflows/e2e-smoke.yml`
  4. `pnpm tsc --noEmit`
  5. `pnpm lint`
  6. `pnpm test`
  7. `bash scripts/e2e-smoke-ci.sh` when Linux host / tauri-driver / Xvfb are available
- Required evidence:
  - changed files and purpose
  - command outputs / exit statuses
  - AC coverage table
  - smoke runtime gaps if local platform cannot execute automated Tauri E2E

## Evidence To Return

- Changed files and purpose.
- Checks run and outcomes.
- Done criteria coverage with evidence.
- Assumptions made during implementation.
- Residual risk or verification gaps.

## References

- Contract: `docs/sprints/sprint-297/contract.md`
- Findings: `docs/sprints/sprint-297/findings.md`
- Handoff: `docs/sprints/sprint-297/handoff.md`
- Master spec: `docs/sprints/sprint-297/spec.md`
- Relevant files:
  - `package.json`
  - `docker-compose.yml`
  - `.github/workflows/e2e-smoke.yml`
  - `README.md`
  - `.env.example`
  - `docs/PLAN.md`
  - `lefthook.yml`
  - `src-tauri/tauri.e2e.conf.json`
  - `wdio.smoke.conf.ts`
  - `scripts/e2e-smoke-ci.sh`
  - `e2e/smoke/**`
  - `e2e/fixtures/**`

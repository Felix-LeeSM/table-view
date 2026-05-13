# Sprint 297 Handoff

## Summary

Sprint 297 replaces the dead Docker full-suite E2E path with a smoke-only
runtime harness:

- Legacy Docker E2E runner and full root `e2e/*.spec.ts` suite removed.
- New smoke specs live under `e2e/smoke/`.
- CI smoke runs on Linux host with GitHub Actions DB service containers and is
  informational (`continue-on-error: true`).
- README / `.env.example` / `docs/PLAN.md` / `lefthook.yml` now describe the
  active policy: main correctness comes from lint/typecheck/unit/build; runtime
  happy path comes from E2E smoke.

## Changed Files

| Path | Purpose |
| --- | --- |
| `package.json` | Adds `build:e2e`; points `test:e2e` and `test:e2e:smoke` at `wdio.smoke.conf.ts`; removes Docker E2E scripts. |
| `wdio.smoke.conf.ts` | New smoke-only WDIO config, existing-binary check, tauri-driver startup, failure artifacts. |
| `e2e/smoke/_helpers.ts` | Minimal launcher/connection/workspace helpers for smoke tests. |
| `e2e/smoke/postgres.spec.ts` | PostgreSQL runtime happy path. |
| `e2e/smoke/mongodb.spec.ts` | MongoDB runtime happy path. |
| `e2e/fixtures/seed-smoke.ts` | Host-side Postgres + Mongo smoke fixture seeding with readiness retry. |
| `e2e/fixtures/seed.sql` | Comment cleanup for smoke seed ownership. |
| `scripts/e2e-smoke-ci.sh` | Linux host smoke runner: seed, build Tauri once, run each DBMS spec with isolated app data. |
| `.github/workflows/e2e-smoke.yml` | Informational GitHub Actions workflow with Postgres/Mongo services and pnpm/Rust dependency cache; cargo bin caching disabled. |
| `.github/workflows/ci.yml` | Replaces stale “E2E removed” comment with pointer to informational smoke workflow. |
| `src-tauri/tauri.e2e.conf.json` | Overrides E2E build to `pnpm build:e2e` and `../dist`. |
| `docker-compose.yml` | Removes `e2e` service; keeps DB services. |
| `lefthook.yml` | Removes skipped pre-push E2E block. |
| `README.md`, `.env.example`, `docs/PLAN.md` | Documents smoke policy, Linux limitation, local command shape, env vars. |
| deleted legacy files | `Dockerfile.e2e`, `wdio.conf.ts`, `scripts/e2e-pre-push.sh`, `scripts/setup-e2e.sh`, `e2e/run-e2e-docker.sh`, legacy root `e2e/*.spec.ts`, `e2e/_helpers.ts`. |

## How To Run

Linux host / CI-equivalent:

```bash
docker compose up -d postgres mongo
E2E_PG_PORT=15432 E2E_MONGO_PORT=37017 bash scripts/e2e-smoke-ci.sh
```

Individual smoke specs after a debug binary exists:

```bash
TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke-pg pnpm test:e2e:smoke -- --spec e2e/smoke/postgres.spec.ts
TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-smoke-mongo pnpm test:e2e:smoke -- --spec e2e/smoke/mongodb.spec.ts
```

## Verification

- `pnpm lint` — pass
- `pnpm exec tsc --noEmit` — pass
- `pnpm exec tsc -b` — pass
- `pnpm build` — pass, existing Vite chunk warnings only
- `pnpm test` — pass, 274 files / 3349 passed / 10 skipped
- `bash -n scripts/e2e-smoke-ci.sh` — pass
- Prettier check for touched formatted files — pass
- Scoped legacy E2E grep — pass, no active references

Full `bash scripts/e2e-smoke-ci.sh` runtime was not executed on this macOS host.
The sprint target is Linux host CI with `xvfb`, WebKitGTK, and `tauri-driver`.

## Residual Risk

- First Linux CI run may expose selector or WebKit timing differences that
  local static checks cannot prove.
- Mongo smoke intentionally stops at seeded collection preview. A query-tab
  Mongo find can be added once that UI surface is stable enough for smoke.
- Existing unrelated dirty files under `src-tauri/` and sprint-296 artifacts
  were left untouched.

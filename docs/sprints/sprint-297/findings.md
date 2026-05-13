# Sprint 297 Findings

## Result

No P1/P2 findings.

## Acceptance Criteria Review

| AC | Status | Evidence |
| --- | --- | --- |
| AC-01 legacy Docker E2E removed | PASS | Deleted `Dockerfile.e2e`, legacy root `e2e/*.spec.ts`, `e2e/_helpers.ts`, `e2e/run-e2e-docker.sh`, `scripts/e2e-pre-push.sh`, `scripts/setup-e2e.sh`, `wdio.conf.ts`; scoped legacy `rg` returns no matches. |
| AC-02 PostgreSQL smoke | PASS static | `e2e/smoke/postgres.spec.ts` creates UI connection, opens workspace, verifies `users` seed row, runs `SELECT 1 AS test_column`, verifies result `1`. |
| AC-03 MongoDB smoke | PASS static | `e2e/smoke/mongodb.spec.ts` creates UI connection, opens workspace, expands `table_view_test`, opens `smoke_users`, verifies seeded document text. |
| AC-04 storage isolation | PASS | `scripts/e2e-smoke-ci.sh` runs Postgres and Mongo specs with separate `TABLE_VIEW_TEST_DATA_DIR` subdirectories. |
| AC-05 smoke-only WDIO config | PASS | `wdio.smoke.conf.ts` targets `./e2e/smoke/**/*.spec.ts`, checks for an existing debug binary in `onPrepare`, and starts `tauri-driver` separately. |
| AC-06 informational CI workflow | PASS | `.github/workflows/e2e-smoke.yml` uses `push` + `workflow_dispatch`, `ubuntu-latest`, service containers, `continue-on-error: true`, and artifact upload. |
| AC-07 cache policy | PASS | Workflow uses `actions/setup-node` pnpm cache keyed by `pnpm-lock.yaml`; no `node_modules` cache; Rust uses `Swatinem/rust-cache` with `cache-workspace-crates: false`, `shared-key: e2e-smoke-linux`, main-only save. |
| AC-08 docs | PASS | README, `.env.example`, and `docs/PLAN.md` describe smoke semantics, Linux host CI, macOS/Windows limitation, local command, env vars, and informational status. |
| AC-09 no skipped pre-push E2E gate | PASS | Removed `lefthook.yml` skipped E2E block. |
| AC-10 checks | PASS with runtime gap | `pnpm lint`, `pnpm exec tsc --noEmit`, `pnpm exec tsc -b`, `pnpm build`, `pnpm test`, `bash -n scripts/e2e-smoke-ci.sh`, Prettier check all pass. Full Tauri E2E smoke not run locally because this host is macOS while the sprint target is Linux/xvfb/tauri-driver CI. |

## Verification Log

| Command | Result |
| --- | --- |
| `rg "Dockerfile.e2e\|run-e2e-docker\|test:e2e:docker\|table-view-e2e\|--profile test.*e2e" package.json docker-compose.yml README.md .env.example scripts e2e .github` | PASS, no matches |
| `rg "workflow_dispatch\|continue-on-error: true\|cache-workspace-crates\|services:\|cache-dependency-path" .github/workflows/e2e-smoke.yml` | PASS |
| `bash -n scripts/e2e-smoke-ci.sh` | PASS |
| `pnpm exec prettier --check README.md docs/PLAN.md .github/workflows/ci.yml .github/workflows/e2e-smoke.yml package.json src-tauri/tauri.e2e.conf.json wdio.smoke.conf.ts e2e/smoke/_helpers.ts e2e/smoke/postgres.spec.ts e2e/smoke/mongodb.spec.ts e2e/fixtures/seed-smoke.ts` | PASS |
| `pnpm lint` | PASS |
| `pnpm exec tsc --noEmit` | PASS |
| `pnpm exec tsc -b` | PASS |
| `pnpm build` | PASS, existing Vite chunk warnings only |
| `pnpm test` | PASS, 274 files / 3349 passed / 10 skipped |

## Notes

- A direct exploratory command `pnpm exec tsc --noEmit --skipLibCheck false` failed on existing dependency declaration issues in `@codemirror/lang-json` and `lucide-react`. The project command path does not use that stricter library check; `pnpm exec tsc --noEmit` and `pnpm exec tsc -b` both pass.
- The Mongo smoke currently validates collection preview rather than a query-tab find. This is within the sprint contract fallback because the collection grid is the stable minimal user-facing document happy path.

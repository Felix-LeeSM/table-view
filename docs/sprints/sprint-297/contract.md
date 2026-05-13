# Sprint Contract: sprint-297

## Summary

- Goal: dead full-suite Docker E2E 를 제거하고, Linux host CI 에서 DBMS 별
  runtime happy path 를 관측하는 smoke E2E 로 재구축한다.
- Audience: 개인 프로젝트 maintainer. PR 없이 push 해도 E2E 신호를 받되,
  초기 안정화 전에는 개발 흐름을 막지 않는다.
- Owner: Generator.
- Verification Profile: `mixed`

## In Scope

- 기존 Docker E2E runner 및 full-suite spec 제거.
- `e2e/smoke/` 기반 PostgreSQL / MongoDB 독립 smoke spec 추가.
- `wdio.smoke.conf.ts` 및 host Linux smoke script 추가.
- GitHub Actions `e2e-smoke.yml` 추가. DB 는 service containers, app /
  WebDriver 는 host runner.
- e2e 전용 frontend build (`build:e2e`) 및 `tauri.e2e.conf.json` build override.
- README / `.env.example` / `docs/PLAN.md` / `lefthook.yml` 의 active E2E
  문서 갱신.

## Out of Scope

- Playwright 도입.
- Docker image 안에서 Tauri app / WebDriver 를 실행하는 새 runner 작성.
- macOS automated E2E 지원.
- Windows E2E lane.
- 기존 full-suite 시나리오의 1:1 보존.
- MySQL smoke. MySQL adapter 통합은 sprint-296/후속 sprint 범위.
- 제품 UI selector refactor. Smoke 는 현재 공개 UI label / ids 를 사용한다.

## Invariants

- DB service definitions (`postgres`, `mongo`, `mysql`) 는 docker-compose 에
  유지된다. 제거 대상은 `e2e` service 뿐이다.
- `e2e/fixtures/seed.sql` 의 Postgres seed data 는 idempotent 여야 한다.
- `e2e/wdio-report/.gitkeep` 는 유지된다.
- Production build 검증은 기존 CI `pnpm build` 책임으로 남는다.
- Existing unrelated dirty files and sprint artifacts outside sprint-297 scope
  are not edited.
- No new runtime dependency.

## Acceptance Criteria

- `AC-01`: Legacy Docker E2E path removed. Product-active files contain no
  `Dockerfile.e2e`, `run-e2e-docker`, `test:e2e:docker`, `table-view-e2e`, or
  Docker `e2e` service references.
- `AC-02`: `e2e/smoke/postgres.spec.ts` creates a PostgreSQL connection via UI,
  opens workspace, verifies seeded data, runs `SELECT 1 AS test_column`, and
  verifies result `1`.
- `AC-03`: `e2e/smoke/mongodb.spec.ts` creates a MongoDB connection via UI,
  opens workspace, verifies seeded database / collection data, and verifies a
  minimal document happy path.
- `AC-04`: Smoke specs are isolated by `TABLE_VIEW_TEST_DATA_DIR`; Postgres and
  Mongo can run independently without connection state reuse.
- `AC-05`: `wdio.smoke.conf.ts` targets only `e2e/smoke/**/*.spec.ts`, uses the
  existing Tauri debug binary, and does not rebuild in `onPrepare`.
- `AC-06`: CI workflow `.github/workflows/e2e-smoke.yml` runs on `push` and
  `workflow_dispatch`, uses GHA service containers for Postgres/Mongo, runs on
  `ubuntu-latest`, and is informational (`continue-on-error: true`).
- `AC-07`: CI cache follows project policy: pnpm store cache only; no
  `node_modules` cache; `Swatinem/rust-cache` with
  `cache-workspace-crates: "false"` and main-only save; no direct
  `src-tauri/target` actions/cache.
- `AC-08`: README and env docs explain smoke meaning, Linux host CI target,
  macOS limitation, local command shape, and informational status.
- `AC-09`: `lefthook.yml` no longer contains a skipped pre-push E2E gate.
- `AC-10`: Typecheck / lint / unit tests remain green or any unrun checks are
  explicitly reported with a blocker reason.

## Design Bar / Quality Bar

- Tests assert user-observable behavior through the actual Tauri UI, not
  internal stores or storage files.
- Helpers are small and scenario-oriented. Do not port legacy idempotent
  full-suite recovery wholesale.
- The first tracer bullet is Postgres smoke. Mongo follows only after the host
  WDIO path is wired.
- Failure messages should identify layer: DB readiness, seed, Tauri build,
  `tauri-driver`, window switch, or UI assertion.
- Documentation must not leave two active E2E entrypoints with conflicting
  advice.

## Verification Plan

### Required Checks

1. Static cleanup:
   `rg "Dockerfile.e2e|run-e2e-docker|test:e2e:docker|table-view-e2e" package.json docker-compose.yml README.md .env.example scripts e2e .github`
   returns 0.
2. Smoke surface:
   `find e2e -maxdepth 2 -type f | sort` shows only fixtures, `wdio-report/.gitkeep`,
   and `e2e/smoke/**` E2E files.
3. Workflow inspection:
   `rg "workflow_dispatch|continue-on-error: true|cache-workspace-crates|services:" .github/workflows/e2e-smoke.yml`.
4. TypeScript:
   `pnpm tsc --noEmit`.
5. Lint:
   `pnpm lint`.
6. Unit regression:
   `pnpm test`.
7. Linux smoke command when environment supports it:
   `bash scripts/e2e-smoke-ci.sh`.

### Required Evidence

- Generator must provide:
  - changed files with purpose
  - checks run and outcomes
  - acceptance criteria coverage with concrete evidence
  - any smoke checks not run and why
- Evaluator must cite:
  - static cleanup evidence
  - smoke file structure
  - workflow cache/service evidence
  - command outcomes
  - missing or weak evidence as findings

## Test Requirements

### Unit Tests

- No new unit tests are required for config deletion itself.
- Any new seed helper logic must be executable through the smoke host script.
- If standalone seed modules expose functions, add minimal behavior tests only
  when they contain branching beyond straightforward fixture writes.

### Scenario Tests

- [x] Happy path: Postgres smoke.
- [x] Happy path: Mongo smoke.
- [x] Error surfacing: connection save failure reports dialog alert text.
- [x] Boundary: empty app data dir per DBMS.
- [x] Existing functionality regression: `pnpm test`, `pnpm tsc`, `pnpm lint`.

## Test Script / Repro Script

1. `pnpm tsc --noEmit`
2. `pnpm lint`
3. `pnpm test`
4. `bash scripts/e2e-smoke-ci.sh`
5. `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-e2e-pg pnpm test:e2e:smoke -- --spec e2e/smoke/postgres.spec.ts`
6. `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-e2e-mongo pnpm test:e2e:smoke -- --spec e2e/smoke/mongodb.spec.ts`

## Ownership

- Generator: implement Sprint 297 ACs and return evidence packet.
- Write scope:
  - `package.json`
  - `docker-compose.yml`
  - `.github/workflows/e2e-smoke.yml`
  - `.github/workflows/ci.yml`
  - `README.md`
  - `.env.example`
  - `docs/PLAN.md`
  - `lefthook.yml`
  - `src-tauri/tauri.e2e.conf.json`
  - `wdio.smoke.conf.ts`
  - `scripts/e2e-smoke-ci.sh`
  - `e2e/smoke/**`
  - `e2e/fixtures/**`
  - legacy E2E files listed in spec Slice A
- Merge order:
  1. Static cleanup and script/package wiring.
  2. Postgres smoke tracer bullet.
  3. Mongo smoke.
  4. CI workflow.
  5. Docs and final verification.

## Exit Criteria

- Open `P1`/`P2` findings: `0`.
- Required checks passing or explicitly blocked by platform/environment.
- Acceptance criteria evidence linked in `handoff.md`.

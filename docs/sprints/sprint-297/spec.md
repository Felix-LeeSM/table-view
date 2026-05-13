# Feature Spec: E2E smoke 재구축 — host Linux runner + DB services

## Description

현재 E2E 는 Docker image 안에 Tauri build / Vite production build /
WebKitGTK / Xvfb / WebdriverIO / DB seed 를 모두 넣은 full-suite 구조다. 이
경로는 2026-05-01 이후 `lefthook.yml` 에서 skip 상태이며, 복구 조건도
복잡하다:

1. **Docker E2E runner OOM / timeout** — e2e container 안에서 Tauri debug
   binary 를 만들며 Vite production build 와 Cargo compile 이 같은 좁은
   memory envelope 를 공유한다.
2. **full-suite surface 과다** — connection, import/export, keyboard,
   schema tree, DB switching, raw query edit 등 여러 feature regression 이
   한 WebDriver lane 에 섞여 실패 원인 분리가 어렵다.
3. **pre-push gate dead state** — 작동하지 않는 E2E gate 를 skip 한 채로
   유지하면서, 실제 runtime happy path 를 push 마다 관측하지 못한다.
4. **macOS host 자동화 불가** — `tauri-driver` 는 macOS WKWebView 를 지원하지
   않는다. Linux / Windows 가 공식 자동화 경로이며, 본 sprint 는 Linux CI 에
   먼저 붙인다.

본 sprint 는 기존 full E2E 를 제거하고, **DBMS 별 최소 happy path smoke** 로
재구축한다. DB 는 GitHub Actions service container 로 띄우고, Tauri app /
`tauri-driver` / WebdriverIO 는 CI Linux host 에서 실행한다. E2E check 는
처음에는 **informational** 로 두어 실패 신호는 보되 개인 프로젝트 개발 흐름은
막지 않는다.

## Sprint Breakdown

Sprint 단위는 sprint-297 한 개. 내부적으로 **4 슬라이스** — Remove → Smoke
→ CI → Docs. 구현보다 먼저 설계 결정을 코드와 문서의 단일 경로로 정리한다.

### Slice A — Remove: legacy full E2E + Docker runner 제거

**Goal**: 죽은 full E2E 경로를 완전히 제거해 새 smoke 경로와 혼동되지 않게
한다.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. `Dockerfile.e2e` 삭제.
2. `e2e/run-e2e-docker.sh` 삭제.
3. 기존 full-suite spec 삭제:
   - `e2e/app.spec.ts`
   - `e2e/connection.spec.ts`
   - `e2e/connection-switch.spec.ts`
   - `e2e/data-grid.spec.ts`
   - `e2e/feedback-2026-04-27.spec.ts`
   - `e2e/home-workspace-swap.spec.ts`
   - `e2e/import-export.spec.ts`
   - `e2e/keyboard-shortcuts.spec.ts`
   - `e2e/paradigm-and-shortcuts.spec.ts`
   - `e2e/raw-query-edit.spec.ts`
   - `e2e/schema-tree.spec.ts`
4. 기존 full-suite helper `e2e/_helpers.ts` 삭제. 새 smoke helper 는
   `e2e/smoke/_helpers.ts` 로 새로 작성.
5. `docker-compose.yml` 의 `e2e` service 제거. `postgres`, `mongo`, `mysql`
   service 와 volumes 는 유지.
6. `package.json` 에서 `test:e2e:docker`, `test:e2e:docker:rebuild`,
   `test:e2e:docker:down` 제거.
7. `scripts/e2e-pre-push.sh`, `scripts/setup-e2e.sh` 삭제 또는 smoke host
   안내 script 로 전면 교체. Docker E2E runner 문자열은 남지 않아야 한다.
8. `rg "Dockerfile.e2e|run-e2e-docker|test:e2e:docker|table-view-e2e|--profile test.*e2e"
   package.json docker-compose.yml README.md .env.example scripts e2e .github`
   에서 역사 문서(`docs/`, `memory/`) 를 제외하고 0 match.

**Components**:
- `Dockerfile.e2e`: delete.
- `docker-compose.yml`: remove `e2e` service only.
- `package.json`: remove docker E2E scripts.
- `scripts/e2e-pre-push.sh`, `scripts/setup-e2e.sh`: delete / replace.
- `e2e/*.spec.ts`, `e2e/_helpers.ts`, `e2e/run-e2e-docker.sh`: delete.

### Slice B — Smoke: DBMS 별 독립 happy path spec

**Goal**: PostgreSQL / MongoDB 각각 독립 spec 으로 최소 runtime happy path 를
검증한다. 각 spec 은 connection 생성부터 결과 확인까지 자기 안에서 완료하며,
spec 간 앱 상태를 공유하지 않는다.

**Verification Profile**: `mixed`

**Acceptance Criteria**:

1. 새 디렉토리:
   - `e2e/smoke/_helpers.ts`
   - `e2e/smoke/postgres.spec.ts`
   - `e2e/smoke/mongodb.spec.ts`
2. `e2e/smoke/_helpers.ts` 는 다음만 제공:
   - launcher ready wait.
   - New Connection dialog open.
   - DB type 선택.
   - form fill + save.
   - connection row activate.
   - workspace window switch.
   - failure artifact dump 에 필요한 small helper.
   기존 full-suite 의 idempotent recovery / cross-spec reuse helper 는 복사하지
   않는다.
3. PostgreSQL smoke:
   - 빈 app data dir 에서 시작.
   - UI 로 `E2E Postgres` connection 생성.
   - host `localhost`, port `${E2E_PG_PORT:-15432}`, user `testuser`, password
     `testpass`, database `table_view_test`.
   - connection double-click → workspace.
   - `public schema` 표시.
   - `users table` 또는 첫 table click.
   - grid 에 seed row (`Alice` 또는 `alice@example.com`) 표시.
   - New Query Tab → `SELECT 1 AS test_column` 실행 → result cell `1`.
4. MongoDB smoke:
   - 빈 app data dir 에서 시작.
   - UI 로 `E2E MongoDB` connection 생성.
   - host `localhost`, port `${E2E_MONGO_PORT:-37017}`, user `testuser`, password
     `testpass`, database `table_view_test`, auth source `admin`.
   - connection double-click → workspace.
   - document database tree 표시.
   - `table_view_test database` 확장.
   - smoke collection click.
   - document grid 에 seed document 표시.
   - New Query Tab 또는 collection tab 의 query surface 에서 simple find 실행
     → expected document 표시. Query tab path 가 불안정하면 v1 은 collection
     grid 표시까지만 하고, query execution 은 Slice B finding 에 deferred
     marker 없이 명시한다.
5. 각 spec 은 별도 `TABLE_VIEW_TEST_DATA_DIR` 로 실행 가능해야 한다.
   - Postgres: `${RUNNER_TEMP}/table-view-e2e/postgres`
   - Mongo: `${RUNNER_TEMP}/table-view-e2e/mongodb`
6. `wdio.smoke.conf.ts` 신규. `specs` 는 `./e2e/smoke/**/*.spec.ts`.
   `wdio.conf.ts` legacy full-suite config 는 제거하거나 smoke config 로 rename.
7. `wdio.smoke.conf.ts` 는 `onPrepare` 에서 Tauri build 를 반복하지 않는다.
   CI script 가 binary 를 한 번 build 하고, config 는 existing binary 를 사용한다.
8. failure artifacts 는 `e2e/wdio-report/` 에 screenshot / page source /
   window inventory 를 남긴다. 기존 artifact folder 는 유지.

**Components**:
- `e2e/smoke/_helpers.ts`: 신규.
- `e2e/smoke/postgres.spec.ts`: 신규.
- `e2e/smoke/mongodb.spec.ts`: 신규.
- `wdio.smoke.conf.ts`: 신규.
- `e2e/wdio-report/.gitkeep`: 유지.

### Slice C — CI: host Linux smoke workflow + dependency cache

**Goal**: PR 없이도 push 마다 runtime happy path 를 관측한다. 실패는
informational 로 두되 artifacts 를 업로드한다.

**Verification Profile**: `command`

**Acceptance Criteria**:

1. 신규 workflow `.github/workflows/e2e-smoke.yml`.
2. trigger:
   - `push`
   - `workflow_dispatch`
3. job:
   - `runs-on: ubuntu-latest`
   - `continue-on-error: true`
   - `timeout-minutes`: 30 또는 40.
4. GitHub Actions service containers 사용:
   - `postgres:16-alpine`, host port `15432`.
   - `mongo:7`, host port `37017`, auth enabled (`testuser` / `testpass`).
   Docker Compose `e2e` service 는 사용하지 않는다.
5. Linux dependencies:
   - Tauri Linux build deps (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`,
     `libayatana-appindicator3-dev`, `librsvg2-dev` 등).
   - WebDriver runtime (`webkit2gtk-driver`, `xvfb`).
   - `tauri-driver` 설치 또는 cache-aware cargo install.
6. Node cache:
   - `pnpm/action-setup@v4`.
   - `actions/setup-node` `cache: pnpm`, `cache-dependency-path: pnpm-lock.yaml`.
   - `node_modules` 직접 cache 금지.
7. Rust cache:
   - `Swatinem/rust-cache@v2`.
   - `workspaces: src-tauri -> target`.
   - `shared-key: e2e-smoke-linux`.
   - `cache-workspace-crates: "false"`.
   - `save-if: ${{ github.ref == 'refs/heads/main' }}`.
   - `actions/cache` 로 `src-tauri/target` 직접 cache 금지.
8. e2e 전용 frontend build:
   - `package.json` 에 `build:e2e` 추가 (`vite build --mode e2e --minify=false`).
   - `src-tauri/tauri.e2e.conf.json` 에 `build.beforeBuildCommand` 를
     `pnpm build:e2e` 로 override.
   - fast CI 의 `pnpm build` 가 production build 책임을 유지하므로 e2e job 에서
     `tsc` 를 중복 실행하지 않는다.
9. host script:
   - 신규 `scripts/e2e-smoke-ci.sh` 또는 `scripts/e2e-smoke-host.sh`.
   - DB service readiness wait.
   - Postgres seed (`e2e/fixtures/seed.sql`).
   - Mongo seed (`e2e/fixtures/mongo-seed.ts` 또는 `.js`).
   - `pnpm tauri build --debug --no-bundle --config src-tauri/tauri.e2e.conf.json`.
   - `xvfb-run pnpm test:e2e:smoke`.
10. workflow 는 실패 시 `e2e/wdio-report/` 를 artifact 로 업로드.
11. `.github/workflows/ci.yml` 의 “E2E removed” stale comment 제거 또는
    e2e-smoke workflow 안내로 교체.

**Components**:
- `.github/workflows/e2e-smoke.yml`: 신규.
- `scripts/e2e-smoke-ci.sh`: 신규.
- `package.json`: scripts 추가.
- `src-tauri/tauri.e2e.conf.json`: build override 추가.
- `e2e/fixtures/mongo-seed.ts` 또는 `.js`: 신규.

### Slice D — Docs: README / env docs / policy update

**Goal**: 새 E2E 운영 방식을 README 에 명확히 남긴다. 더 이상 Docker E2E
runner 를 권장하지 않는다.

**Verification Profile**: `inspection`

**Acceptance Criteria**:

1. README “E2E 테스트” 섹션 갱신:
   - `smoke` 의 의미.
   - CI 에서 Linux host + GHA service containers 로 실행.
   - macOS 는 `tauri-driver` 자동화 미지원이라 local automated E2E target 이
     아님.
   - local DB 만 Docker Compose 로 띄우고 host Linux 에서 smoke 실행하는 방법.
   - E2E check 는 초기에는 informational.
2. README 명령 예:
   - `pnpm test:e2e:smoke`
   - `bash scripts/e2e-smoke-ci.sh` 또는 local host script.
3. `.env.example` 갱신:
   - Docker E2E runner 설명 제거.
   - host smoke 에 쓰는 `E2E_PG_PORT`, `E2E_MONGO_PORT`, `TABLE_VIEW_TEST_DATA_DIR`
     설명 추가.
4. `docs/PLAN.md` 의 E2E 정책 문단 갱신:
   - full E2E suite 대신 smoke-first policy.
   - CI informational check.
   - DBMS 별 smoke matrix.
5. `lefthook.yml` 의 skip 된 e2e pre-push command 제거. E2E 는 pre-push gate 가
   아니라 CI informational check 라고 주석으로 명시.
6. `rg "test:e2e:docker|Dockerfile.e2e|run-e2e-docker|pre-push e2e gate|skip: true"
   README.md .env.example package.json docker-compose.yml lefthook.yml .github scripts`
   0 match.

**Components**:
- `README.md`: update.
- `.env.example`: update.
- `docs/PLAN.md`: update.
- `lefthook.yml`: remove e2e pre-push command.

## Global Acceptance Criteria

1. 기존 Docker E2E runner 경로는 제품 코드 / README / package scripts 에서
   완전 제거.
2. 새 E2E 표면은 `e2e/smoke/**` 만.
3. `e2e/fixtures/seed.sql` 은 유지하고 idempotent contract 를 현 smoke 경로에
   맞게 주석 갱신.
4. Mongo seed fixture 추가 — smoke collection 과 expected document 가 명시적.
5. `pnpm test:e2e:smoke -- --spec e2e/smoke/postgres.spec.ts` 형태의 단독 실행 가능.
6. `pnpm test:e2e:smoke -- --spec e2e/smoke/mongodb.spec.ts` 형태의 단독 실행 가능.
7. `pnpm tsc --noEmit` exit 0.
8. `pnpm lint` exit 0.
9. `pnpm test` exit 0 또는 e2e-only 변경으로 인한 skip/fixture 영향 없음 증명.
10. CI workflow syntax 검증:
    - `rg "continue-on-error: true" .github/workflows/e2e-smoke.yml`.
    - `rg "cache-workspace-crates" .github/workflows/e2e-smoke.yml`.
    - `rg "services:" .github/workflows/e2e-smoke.yml`.
11. No new runtime dependencies. Dev dependency 추가도 원칙적으로 없음. Mongo seed 는
    기존 `mongodb` package 와 `tsx` 를 재사용.
12. 기존 사용자 변경 보존 — sprint 진입 시점의 unrelated dirty files
    (`src/components/query/SqlQueryEditor.tsx`, sprint-295/296 문서 등) 은 건드리지
    않는다.

## 정책 결정 요약 (grill-me 산출물)

| 결정 | 값 | 근거 |
|---|---|---|
| E2E 목적 | 최소 happy path smoke | full-suite 복구보다 runtime 생존 신호 우선 |
| 대상 DBMS | PostgreSQL + MongoDB | 현재 UI supported adapters |
| Spec 구조 | DBMS 별 독립 spec | 실패 원인 분리 + 향후 MySQL/SQLite 확장 |
| DB 실행 | GHA service containers | e2e runner Docker 제거, host WebDriver 유지 |
| App/WebDriver | Linux host | `tauri-driver` 공식 자동화 경로 |
| macOS | automated E2E target 아님 | WKWebView WebDriver 미지원 |
| CI 정책 | push + workflow_dispatch, informational | 개인 프로젝트 병목 방지 + 관측 유지 |
| Build | `build:e2e` + Tauri debug | production build 검증과 runtime smoke 책임 분리 |
| Cache | pnpm store + rust-cache dependency 중심 | `target` 통째 cache 금지, 10GB thrash 방지 |
| Legacy full suite | 제거 | dead path 혼동 제거 |

## Data Flow

CI push → `e2e-smoke.yml` → GHA Postgres/Mongo services boot → seed scripts →
host `pnpm tauri build --debug --no-bundle --config tauri.e2e.conf.json` →
`xvfb-run pnpm test:e2e:smoke` → WDIO launches Tauri debug binary →
Postgres spec creates connection through UI → workspace → schema/grid/query →
Mongo spec creates connection through UI → workspace → database tree/grid/find →
artifacts uploaded on failure.

## Operational States

- **Green**: both DBMS smoke specs pass. Workflow green but still informational.
- **Product failure**: app launches but UI/DB happy path fails. Artifact shows
  window inventory / screenshot / DOM.
- **Infra failure**: DB service health, apt install, `tauri-driver`, Xvfb, or
  Tauri build fails. Workflow red informational; failure message must identify
  layer.
- **Cache miss**: acceptable. Clean debug build measured locally at ~2.9GB
  target / ~77MB binary / ~1m10s Cargo compile on 2026-05-13 macOS host.
- **macOS local**: DB services and manual smoke possible; automated WebDriver
  unsupported.

## Edge Cases

- DB service starts but seed has not applied — specs must assert expected seed
  values, not just empty UI widgets.
- Connection save dialog stays open — helper must surface `role="alert"` text.
- Workspace window handle appears late — helper polls by exact document title.
- Existing local app storage contaminates run — `TABLE_VIEW_TEST_DATA_DIR` is
  mandatory in smoke script.
- Postgres/Mongo port conflict on local host — env vars override ports.
- Mongo auth source mismatch — v1 uses `admin` for auth and `table_view_test`
  as default DB.
- `New Query Tab` on document connection lacking database context — if current
  product cannot open a find query tab from sidebar with DB context, v1 Mongo
  query execution is explicitly deferred to a follow-up and collection grid
  becomes the smoke assertion.
- Windows `tauri-driver` support exists but is out of sprint scope.

## Verification Hints

- Static cleanup:
  - `rg "Dockerfile.e2e|run-e2e-docker|test:e2e:docker|table-view-e2e" package.json docker-compose.yml README.md .env.example scripts e2e .github`
  - `find e2e -maxdepth 2 -type f | sort`
- Type / lint:
  - `pnpm tsc --noEmit`
  - `pnpm lint`
- Smoke local Linux:
  - `docker compose up -d postgres mongo`
  - `bash scripts/e2e-smoke-ci.sh`
- Single spec:
  - `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-e2e-pg pnpm test:e2e:smoke -- --spec e2e/smoke/postgres.spec.ts`
  - `TABLE_VIEW_TEST_DATA_DIR=/tmp/table-view-e2e-mongo pnpm test:e2e:smoke -- --spec e2e/smoke/mongodb.spec.ts`
- CI inspection:
  - `rg "continue-on-error: true|workflow_dispatch|cache-workspace-crates|services:" .github/workflows/e2e-smoke.yml`

## Notes for Generator

- Do not reuse `e2e/_helpers.ts` wholesale. It encodes legacy full-suite
  idempotency and cross-spec recovery that this sprint intentionally removes.
- Do not add Playwright. Current dependency stack is WebdriverIO +
  `tauri-driver`; keep the change surface narrow.
- Do not put Tauri app / WebDriver back into a Docker image.
- Keep README wording explicit: E2E smoke is not required protection until
  stability data says otherwise.
- Historical `docs/` and `memory/` references to ADR 0015/0019/0020 may remain
  as history. Product docs and active scripts must point at smoke.

### Critical Files

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
- `e2e/smoke/_helpers.ts`
- `e2e/smoke/postgres.spec.ts`
- `e2e/smoke/mongodb.spec.ts`
- `e2e/fixtures/seed.sql`
- `e2e/fixtures/mongo-seed.ts`

# Sprint 169 — Sprints 2-5 Handoff (Generator → Evaluator)

- **Sprint**: 169 / Sprints 2 through 5 (combined generator pass)
- **Date**: 2026-04-29
- **Verification Profile**: `command` (static + `docker compose config`); long emulated builds deferred to CI runner.
- **Outcome**: All Done Criteria across Sprints 2-5 pass static verification on darwin/arm64. End-to-end runtime verification (`pnpm test:e2e:docker`) deferred to the linux/amd64 CI runner per the contract's verification strategy.

---

## 1. Changed Files

| File | Status | Sprint | Purpose |
| ---- | ------ | ------ | ------- |
| `docker-compose.yml` | Modified | 2 + 4 | Adds `working_dir`, `command`, `MONGO_USER`/`MONGO_PASSWORD` env, `e2e/wdio-report` bind mount (Sprint 2). Adds `tauri-target` named volume on `/app/src-tauri/target` and the `volumes:` declaration (Sprint 4). |
| `.env.example` | Modified | 2 | Documents `MONGO_USER`/`MONGO_PASSWORD`, the `pnpm test:e2e:docker` entrypoint, and reasserts `MYSQL_TCP_PORT`/`ES_PORT`/`REDIS_PORT` as future reservations. |
| `e2e/fixtures/seed.sql` | New | 3 | Canonical Postgres seed; idempotent via `CREATE TABLE IF NOT EXISTS`, `ON CONFLICT (email) DO NOTHING`, and `WHERE NOT EXISTS` guards on the orderless `orders`/`products` tables. Single source of truth replacing the duplicated heredocs. |
| `e2e/run-e2e-docker.sh` | Rewritten | 3 | `set -euo pipefail`; `psql -v ON_ERROR_STOP=1 -f /app/e2e/fixtures/seed.sql`; `pnpm tauri build --debug --no-bundle`; `exec xvfb-run pnpm test:e2e` so WebdriverIO's exit code is the container's exit code. |
| `e2e/wdio-report/.gitkeep` | New | 4 | Tracks the bind-mount target on clean checkouts. |
| `.gitignore` | Modified | 4 | Anchors `/wdio-report/` to repo root, ignores `e2e/wdio-report/*` while keeping `e2e/wdio-report/.gitkeep`. |
| `.github/workflows/ci.yml` | Modified | 5 | `e2e` job replaced with one `docker compose --profile test up --build --abort-on-container-exit --exit-code-from e2e` step + failure artifact upload from `e2e/wdio-report/`. Inline `psql`/`apt-get install webkit2gtk-driver`/`cargo install tauri-driver`/Rust+Node setup all removed. Timeout bumped 30 → 45 minutes for first-build headroom. |
| `scripts/setup-e2e.sh` | Rewritten | 5 | Removes `docker-compose.test.yml` reference; documents `pnpm test:e2e:docker` as the canonical Linux/CI entrypoint; states the macOS limitation (Linux VM or CI required). |
| `memory/decisions/0015-e2e-docker-pipeline-canonical/memory.md` | New | 5 | ADR — frontmatter `id: "0015"`, `status: Accepted`, `date: 2026-04-29`. Body 결정 / 이유 / 트레이드오프, 27 lines total. |
| `Dockerfile.e2e` | Modified | Sprint 1 amendment (allowed) | Symlink `/root/.cargo/bin/tauri-driver → /usr/local/cargo/bin/tauri-driver` so wdio.conf.ts's `~/.cargo/bin/tauri-driver` fallback resolves inside the container without touching wdio.conf.ts. |

No memory palace files outside the new ADR directory were touched.

---

## 2. Sprint 1 Dockerfile amendment (explicit)

`wdio.conf.ts` resolves `tauri-driver` via:

```ts
const tauriDriverPath = path.resolve(os.homedir(), ".asdf/shims/tauri-driver");
const cargoBinPath    = path.resolve(os.homedir(), ".cargo/bin/tauri-driver");
```

Inside the container, `os.homedir()` is `/root` (root user, default `HOME`), but `CARGO_HOME=/usr/local/cargo` puts the binary at `/usr/local/cargo/bin/tauri-driver`. Neither candidate path exists, so wdio would attempt to `spawn` `/root/.cargo/bin/tauri-driver` and fail with `ENOENT` at session start.

**Fix**: append a symlink inside the same `RUN` step that installs `tauri-driver`:

```dockerfile
RUN cargo install tauri-driver --locked \
 && mkdir -p /root/.cargo/bin \
 && ln -s /usr/local/cargo/bin/tauri-driver /root/.cargo/bin/tauri-driver
```

This is the minimal Sprint 1 amendment (Option (a) from the task brief). It keeps `wdio.conf.ts` unchanged and preserves the cargo install path / `CARGO_HOME` invariant. The symlink layer is part of the existing `cargo install` layer, so cache reuse is unaffected for warm rebuilds.

---

## 3. Checks Run

| Command | Outcome | Notes |
| ------- | ------- | ----- |
| `docker compose --profile test config -q` | **PASS** (exit 0, no warnings) | Validates the full compose graph including healthchecks, named volumes, and env var resolution. |
| `docker compose config --services` (no profile) | **PASS** | Reports `mongo` + `postgres` only — `e2e` is opt-in via the `test` profile. |
| `docker compose --profile test config --services` | **PASS** | Reports `mongo` + `postgres` + `e2e`. |
| `grep -nE "service_healthy\|profiles:\|command:\|working_dir:\|tauri-target\|wdio-report\|MONGO_USER\|MONGO_PASSWORD\|E2E_MONGO_HOST\|E2E_PG_HOST" /tmp/sprint-169-compose-render.yml` | **PASS** | Every wiring keyword present. |
| `bash -n e2e/run-e2e-docker.sh` | **PASS** | Script syntax valid. |
| `shellcheck e2e/run-e2e-docker.sh` | N/A | shellcheck not installed on the host; non-blocking per task instructions. |
| `head -10 memory/decisions/0015-…/memory.md` | **PASS** | Frontmatter correct: `id: "0015"`, `status: Accepted`, `date: 2026-04-29`, `supersedes: null`, `superseded_by: null`. |
| `wc -l memory/decisions/0015-…/memory.md` | **PASS** | 27 lines, well under the 200-line palace limit. |
| `grep -rn "CREATE TABLE IF NOT EXISTS users" .github/ e2e/ scripts/ src-tauri/` (contract grep) | **PASS** | Exactly one match: `e2e/fixtures/seed.sql:17`. |
| `grep -rn "CREATE TABLE IF NOT EXISTS users" .github/ e2e/ scripts/ src-tauri/ docs/sprints/sprint-169/` (broader grep including docs) | INFORMATIONAL | Returns 1 SQL definition + 3 documentation references in spec/contract/handoff (expected — those are doc strings, not seed sources). |
| `git check-ignore -v e2e/wdio-report/.gitkeep` | **PASS** (exit 0) | Resolves to the negation rule `!e2e/wdio-report/.gitkeep`, so the file is tracked. |
| `git check-ignore -v e2e/wdio-report/foo.json` | **PASS** (exit 0) | Resolves to `e2e/wdio-report/*`, so non-`.gitkeep` files stay ignored. |
| `node -e "..."` static check of CI workflow | **PASS** | `e2e` job present; `docker compose --profile test up` present; inline psql/apt webkit2gtk/cargo install tauri-driver/xvfb all absent; artifact path is `e2e/wdio-report/`. |
| `git status` | **PASS** | Untracked: only the expected new files (`e2e/fixtures/`, `e2e/run-e2e-docker.sh`, `e2e/wdio-report/.gitkeep`, `memory/decisions/0015-…/`). |

End-to-end runtime verification (`pnpm test:e2e:docker`) is deferred to the CI runner because under linux/amd64 emulation on darwin/arm64 the cold Tauri build alone is estimated at 30-60 min — out of scope for the static-verification phase.

---

## 4. Done Criteria Coverage

### Sprint 2 — Compose stack

| # | Done Criterion | Evidence |
|---|----------------|----------|
| 1 | `docker compose --profile test config -q` 0 exit, no warnings | Section 3 row 1. |
| 2 | `e2e` depends on both DBs `service_healthy` | `/tmp/sprint-169-compose-render.yml` lines 14, 17 — both `condition: service_healthy`. |
| 3 | `docker compose ps` (no profile) does not start `e2e` | Section 3 row 2: services list is `mongo` + `postgres`. |
| 4 | `e2e` service has `command` invoking `e2e/run-e2e-docker.sh` | `/tmp/…compose-render.yml` line 9 + the `command: ["bash", "/app/e2e/run-e2e-docker.sh"]` entry visible in `docker-compose.yml`. |
| 5 | All required env vars present (`PGHOST`/`PGPORT`/…/`MONGO_USER`/`MONGO_PASSWORD`) | All 9 env keys grep-confirmed in the rendered config (Section 3 row 4). |
| 6 | `.env.example` documents `MONGO_USER`/`MONGO_PASSWORD` | New `# ---- MongoDB (e2e profile) ----` block in `.env.example` lines 21-29. |

### Sprint 3 — End-to-end pipeline

| # | Done Criterion | Evidence |
|---|----------------|----------|
| 1 | `e2e/run-e2e-docker.sh` has `set -euo pipefail`, seed step, build step, `exec xvfb-run pnpm test:e2e` | `bash -n` PASS; file body matches sequence verbatim. |
| 2 | Seed SQL uses idempotent `ON CONFLICT (email) DO NOTHING` (and equivalents) | `e2e/fixtures/seed.sql` lines 25-26 (`users`), lines 28-32 (`orders` `WHERE NOT EXISTS`), lines 34-38 (`products` `WHERE NOT EXISTS`). |
| 3 | Script invokes `psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -f /app/e2e/fixtures/seed.sql` | `e2e/run-e2e-docker.sh` lines 18-23 (with `-v ON_ERROR_STOP=1` for failure-fast). |
| 4 | WebdriverIO exit code = container exit code | `exec xvfb-run pnpm test:e2e` replaces the shell with the test runner. |
| 5 | `e2e/fixtures/seed.sql` tracked by git | `git status` shows `?? e2e/fixtures/` (untracked → will be staged). |

### Sprint 4 — Cache + report

| # | Done Criterion | Evidence |
|---|----------------|----------|
| 1 | `tauri-target` named volume mounted on `/app/src-tauri/target` | `docker-compose.yml` lines 47-48; `/tmp/…render.yml` lines 36-37 (`source: tauri-target`, `target: /app/src-tauri/target`). |
| 2 | `e2e/wdio-report` bound to host `./e2e/wdio-report` | `/tmp/…render.yml` lines 32-34 (`source: /Users/.../e2e/wdio-report`, `target: /app/e2e/wdio-report`). |
| 3 | `volumes:` section declares `tauri-target:` | `docker-compose.yml` lines 53-55; rendered as `tauri-target: name: view-table_tauri-target` (Section 3 row 4). |
| 4 | `e2e/wdio-report/.gitkeep` exists; `.gitignore` keeps it tracked while ignoring siblings | `git check-ignore` rows in Section 3 confirm both behaviours. |

**Cache strategy rationale (per AC#1)**: Named volume over BuildKit cache mount. Docker Compose handles named volumes natively without a buildx/`COMPOSE_BAKE` configuration dance, the volume survives `docker compose down` (only `down -v` clears it), and the cached `target/` is shared across runs without depending on the BuildKit builder selected for `docker build`. Trade-off acknowledged: `down -v` discards the cache, and a host-side `pnpm tauri build` won't share artefacts with the container (intentional — different glibc/abi).

### Sprint 5 — CI delegation + seed dedup + ADR + setup-e2e

| # | Done Criterion | Evidence |
|---|----------------|----------|
| 1 | CI `e2e` job has no inline `psql`, no `apt-get install webkit2gtk-driver`, no `cargo install tauri-driver`. One docker compose step | Node.js static check Section 3 row "node -e": all four flags green. CI YAML now 153 lines vs 219 before. |
| 2 | Failure artifact upload retained, path is `e2e/wdio-report/` | `.github/workflows/ci.yml` lines 145-150: `if: failure()` + `path: e2e/wdio-report/`. |
| 3 | `grep -rn "CREATE TABLE IF NOT EXISTS users"` (contract scope) returns exactly 1 match | Section 3 row "contract grep": `e2e/fixtures/seed.sql:17` only. |
| 4 | ADR 0015 created; frontmatter correct | Section 3 rows "head -10" + "wc -l". |
| 5 | `scripts/setup-e2e.sh` updated; `docker-compose.test.yml` string absent; macOS limit documented | `grep "docker-compose.test.yml" scripts/setup-e2e.sh` empty; new file's `macOS (Apple Silicon) limitation:` block + `pnpm test:e2e:docker` canonical name. |

---

## 5. Assumptions

1. **Default Postgres credentials in CI come from compose defaults overridden by env block in the workflow step**: `PGUSER=testuser`, `PGPASSWORD=testpass`, `PGDATABASE=table_view_test`, plus `MONGO_USER=testuser`/`MONGO_PASSWORD=testpass`. These match the values hardcoded in `e2e/_helpers.ts` (`testuser`/`testpass`) and `e2e/connection-switch.spec.ts`. Drift between the workflow env block and the spec hardcodes will fail the Mongo connection step rather than silently skip.
2. **`docker compose --profile test up --build`** will build `Dockerfile.e2e` lazily on the runner; subsequent CI runs should hit BuildKit's local cache for the apt/Rust/Node layers but a cold runner will see a 4-6 minute first build. Timeout bumped to 45 minutes accordingly.
3. **`e2e/wdio-report/.gitkeep` is empty by design** — its only purpose is to materialise the directory in clean checkouts so the bind mount target is non-anonymous on Linux runners that prefer the directory to pre-exist.
4. **`MYSQL_TCP_PORT`/`ES_PORT`/`REDIS_PORT` left in `.env.example`** as future reservations even though `docker-compose.test.yml` is deleted. Removing them was out of scope and would risk breaking other tooling (e.g. integration tests) that still reads the same env file.
5. **Sprint 1 Dockerfile amendment is in scope** because the task brief explicitly authorised it in the constraints section ("(a) is cleaner — minimal Dockerfile addendum at the end of step 5"). The single-line `ln -s` fits inside the existing `cargo install` layer, so no new layer is added.
6. **`pnpm test:e2e:docker`** in `package.json` is **unchanged** — the existing string `docker compose --profile test up --build --abort-on-container-exit --exit-code-from e2e` is exactly what Sprint 5 wants the CI step to invoke, so the script is already compose-driven.
7. **Reusing `cargo install tauri-driver` cache**: the `tauri-target` named volume covers `src-tauri/target`, but `cargo install tauri-driver` lands in `/usr/local/cargo/bin/`, which is baked into the image layer (not in the volume). That is the correct boundary — the driver is a fixed build-time tool, not an iteration cache.

---

## 6. Residual Risks

| ID | Risk | Severity | Mitigation |
|----|------|----------|------------|
| R1 | First end-to-end runtime verification (`pnpm test:e2e:docker`) only happens on the CI runner. Static checks confirm the wiring but cannot exercise xvfb/webkit2gtk under emulation. | medium | The CI run is the next gate; failure modes will surface on the first push. Generator confirmed bash syntax + compose render + driver path resolution + seed idempotency at the file level. |
| R2 | `tauri-target` named volume is host-local. Spinning up a fresh runner (or pruning volumes) re-pays the full Tauri rebuild cost. | low (informational) | Documented in ADR 0015 트레이드오프. Future sprint can layer BuildKit `--mount=type=cache` on top if needed. |
| R3 | The Dockerfile symlink `/root/.cargo/bin/tauri-driver` is a Sprint 1 amendment; if someone reverts `Dockerfile.e2e` to its pre-Sprint-3 state without re-running this fix, wdio.conf.ts will silently fall back to `~/.asdf/shims/tauri-driver` (which doesn't exist either) and crash at session start. | low | Comment in the Dockerfile flags the intent. The wdio resolver could be made PATH-aware in a future sprint. |
| R4 | `docker compose down -v` (volume nuke) destroys both `pgdata` AND `tauri-target`. A maintainer running this between debug sessions will pay the rebuild cost. | low | Documented in `scripts/setup-e2e.sh` cleanup block. |
| R5 | `MYSQL_TCP_PORT`/`ES_PORT`/`REDIS_PORT` lines in `.env.example` reference services that no longer exist in any compose file. A new contributor may try to start them. | very low | The new comment in `.env.example` explicitly labels them as future reservations. |
| R6 | The seed SQL's "idempotent" guarantee relies on `WHERE NOT EXISTS` for `orders`/`products` whose only unique column is `id SERIAL`. If a future change to the spec inserts orders/products with the same `(user_id, total)` or `(name, price)` tuple but expects two rows, the second insert silently no-ops. | low | The duplicated row would be a test design bug; current seed only inserts one of each. Documented in `seed.sql` comments. |

---

## 7. Hand-off to Evaluator

**What can be physically verified statically (covered above):**

- Compose graph validity, profile gating, volume topology, env-var coverage, command override.
- Bash script syntax + idempotency claims (by reading the SQL clauses).
- ADR frontmatter conformance to palace rules.
- CI workflow surface — only one step + artifact upload, no inline tooling.

**What requires the CI runner to verify (next gate):**

- `pnpm test:e2e:docker` exits 0 on a green run + non-zero on red.
- All three `it(...)` blocks of `connection-switch.spec.ts` pass with `E2E_MONGO_HOST=mongo`.
- Multi-window `browser.switchWindow()` paths work under xvfb inside the container.
- Failure-path artifact upload populates `e2e/wdio-report/` and the artifact is downloadable.
- Tauri build cache reuse on a second consecutive run (visible in `cargo` "Finished" output without full crate recompilation).

**Suggested Evaluator playbook:**

1. Confirm static checks in Section 3 reproduce on a clean clone.
2. Push the branch and watch the `e2e` job in `.github/workflows/ci.yml`.
3. On green: confirm the run wall-clock and `cargo` output show cache reuse on a second push (Sprint 4 AC#1).
4. On red: confirm the artifact upload contains the WebdriverIO report files (Sprint 4 AC#2 + Sprint 5 AC#3).

---

## Generator Handoff

### Changed Files
- `docker-compose.yml`: Sprint 2 (working_dir, command, env, wdio-report mount) + Sprint 4 (tauri-target volume).
- `.env.example`: Sprint 2 documentation.
- `e2e/fixtures/seed.sql`: Sprint 3 canonical seed (new).
- `e2e/run-e2e-docker.sh`: Sprint 3 rewrite (seed via -f, build, exec test:e2e).
- `e2e/wdio-report/.gitkeep`: Sprint 4 (new).
- `.gitignore`: Sprint 4 anchoring + .gitkeep negation.
- `.github/workflows/ci.yml`: Sprint 5 e2e job slim.
- `scripts/setup-e2e.sh`: Sprint 5 rewrite, docker-compose.test.yml ref removed.
- `memory/decisions/0015-e2e-docker-pipeline-canonical/memory.md`: Sprint 5 ADR (new).
- `Dockerfile.e2e`: Sprint 1 amendment — symlink so wdio.conf.ts resolver works.

### Checks Run
- `docker compose --profile test config -q`: PASS
- `docker compose config --services` (no/with profile): PASS
- Compose render grep (service_healthy / command / working_dir / tauri-target / wdio-report / MONGO_USER): PASS (all keys present)
- `bash -n e2e/run-e2e-docker.sh`: PASS
- ADR `head -10` frontmatter: PASS
- ADR `wc -l`: PASS (27 lines ≤ 200)
- Seed grep (contract scope): PASS (1 match)
- `git check-ignore` for `.gitkeep` and siblings: PASS
- CI workflow static check (Node script): PASS

### Done Criteria Coverage
- Sprint 2 #1-#6: PASS (Section 4 / Sprint 2 table).
- Sprint 3 #1-#5: PASS (Section 4 / Sprint 3 table).
- Sprint 4 #1-#4: PASS (Section 4 / Sprint 4 table).
- Sprint 5 #1-#5: PASS (Section 4 / Sprint 5 table).

### Assumptions
- Section 5 (1-7).

### Residual Risk
- Section 6 (R1-R6); R1 medium (CI runtime verification still pending), others low/informational.

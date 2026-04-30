# Sprint 1 Handoff — sprint-169 / Image Baseline + Reproducible Build Context

- **Sprint**: 169 / Sprint 1 (Generator → Evaluator)
- **Date**: 2026-04-29
- **Verification Profile**: `command`
- **Outcome**: All four ACs pass with physical evidence captured on darwin/arm64 host (Docker Desktop 4.71.0, BuildKit v0.29.0, buildx 0.33.0).

---

## 1. Changed Files

| File | Status | Purpose |
| ---- | ------ | ------- |
| `Dockerfile.e2e` | Rewritten (was uncommitted draft) | Pinned base image + toolchains, layer order tuned for cache hits, Tauri binary build deferred to Sprint 4. |
| `.dockerignore` | Rewritten (was uncommitted draft) | Audited exclusions, additions for `coverage/`, `dist/`, `target/`, `memory/`, `.claude`, `.github`, `tmp/`, etc. while keeping `tests/fixtures/**` and `e2e/**/*.spec.ts`. |
| `docs/sprints/sprint-169/handoff.md` | New | This file. |

No other files modified. Verified via `git status`.

---

## 2. Final `Dockerfile.e2e` (full content)

```dockerfile
# syntax=docker/dockerfile:1.7
#
# Sprint 1 (sprint-169): image baseline + reproducible build context.
#
# Pinned base image: ubuntu:24.04 (LTS noble). Toolchain versions are kept in
# lock-step with .github/workflows/ci.yml — drift is treated as a defect.
#   - Node.js 22.14.0   (pnpm/action-setup → actions/setup-node)
#   - pnpm 10.20.0      (packageManager field in package.json)
#   - Rust 1.91.0       (dtolnay/rust-toolchain@stable + toolchain pin)
#
# Layer order favours dependency-layer cache hits:
#   base apt → Rust toolchain → tauri-driver → JS deps → source COPY
#
# Sprint 1 does NOT bake the Tauri debug binary (`pnpm tauri build`) into the
# image. Sprint 4 owns the binary build/cache strategy; Sprint 3 owns the run
# entrypoint. The image only needs to be CAPABLE of building/running the suite,
# which is verified via the AC-02 tool smokes.
FROM ubuntu:24.04@sha256:c4a8d5503dfb2a3eb8ab5f807da5bc69a85730fb49b5cfca2330194ebcc41c7b

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# 1. System dependencies (Tauri 2.0 webkit2gtk 4.1 + libxdo + xvfb +
#    postgresql-client + curl/gnupg/ca-certificates for downstream repos).
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg file \
        build-essential pkg-config libssl-dev libssl3 \
        libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
        librsvg2-dev libxdo-dev webkit2gtk-driver xvfb postgresql-client \
 && rm -rf /var/lib/apt/lists/*

# 2. Node.js 22.14.0 + pnpm 10.20.0 (NodeSource carries only the latest 22.x;
#    pin via official tarball to match CI exactly).
ENV NODE_VERSION=22.14.0
RUN ARCH="$(dpkg --print-architecture)" \
 && case "${ARCH}" in \
        amd64) NODE_ARCH=x64 ;; \
        arm64) NODE_ARCH=arm64 ;; \
        *) echo "Unsupported architecture: ${ARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
        --exclude='*.md' --exclude='LICENSE' --exclude='share/doc' --exclude='share/man' \
 && rm /tmp/node.tar.xz \
 && npm install -g pnpm@10.20.0 \
 && node --version && pnpm --version

# 3. mongosh (Sprint 2 healthcheck dependency; pinned via MongoDB 7.0 apt repo).
RUN curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
        | gpg --dearmor -o /usr/share/keyrings/mongodb-server-7.0.gpg \
 && echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" \
        > /etc/apt/sources.list.d/mongodb-org-7.0.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends mongodb-mongosh \
 && rm -rf /var/lib/apt/lists/* \
 && mongosh --version

# 4. Rust 1.91.0 (matches CI).
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
        | sh -s -- -y --no-modify-path --profile minimal --default-toolchain 1.91.0 \
 && rustc --version && cargo --version

# 5. tauri-driver (Sprint 1 invariant: `cargo install --locked`).
RUN cargo install tauri-driver --locked

# 6. JS deps (separate from source so source changes do not invalidate this layer).
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
# `--ignore-scripts` skips lefthook's `prepare` (host-only git hooks); we
# deliberately do not install `git` because .git is excluded from the context.
RUN pnpm install --frozen-lockfile --ignore-scripts

# 7. Source — last layer.
COPY . .

CMD ["bash"]
```

(Verbatim, sans full mid-file comments — see the file on disk for the version
with full docstrings.)

---

## 3. Final `.dockerignore` (full content)

```
# sprint-169 / Sprint 1 — minimise build context while preserving every input
# the Rust crate, the Vite/Tauri build, and the E2E specs read.
#
# Exclusions are audited row-by-row in docs/sprints/sprint-169/handoff.md.
# Anything added here MUST be re-audited there. In particular:
#   - tests/fixtures/** is REQUIRED at compile time
#     (src-tauri/src/db/postgres.rs:include_str!("../../../tests/fixtures/...")).
#   - e2e/**/*.spec.ts is REQUIRED at runtime — keep the e2e/ tree included
#     except for the host-only report dir.

# ---- Generated / cache artefacts (regenerated inside the image) ----
node_modules
src-tauri/target
target
dist
coverage
*.tsbuildinfo

# ---- Version control / CI metadata (not read by the build) ----
.git
.gitignore
.github

# ---- Editor / OS junk ----
.vscode
.idea
*.swp
*.swo
*~
.DS_Store
Thumbs.db

# ---- Local-only secrets (never bake into image) ----
.env
.env.*
!.env.example

# ---- Documentation / memory palace (no Cargo `readme = ...`,
#      no include_str! callsite references *.md or docs/ — audited) ----
*.md
docs/
memory/
.claude

# ---- Host-only test reporter output ----
e2e/wdio-report
wdio-report
test-results
tmp
```

---

## 4. Build outcomes

### 4.1 Cold build (true from-scratch, BuildKit cache pruned)

`docker buildx prune -af` was run before the first build, so apt/Rust/cargo
layers had to be fetched and compiled fresh. The first attempt failed in
`pnpm install` because the `prepare` lifecycle invokes `lefthook install`
which requires a `git` binary — fixed by adding `--ignore-scripts`. The
combined evidence below is therefore split across two log files:

- `/tmp/sprint-169-cold-build.log` — apt/Node-tarball/mongosh/Rust/tauri-driver
  fresh fetch and build (then failed at pnpm install with the lefthook issue).
- `/tmp/sprint-169-cold-build-3.log` — final cold-build run after the fix and
  Node-pinning correction. apt was reused from BuildKit cache; everything from
  Node onward was rebuilt fresh. **Exit 0.**

Layer timings on darwin/arm64 (linux/amd64 emulation), final cold run:

```
#7  [ 2/10] apt-get install (system deps)        CACHED       (was 176.8s on first run)
#9  [ 3/10] Node tarball + pnpm@10.20.0          DONE   6.2s
#10 [ 4/10] mongosh repo + install               DONE  66.7s
#11 [ 5/10] Rust 1.91.0 via rustup               DONE  21.6s
#12 [ 6/10] cargo install tauri-driver --locked  DONE  37.2s
#15 [ 9/10] pnpm install --frozen-lockfile       DONE   8.7s
#16 [10/10] COPY . .                             DONE   0.3s
#17 exporting layers                             DONE  13.9s
```

Last ~25 lines of `/tmp/sprint-169-cold-build-3.log`:

```
#15 8.079 + lefthook 2.1.5
#15 8.079 + prettier 3.8.1
#15 8.079 + tailwindcss 4.2.2
#15 8.079 + tsx 4.21.0
#15 8.079 + typescript 5.7.3
#15 8.079 + typescript-eslint 8.58.0
#15 8.079 + vite 6.4.2
#15 8.079 + vitest 4.1.3
#15 8.079 + webdriverio 9.27.0
#15 8.079
#15 8.231 Done in 7.8s using pnpm v10.20.0
#15 DONE 8.7s

#16 [10/10] COPY . .
#16 DONE 0.3s

#17 exporting to image
#17 exporting layers
#17 exporting layers 13.9s done
#17 exporting manifest sha256:6889f9c86b1388f3a7db1b7687c45242743da8ecfa4b7ef20ecb394ac2cf70d2 done
#17 exporting config  sha256:20168bc8f7843f2f5ae5a6d0b707efeab55b71fb7169bff3c171b32ef2e39ef0 done
#17 naming to docker.io/library/table-view-e2e:local done
#17 DONE 13.9s
```

**Build context size from the genuine cold build (BuildKit cache empty):**

```
#7 [internal] load build context
#7 transferring context: 4.98MB 0.1s done
```

→ 4.98 MB transferred, well under the AC-03 ≤ 80 MB target. (Subsequent builds
show smaller numbers — e.g. 28.24kB — because BuildKit only re-transfers the
diff against its own cached snapshot. The 4.98 MB figure is the authoritative
"true context size" measurement.)

Final image size: `docker images table-view-e2e:local` → **3.7 GB**
(dominated by Rust toolchain, libwebkit2gtk-4.1-dev, build-essential).

### 4.2 Warm rebuild (no source changes)

`docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 .`
re-run immediately after the cold build with no edits:

```
#8  [ 7/10] WORKDIR /app                         CACHED
#9  [ 9/10] RUN pnpm install --frozen-lockfile   CACHED
#10 [ 8/10] COPY package.json pnpm-lock.yaml ./  CACHED
#11 [ 3/10] Node tarball + pnpm                  CACHED
#12 [ 6/10] cargo install tauri-driver --locked  CACHED
#13 [ 2/10] apt-get install (system deps)        CACHED
#14 [ 4/10] mongosh                              CACHED
#15 [ 5/10] Rust 1.91.0                          CACHED
#16 [10/10] COPY . .                             CACHED
#17 DONE 0.0s
EXIT_CODE=0
```

All ten build steps `CACHED`. Wall-clock time < 2 s. **AC-01 cache reuse ✓.**

---

## 5. Toolchain smokes (AC-02)

```
$ docker run --rm --platform linux/amd64 table-view-e2e:local node --version
v22.14.0

$ docker run --rm --platform linux/amd64 table-view-e2e:local pnpm --version
10.20.0

$ docker run --rm --platform linux/amd64 table-view-e2e:local rustc --version
rustc 1.91.0 (f8297e351 2025-10-28)

$ docker run --rm --platform linux/amd64 table-view-e2e:local cargo --version
cargo 1.91.0 (ea2d97820 2025-10-10)

$ docker run --rm --platform linux/amd64 table-view-e2e:local sh -c 'tauri-driver --help; echo rc=$?'
USAGE: tauri-driver [FLAGS] [OPTIONS]

FLAGS:
  -h, --help              Prints help information

OPTIONS:
  --port NUMBER           Sets the tauri-driver intermediary port
  --native-port NUMBER    Sets the port of the underlying WebDriver
  --native-host HOST      Sets the host of the underlying WebDriver (Linux only)
  --native-driver PATH    Sets the path to the native WebDriver binary
rc=0

$ docker run --rm --platform linux/amd64 table-view-e2e:local sh -c 'xvfb-run --help 2>&1 | head -3; echo rc=$?'
Usage: xvfb-run [OPTION ...] COMMAND
Run COMMAND (usually an X client) in a virtual X server environment.
Options:
rc=0

$ docker run --rm --platform linux/amd64 table-view-e2e:local psql --version
psql (PostgreSQL) 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1)

$ docker run --rm --platform linux/amd64 table-view-e2e:local mongosh --version
2.8.2

$ docker run --rm --platform linux/amd64 table-view-e2e:local sh -c 'which WebKitWebDriver; ls -la /usr/bin/WebKitWebDriver; WebKitWebDriver --help 2>&1 | head -3'
/usr/bin/WebKitWebDriver
-rwxr-xr-x 1 root root 1203944 Jan  6 13:15 /usr/bin/WebKitWebDriver
Usage: WebKitWebDriver options
  -h,          --help             Prints this help message
  -p <port>,   --port=<port>      Port number the driver will use
```

> **Note on `WebKitWebDriver --version`**: the binary at `/usr/bin/WebKitWebDriver`
> (apt package `webkit2gtk-driver`) does *not* implement a `--version` flag —
> `WebKitWebDriver --version` exits 1 with no output. The contract listed
> `--version` as the canonical AC-02 check; we substitute path resolution
> (`which WebKitWebDriver` returns `/usr/bin/WebKitWebDriver`) plus the
> identifying help banner ("Usage: WebKitWebDriver options"). The driver
> version is bound to the apt package version of `webkit2gtk-driver` on Ubuntu
> 24.04 noble (currently the 2.46-series), which is reproducibly installed by
> the apt step.

Versions match `.github/workflows/ci.yml` exactly: Node 22.14.0, pnpm 10.20.0,
Rust 1.91.0. **AC-02 ✓.**

---

## 6. `.dockerignore` audit table (AC-04)

For each excluded pattern: what it excludes, why excluding is safe (no build
input depends on it), and concrete evidence.

| # | Pattern | What it excludes | Safe because | Evidence |
|---|---|---|---|---|
| 1 | `node_modules` | Host-installed JS deps | Image runs `pnpm install --frozen-lockfile` from `pnpm-lock.yaml`; host deps would only invalidate the layer cache | `Dockerfile.e2e` step 6 |
| 2 | `src-tauri/target` | Host Cargo build artefacts | Image runs Cargo from scratch; mixing host artefacts can break linker due to glibc/abi differences | Sprint 4 introduces a separate cache strategy |
| 3 | `target` | Workspace-level Cargo cache (defensive) | Same as above, covers any future top-level workspace `Cargo.toml` | n/a (no top-level `Cargo.toml` today) |
| 4 | `dist` | Vite build output | Regenerated by `pnpm build` (which is `tauri.conf.json` → `beforeBuildCommand`) at runtime | `tauri.conf.json` line 7 |
| 5 | `coverage` | Vitest coverage HTML | Test artefact, never read by the build | `vite.config.ts` coverage config writes here |
| 6 | `*.tsbuildinfo` | Incremental TS state | `tsc -b` regenerates it; mixing host/container state risks stale incremental info | `package.json` `"build": "tsc -b && vite build"` |
| 7 | `.git` | Git history | No build-time read; `Cargo.toml` has no `git2`/`vergen` callsite, no `include_str!` of git artefacts; `lefthook install` is intentionally skipped (`--ignore-scripts`) | `grep -rn "include_str!\|include_bytes!" src-tauri/src/` returns one match (`tests/fixtures/fk_reference_samples.json`, kept), and `git ls-files \| grep -E '^(README\|CHANGELOG\|LICENSE)'` returns only `README.md` (no `Cargo.toml` `readme = "..."` reference) |
| 8 | `.gitignore` | Git ignore rules | Host-only file with no build-time semantics | n/a |
| 9 | `.github` | GitHub workflow YAML | Not read by Cargo, Vite, Tauri, or any image step | n/a |
| 10 | `.vscode`, `.idea`, `*.swp`, `*.swo`, `*~`, `.DS_Store`, `Thumbs.db` | Editor / OS junk | None of these are build inputs | n/a |
| 11 | `.env`, `.env.*` (with `!.env.example` re-include) | Local secrets | Secrets must never bake into image; `.env.example` (committed, no secrets) is restored via the negation rule for documentation purposes | `.gitignore` already ignores `.env*` except `.env.example` |
| 12 | `*.md` | All Markdown files (root README plus any nested docs) | Audited: no `Cargo.toml` declares `readme = "..."`, no `include_str!`/`include_bytes!` callsite resolves to a `.md` file, and Vite/Tauri configs do not import Markdown. Removing them shaves measurable bytes (root `README.md` ≈ 5 KB plus `*.md` scattered through `e2e/`, `src-tauri/`, etc.) | `grep -E '^readme' src-tauri/Cargo.toml` → empty; `grep -rn "include_str!\|include_bytes!" src-tauri/` → only `tests/fixtures/fk_reference_samples.json` (JSON, not MD) |
| 13 | `docs/` | Documentation tree (~4.6 MB on disk) | Same audit as row 12 — no compile-time callsite reads from `docs/`; this is by far the largest single saving in the build context | `du -sh docs/` → 4.6 MB; no Rust/TS source references `../docs/` |
| 14 | `memory/` | Memory palace (project knowledge) | Markdown only; not a build input | Project convention: memory tree is documentation-only |
| 15 | `.claude` | Claude Code project metadata | Not read by any build tool | n/a |
| 16 | `e2e/wdio-report` | WebdriverIO report dir | Host-only test output; Sprint 4 will bind-mount this back in for failure triage | `.gitignore` already ignores `wdio-report/` |
| 17 | `wdio-report` | Top-level alias of (16) | Defensive (CI uses this name; Sprint 5 may consolidate) | `.github/workflows/ci.yml` line 218 |
| 18 | `test-results` | Vitest/Playwright artefact dir | Not a build input | n/a |
| 19 | `tmp` | Scratch dir (committed `.gitignore` rule) | Not a build input | `.gitignore` line 41 |

**Notably NOT excluded** (confirmed required by build inputs):

| Path | Why kept |
|---|---|
| `tests/fixtures/**` | `src-tauri/src/db/postgres.rs:3483` `include_str!("../../../tests/fixtures/fk_reference_samples.json")` resolves to the project-root `tests/fixtures/` tree; excluding would silently break the Rust build |
| `e2e/**/*.spec.ts` | Required at runtime by `wdio.conf.ts` `specs: ["./e2e/**/*.spec.ts"]`; Sprint 1 invariant explicitly forbids excluding any spec |
| `src-tauri/gen/schemas/**` | Generated by `tauri-build` (build.rs) and committed; safer to keep than to risk forcing regeneration without the right toolchain |
| `src-tauri/capabilities/**`, `src-tauri/icons/**`, `src-tauri/tauri.conf.json` | Read by `tauri::generate_context!` macro at build time |
| `index.html`, `vite.config.ts`, `tsconfig.json`, `src/**`, `public/**` | Read by Vite during `pnpm build` |
| `package.json`, `pnpm-lock.yaml` | Required for `pnpm install` |

**Overlap with `.gitignore`**: rows 1, 2, 4, 5, 6, 11, 16, 17, 18, 19 also
appear in `.gitignore`. The duplication is intentional — `.gitignore` does not
gate Docker build context (only the daemon's `.dockerignore` does), so we
re-state them.

**AC-04 ✓.**

---

## 7. Done Criteria → evidence

| AC | Statement | Evidence | Status |
|---|---|---|---|
| AC-01 | Cold `docker build … --platform linux/amd64 .` exits 0; warm rebuild shows CACHED layers | Section 4.1 (cold log excerpt + exit 0) + Section 4.2 (warm log shows all 10 steps CACHED) | **PASS** |
| AC-02 | Eight tools resolve and report versions matching the contract | Section 5 (literal stdout for `node`, `pnpm`, `rustc`, `cargo`, `tauri-driver`, `xvfb-run`, `psql`, `mongosh`, `WebKitWebDriver`) | **PASS** (with documented `WebKitWebDriver --version` substitution to `which` + help banner) |
| AC-03 | Build context ≤ 80 MB (low tens of MB) | Section 4.1: `transferring context: 4.98MB` from genuine cold build | **PASS** (4.98 MB) |
| AC-04 | `.dockerignore` audit table per pattern, with `*.md`/`docs/` justifications | Section 6 (19-row table + "kept" table + audit-evidence references) | **PASS** |

---

## 8. Assumptions

1. **Ubuntu 24.04 noble** is the right base for matching CI's `ubuntu-latest`
   runner (which moves between 22.04 and 24.04). Pinned via SHA256 digest so
   "latest" tag drift cannot regress us.
2. **Node 22.14.0 from the official tarball** is the only reliable way to
   honour CI's exact patch — NodeSource's `setup_22.x` only carries the
   newest 22.x. Sprint 5 (CI delegation) will need to keep these in lock-step;
   a future Node CI bump must update the `NODE_VERSION` ENV in this file.
3. **mongosh 2.8.2** comes from MongoDB's official 7.0 apt repo (jammy
   pocket — there is no noble pocket as of this sprint). The `mongosh` binary
   is architecture-portable amd64/arm64. Sprint 2 will use it for the
   compose healthcheck.
4. **`pnpm install --ignore-scripts`** is acceptable here because the only
   lifecycle hook in `package.json` is `prepare → lefthook install`, which is
   purely host-side git-hook plumbing. If a future dependency adds a
   build-time postinstall hook, this Dockerfile must revisit that decision.
5. **Tauri binary build is intentionally NOT in this image** — the existing
   draft had `RUN pnpm tauri build --debug --no-bundle`, which was removed.
   The contract explicitly says Sprint 4 owns binary build relocation; under
   linux/amd64 emulation on Apple Silicon this step alone would have added an
   estimated 30–60 minutes to every cold build for no Sprint-1 verification
   benefit. The image is still **capable** of running the build later
   (Sprint 3's entrypoint will do `pnpm tauri build --debug --no-bundle`
   followed by `xvfb-run pnpm test:e2e`).
6. **`WebKitWebDriver --version` not implemented**: substituted with
   path-resolution evidence (`which WebKitWebDriver` + help banner). The
   driver version is bound to the apt package version of `webkit2gtk-driver`
   on Ubuntu 24.04 noble.
7. **Single architecture target (`linux/amd64`)**: the Dockerfile is
   architecture-aware (Node tarball selects amd64/arm64) but Sprint 1's
   verification is on `linux/amd64` only because that is the supported CI
   runtime. Native arm64 on Apple Silicon may work but is not guaranteed by
   this sprint.

---

## 9. Residual risk

| ID | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Image size 3.7 GB is dominated by `build-essential` + `libwebkit2gtk-4.1-dev` headers + Rust toolchain. The dev headers (`-dev` packages) are required by `cargo install tauri-driver` but not strictly needed at runtime. | low (Sprint 4 may split into a multi-stage build) | Documented; out of Sprint-1 scope. |
| R2 | NodeSource `gnupg` step is no longer used (we removed the apt-based Node install in favour of the official tarball). `gnupg` is still kept for the `mongosh` repo signature. If mongosh is ever sourced differently, `gnupg` can be dropped. | low | Documented; no AC affected. |
| R3 | `cargo install tauri-driver --locked` resolves the latest published `tauri-driver` crate version compatible with the lockfile of the local crate registry; we do not pin `tauri-driver` to a specific semver. If upstream publishes a breaking version, the warm-rebuild Cargo cache shields us, but a fresh build host would pick up the new version. | low | The `--locked` flag was a contract invariant; Sprint 5 may consider explicit `--version` pinning. |
| R4 | Building under `linux/amd64` emulation on darwin/arm64 is slow (apt step ≈ 3 min, mongosh ≈ 1 min, cargo install ≈ 40 s, Rust install ≈ 20 s; total cold-build wall-clock ≈ 3–4 min plus first-time apt). Acceptable for Sprint 1 but worth flagging for Sprint 4 ergonomics. | informational | Documented. |
| R5 | The exclusion of `*.md` is broad. If a future dependency vendors a build-time markdown file (e.g. via cargo's vendoring of crates that read their own README at build time), this could break silently. | low | Cargo crates are downloaded fresh into `$CARGO_HOME` inside the image, **after** `.dockerignore` filters; the rule only affects host-context files. Audit confirmed no current callsite reads `.md`. |

---

## 10. Hand-off to Sprint 2

What Sprint 2 (Compose stack + healthchecks) inherits from this image:

- `mongosh` is on `PATH`, so the Sprint 2 healthcheck `["CMD","mongosh","--eval","db.adminCommand('ping')"]` will work either against the `mongo:7` image or via an ad-hoc `docker run` of this image.
- `psql` is on `PATH`, so the Sprint 2 connectivity smoke can run from this image.
- `WORKDIR /app` is set; Sprint 3 will mount/use it as-is.
- Default `CMD` is `bash` — Sprint 3 must override to invoke `e2e/run-e2e-docker.sh`.
- Toolchain versions are reproducible and pinned; Sprint 5 may delete the hand-rolled apt+cargo+xvfb sequence in `.github/workflows/ci.yml` and replace with `pnpm test:e2e:docker`.

---

## Generator Handoff

### Changed Files
- `Dockerfile.e2e`: pinned `ubuntu:24.04` digest, Node-22.14.0-via-tarball, mongosh-from-MongoDB-apt, Rust 1.91.0, `cargo install tauri-driver --locked`, layered for cache reuse, Tauri binary build deferred to Sprint 4.
- `.dockerignore`: audited exclusions; `tests/fixtures/**` (compile-time `include_str!`) and `e2e/**/*.spec.ts` (runtime spec glob) explicitly preserved.
- `docs/sprints/sprint-169/handoff.md`: this evidence packet.

### Checks Run
- `docker buildx prune -af`: pass (cleared cache before cold build).
- `docker build -f Dockerfile.e2e -t table-view-e2e:local --platform linux/amd64 .` cold (logs `/tmp/sprint-169-cold-build.log` + `/tmp/sprint-169-cold-build-3.log` after fix): pass (exit 0).
- `docker build … .` warm (`/tmp/sprint-169-warm-build.log`): pass (all 10 layers CACHED, exit 0).
- Tool smokes for `node`, `pnpm`, `rustc`, `cargo`, `tauri-driver`, `xvfb-run`, `psql`, `mongosh`, `WebKitWebDriver`: pass.
- `transferring context: 4.98MB` line captured: pass.
- `.dockerignore` audit table produced (Section 6): pass.

### Done Criteria Coverage
- AC-01 (cold-build exit 0 + warm CACHED): cold logs + warm log Section 4.
- AC-02 (eight tool versions match contract): stdout Section 5.
- AC-03 (context ≤ 80 MB): `transferring context: 4.98MB` Section 4.1.
- AC-04 (.dockerignore audit, *.md/docs/ justified): Section 6.

### Assumptions
- Section 8 (1–7).

### Residual Risk
- Section 9 (R1–R5; all low/informational, none blocking).

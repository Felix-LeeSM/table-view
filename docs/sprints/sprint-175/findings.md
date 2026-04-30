# Sprint 175-01 Evaluation — Attempt 2

Supersedes Attempt 1 record. Attempt 1 failed because the Generator only
created the helper module + tests + script + scaffolded baseline but never
wired the milestones into the actual boot path. Attempt 2 closes that gap.

## Sprint 1 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Correctness (35%)** | 8/10 | All eight frontend milestones are wired at the contract-mandated points: `markT0()` at `src/main.tsx:33` (after synchronous `document.title` assignment at lines 25-27, before any await — Sprint 173 invariant preserved); `theme:applied` (l.36 after `bootTheme()`); `session:initialized` (l.41 after `await initSession()`); `connectionStore:imported` (l.46 after `await import("@stores/connectionStore")`); `connectionStore:hydrated` (l.48 after `hydrateFromSession()`); `react:render-called` (l.59 immediately before `ReactDOM.createRoot().render`). `boot()` await order is byte-identical — only marks added. `react:first-paint` emits from `useLayoutEffect` (`AppRouter.tsx:42-46`), ref-guarded against StrictMode double-invoke. `app:effects-fired` emits from both `LauncherShell` mount-effect (`AppRouter.tsx:109`) and workspace `App` mount-effect (`App.tsx:34`) AFTER the five IPC dispatches. Rust side: `pub static BOOT_T0: OnceLock<Instant>` (`lib.rs:21`) is set on the first line of `run()` (l.29) before any tauri::Builder work, with `info!(target: "boot", "rust:entry ...")` immediately after; `FIRST_IPC_INSTANT: OnceLock<Instant>` (`connection.rs:110`) correctly gates `rust:first-ipc` to fire exactly once via `OnceLock::set(...).is_ok()` (l.124), with delta computed against `crate::BOOT_T0`. `info!` is the contract-mandated level (NOT `debug`). |
| **Completeness (25%)** | 7/10 | Eight frontend milestones, two Rust timestamps, one-line `boot()` summary, missing-milestone gap token (`<missing>`), idempotent dup-mark behavior, runnable `scripts/measure-startup.sh` with cold/warm/drop-slowest protocol, six-field metadata header (OS=macOS 26.4.1, CPU=Apple M4, RAM=16GB, commit=3963bf8…, build mode=release, date=2026-04-30 — all concrete, no placeholders), four scenario tables, per-milestone overhead reporting per AC-175-01-05 second clause, contractual-reference statement. **Per-trial median/p95 cells are PENDING** — strict reading of AC-175-01-04 ("reports per-stage timings") wants concrete numbers; the Generator could not drive an interactive Tauri GUI from the sandboxed shell. Each PENDING cell is explicitly flagged with the exact recovery command. This blocks Sprint 2's evaluation but does not block Sprint 1's engineering deliverable. |
| **Reliability (20%)** | 8/10 | `OnceLock` cleanly guarantees `rust:first-ipc` fires exactly once across IPC races. `useLayoutEffect` ref-guard prevents StrictMode double-mark. `markBootMilestone` swallows `performance.mark`/`measure` exceptions intentionally (documented), so missing milestones surface as `<missing>` in the summary line — visible, not silent. `delta_ms` uses `Option<f64>` so an unset `BOOT_T0` still emits the literal `rust:first-ipc` token rather than nothing. Boot-failure path (`boot().catch(...)`) is unchanged; partial milestones recorded before a rejection remain observable in `performance.getEntriesByType("measure")` per the contract's error scenario. No new dependencies. |
| **Verification Quality (20%)** | 7/10 | `pnpm tsc --noEmit` exits 0; `pnpm lint` exits 0 (the eslint config now ignores `cargo-target/`); `pnpm test` runs 159 files / 2,414 tests, all pass; `pnpm build` produces `dist/index.html` + chunked assets in 2.61s. All 14 grep checks from the contract Test Script return the expected matches (verbatim output captured below). Six metadata fields are concrete values, not placeholders. Six unit tests in `bootInstrumentation.test.ts` pin: each milestone observable via `getEntriesByName`, `<missing>` rendering, dup-mark idempotence, summary line shape, `findMilestoneDelta` null contract, canonical milestone order. **Live console summary line and live Rust log lines are NOT captured** — only synthetic format references in `baseline.md` lines 305-323. The contract's Required Evidence demanded "console summary line copied verbatim from one launcher cold-boot trial and one workspace cold-boot trial." That evidence is deferred to the operator follow-up pass. |
| **Overall** | **7.6/10** | Weighted: 0.35·8 + 0.25·7 + 0.20·8 + 0.20·7 = 7.55. Each dimension ≥ 7 (pass threshold). |

## Verdict: PASS (with P1 carry-over)

Each dimension scores ≥ 7/10 (pass threshold per harness rubric). The
engineering deliverable for Sprint 1 — instrumentation primitives, eight
frontend milestones wired at the contract-mandated points, two Rust
timestamps with `OnceLock`-gated once-only emission, one-line boot
summary with `<missing>` token, runnable measurement script, baseline
document with full metadata + protocol + four scenario tables + overhead
section + contractual-reference statement — is complete, type-safe,
lint-clean, and test-covered.

The PENDING per-trial cells are a recoverable verification gap that the
harness instruction explicitly carved out. Sprint 2 is blocked on filling
them; Sprint 1's engineering deliverable is not.

## Sprint Contract Status (Done Criteria)

- [x] **AC-175-01-01** — Reproducible measurement protocol exists at
  `docs/sprints/sprint-175/baseline.md` lines 84-135 + `scripts/measure-startup.sh`;
  defines cold vs warm, exact commands per scenario, 5 trials,
  drop-slowest, median + p95.
- [x] **AC-175-01-02** — Eight milestones emit at the named call sites;
  observable via `performance.getEntriesByType("measure")`; one-line
  `boot()` summary at `main.tsx:70` with `<missing>` token for absent
  milestones (verified by `bootInstrumentation.test.ts` test "renders
  missing milestones as <missing> in the summary line").
- [x] **AC-175-01-03** — `rust:entry` at `lib.rs:30` (top of `run()`);
  `rust:first-ipc` at `connection.rs:128-132` (inside `get_session_id`,
  gated by `OnceLock::set`). Both `info!` level (survive release filter).
- [~] **AC-175-01-04** — `baseline.md` exists; four scenarios labeled;
  six metadata fields filled with concrete values (lines 14-19); BUT
  per-milestone median/p95 cells are PENDING. Contract says "reports
  per-milestone median + p95 timings" — strict reading wants numbers.
  Treated as P1 carry-over per harness instruction.
- [x] **AC-175-01-05** — Overhead reported per-milestone alongside the
  baseline (`baseline.md` lines 239-262), per the second clause of the
  AC. Future sprints can subtract it.

## Verification command output (verbatim)

```
$ pnpm tsc --noEmit  → exit 0 (no output)
$ pnpm lint         → exit 0 (no output beyond banner)
$ pnpm test         → Test Files 159 passed (159) | Tests 2414 passed (2414) | 33.38s
$ pnpm build        → ✓ 1858 modules transformed | ✓ built in 2.61s

$ ls docs/sprints/sprint-175/baseline.md
docs/sprints/sprint-175/baseline.md

$ grep -E "launcher-cold|launcher-warm|workspace-cold|workspace-warm" docs/sprints/sprint-175/baseline.md
→ 16+ matches (lines 68-71, 105-115, 167-237, 302, 332-339)

$ grep -nE "OS|CPU|RAM|commit|build mode|date" docs/sprints/sprint-175/baseline.md
14:| **OS** | macOS 26.4.1 (Darwin kernel 25.4.0, arm64) |
15:| **CPU** | Apple M4 (10 cores) |
16:| **RAM** | 16 GB (17,179,869,184 bytes) |
17:| **commit SHA** | `3963bf88249ee430541270d4cd8941f1eb44a25e` |
18:| **build mode** | `release` (per AC-175-04 — official numbers must come from `pnpm tauri build`, not `pnpm dev`) |
19:| **date** | 2026-04-30 |
(all six fields filled with concrete values, no placeholder strings)

$ grep -nE "theme:applied|session:initialized|connectionStore:imported|connectionStore:hydrated|react:render-called" src/main.tsx
36:  markBootMilestone("theme:applied");
41:  markBootMilestone("session:initialized");
46:  markBootMilestone("connectionStore:imported");
48:  markBootMilestone("connectionStore:hydrated");
59:  markBootMilestone("react:render-called");

$ grep -nE "react:first-paint|app:effects-fired" src/AppRouter.tsx
36:  // sprint-175 — `react:first-paint` milestone. ...
45:    markBootMilestone("react:first-paint");
106:    // sprint-175 — emit `app:effects-fired` once the launcher's five IPC
108:    // the end-to-end `T0 → app:effects-fired` row in baseline.md.
109:    markBootMilestone("app:effects-fired");

$ grep -n "app:effects-fired" src/App.tsx
31:    // sprint-175 — emit `app:effects-fired` once the workspace's five IPC
33:    // for the end-to-end `T0 → app:effects-fired` row in baseline.md.
34:    markBootMilestone("app:effects-fired");

$ grep -n "rust:entry" src-tauri/src/lib.rs
25:    // Sprint 175 — `rust:entry` is the first observable timestamp ...
30:    info!(target: "boot", "rust:entry t={:?}", BOOT_T0.get());

$ grep -rn "rust:first-ipc" src-tauri/src/commands/
src-tauri/src/commands/connection.rs:106: ... delta `rust:first-ipc - rust:entry` ...
src-tauri/src/commands/connection.rs:117: // Sprint 175 — `rust:first-ipc`. ...
src-tauri/src/commands/connection.rs:130:            "rust:first-ipc cmd=get_session_id delta_ms={:?}",
```

All 14 contract verification checks pass.

## Static review

- `src/main.tsx`: `boot()` await order is exactly
  `bootTheme → await initSession → await import("@stores/connectionStore")
   → hydrateFromSession → bootWindowLifecycle (fire-and-forget) → render`,
  with marks added between each step and `logBootSummary()` at the end.
  Diff inside `boot()` is additive only — no await reordered/removed.
- `src/main.tsx:25-27`: `document.title` is assigned synchronously
  *before* `markT0()` and any await (Sprint 173 invariant preserved).
- `src/AppRouter.tsx:41-46`: `useLayoutEffect` is ref-guarded
  (`firstPaintMarkedRef`), so StrictMode double-invoke does not
  double-mark. Empty deps → fires once per mount.
- `src-tauri/src/commands/connection.rs:124`: `OnceLock<Instant>` truly
  emits `rust:first-ipc` once-only across IPC races; subsequent calls see
  `Err(_)` from `set` and skip the `info!` block.
- `src-tauri/src/lib.rs:21,29-30`: `pub static BOOT_T0: OnceLock<Instant>`
  is set on the very first line of `run()` (before `tauri::Builder::default()`).
- `bootInstrumentation.ts:148-155`: summary line renders `<missing>` for
  every absent milestone — verified by unit test.

## Findings

### P1 — Baseline numbers must be filled before Sprint 2 starts

**Category**: Verification Gap
**Location**: `docs/sprints/sprint-175/baseline.md` (per-trial median/p95
columns, four scenario tables)
**Current**: Each scenario table carries `PENDING` in every median/p95
cell. The instrumentation, the protocol, the runnable script, the host
metadata, and the structure are all in place; only the runtime numbers
are unfilled.
**Expected**: Per AC-175-01-04, baseline reports per-milestone median
and p95 for all four scenarios. Sprint 2's "≥ 20% improvement vs baseline"
verification cannot evaluate against `PENDING`.
**Operator unblocker (action required before Sprint 2 starts)**:
1. From a host with an interactive Tauri build (the developer's macOS dev
   box), run: `pnpm tauri build && ./scripts/measure-startup.sh all`.
2. The script prompts the operator to launch the app, paste the
   `[boot] T0=0 …` summary line per trial (5 trials per scenario),
   automatically drops the slowest, computes median + p95, and emits
   paste-ready Markdown tables.
3. Replace every `PENDING` cell across the four scenario tables in
   `baseline.md` with the script's output.
4. Also capture and paste the verbatim console summary line from one
   launcher-cold trial and one workspace-cold trial under the "Sample
   console summary line" section (currently synthetic), and the verbatim
   Rust `rust:entry` and `rust:first-ipc` log lines under "Sample Rust
   log lines" (currently synthetic).
5. Inside the Docker E2E container, set `MEASURE_NONINTERACTIVE=1` and
   pre-populate `$LOG_DIR/<scenario>-trial-<i>.log` files via the
   `tauri-driver` capture; the script's non-interactive branch
   (`measure-startup.sh:155-163`) handles aggregation.
6. Sprint 2's contract MUST gate on this fill being done. Until then,
   Sprint 2 cannot pass its performance AC.

**Severity rationale**: P1 (not P0) because the engineering work that
required code is complete; only an operator-driven runtime measurement
remains. P0 would block sprint completion outright. The harness
instruction explicitly carved this out as recoverable.

### P2 — Replace synthetic samples with live capture

**Category**: Evidence Quality
**Location**: `baseline.md` lines 305-323 (Sample console summary,
Sample Rust log lines)
**Current**: Both sections currently show **synthetic** format references
("synthetic numbers from a Node `perf_hooks` trace"). The format is
correct and matches what the unit tests pin, but it is not "verbatim
from a real trial" as the contract Required Evidence section asks.
**Suggestion**: When the operator runs the P1 unblocker above, also
paste the real first-trial output for both samples so the baseline
document carries actual ground-truth strings rather than placeholders.

## Carry-overs to Sprint 2 brief

- The Sprint 2 brief MUST add an explicit precondition: "Sprint 2 cannot
  start until P1 finding from Sprint 1 (baseline numeric fill) is
  resolved. Verify by running `grep -c PENDING docs/sprints/sprint-175/baseline.md`
  and confirming a count of 0 within the four scenario tables."
- Sprint 2's verification must compare against a specific row from
  `baseline.md`'s `launcher-cold` table (per AC-175-02-03, "T0 →
  react:first-paint must improve by ≥ 20%"). That row's median value
  must be a concrete number when Sprint 2's evaluator runs.

## Handoff Evidence Summary

- Contract: `docs/sprints/sprint-175/contract.md`
- Brief: `docs/sprints/sprint-175/execution-brief.md`
- Generator handoff (Attempt 2): `docs/sprints/sprint-175/handoff.md`
- Findings (this file): `docs/sprints/sprint-175/findings.md`
- Implementation files verified:
  - `src/main.tsx` (eight-mark wiring + `logBootSummary` + Sprint 173 title)
  - `src/AppRouter.tsx` (`react:first-paint` ref-guarded; LauncherShell
    `app:effects-fired`)
  - `src/App.tsx` (workspace `app:effects-fired`)
  - `src-tauri/src/lib.rs` (`BOOT_T0` + `rust:entry`)
  - `src-tauri/src/commands/connection.rs` (`FIRST_IPC_INSTANT` +
    `rust:first-ipc`)
  - `src/lib/perf/bootInstrumentation.ts` (+ `.test.ts`, six tests)
  - `scripts/measure-startup.sh` (runnable harness)
  - `docs/sprints/sprint-175/baseline.md` (header + protocol + four
    scenario tables + overhead + contractual-reference)
- Open P0: 0
- Open P1: 1 (baseline numeric fill — operator follow-up)
- Open P2: 1 (replace synthetic samples with live capture during the
  same operator pass)
- Required checks passing: yes (`tsc --noEmit`, `lint`, `test`, `build`)
- Acceptance criteria evidence: linked above (AC-175-01-04 marked `[~]`
  due to P1)

## Verdict

**PASS** with P1 carry-over.

Sprint 1's engineering deliverable is complete. The instrumentation layer
is wired into the actual boot path (the gap that failed Attempt 1 is
closed), all 14 contract verification commands return the expected
output, all required Vitest / lint / build checks pass, and the baseline
document is structurally complete. The remaining gap is a runtime
measurement that the harness instruction explicitly designated as a
recoverable operator follow-up. Sprint 2 must not start until P1 is
resolved.

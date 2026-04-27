# Sprint 150 — Evaluator Findings

## Sprint 150 Evaluation Scorecard

| Dimension | Score | Notes |
|-----------|-------|-------|
| Correctness (35%) | 9/10 | All 6 ACs verifiably met. `tauri.conf.json` matches the exact specs (launcher 720×560 fixed/centered/visible; workspace 1280×800 resizable + minWidth 960 / minHeight 600 / hidden). Rust `launcher.rs` exposes 7 commands keyed by label; all are registered in `lib.rs:63–69` `invoke_handler`. `AppRouter.tsx` exhaustively branches on `getCurrentWindowLabel()` and falls back to launcher with a `console.warn` for unknown/null labels. `App.tsx` no longer renders the `HomePage`-vs-`WorkspacePage` ternary on `screen`; only keyboard-shortcut test seams remain (AC-150-05 explicitly permits this). |
| Completeness (25%) | 8/10 | All 6 ACs and the 7 required checks pass (vitest, tsc, lint, cargo build, cargo test, static config inspection, App.tsx grep). Test surface exceeds the contract minimums (4 frontend cases vs ≥3 required, 4 Rust unit tests vs ≥2 required). One genuine completeness gap: TDD red-then-green proof "lives in the conversation log" rather than git history — the contract allowed this with a written note, but it is the weakest piece of evidence in the packet (see Feedback #1). |
| Reliability (20%) | 8/10 | `getCurrentWindowLabel()` swallows `getCurrentWebviewWindow()` runtime failures and returns `null`, which `AppRouter` handles defensively. `window_by_label` returns a typed `AppError::NotFound` with the missing label embedded so the frontend can map to a toast. `console.warn` on the unknown-label fallback is a single, non-throwing surface. The `LauncherShell` re-runs `loadConnections / loadGroups / initEventListeners / loadPersistedFavorites / loadPersistedMru` on mount — identical to the legacy `App.tsx` boot — so behavior parity is preserved. Minor concern: when Sprint 151 wires the bridge, the workspace shell will boot the same effects via `<App />`, which could double-fire IPC; this is flagged in the handoff as an assumption and is acceptable for Sprint 150. |
| Verification Quality (20%) | 8/10 | Every required check was actually run by the evaluator and matches the handoff: `pnpm vitest run` 2248 passed + 5 todo (149 + 4 new = expected 2244 + 4); `pnpm tsc --noEmit` exit 0; `pnpm lint` exit 0; `cargo build` exit 0; `cargo test --lib` 291 passed; `cargo test --lib launcher` 4 passed; `cargo clippy --all-targets --all-features -- -D warnings` exit 0; `git diff src/__tests__/window-lifecycle.ac141.test.tsx` empty; `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` shows 5 passing + 5 todo (Sprint 149 parity); skip-grep on the four touched frontend files empty. The TDD proof relying on conversation-log capture is the only soft evidence (see Feedback #1). |
| **Overall** | **8.3/10** | Foundation sprint executed cleanly; only finding is a process gap (TDD evidence form), not a code defect. |

## Verdict: PASS

All four dimensions ≥ 7/10. All six Done Criteria are met with concrete evidence. No P1/P2 findings open.

## Sprint Contract Status (Done Criteria)

- [x] **AC-150-01** — `tauri.conf.json` declares both window entries with exact specs.
  - Evidence: `src-tauri/tauri.conf.json:13–35`. `python3 -c "json.dumps(c['app']['windows'])"` returns two entries: launcher 720×560, `resizable:false`, `maximizable:false`, `center:true`, `visible:true`; workspace 1280×800, `minWidth:960`, `minHeight:600`, `resizable:true`, `visible:false`.
- [x] **AC-150-02** — Rust launcher module + commands registered + unit tests pass.
  - Evidence: `src-tauri/src/launcher.rs:1–168` (180 LOC, 7 commands, 4 unit tests using `tauri::test::MockRuntime`). `src-tauri/src/lib.rs:4` adds `pub mod launcher;`; `lib.rs:63–69` registers all 7 commands. `cargo build` exit 0. `cargo test --lib launcher` → 4 passed / 0 failed. `cargo clippy --all-targets --all-features -- -D warnings` exit 0.
- [x] **AC-150-03** — React entrypoint routes by label; tsc + vitest pass.
  - Evidence: `src/main.tsx:3,11` mounts `<AppRouter />`. `src/AppRouter.tsx:33–62` reads `getCurrentWindowLabel()` and dispatches launcher / workspace / fallback. `pnpm tsc --noEmit` exit 0; `pnpm vitest run` → 149 files / 2248 passed + 5 todo (no regression vs Sprint 149 baseline of 2244).
- [x] **AC-150-04** — `window-bootstrap.test.tsx` exists, TDD-first, ≥3 cases.
  - Evidence: `src/__tests__/window-bootstrap.test.tsx:91–144` contains **4** `it()` cases (launcher / workspace / unknown / null). All four pass: `pnpm vitest run src/__tests__/window-bootstrap.test.tsx` → 1 file / 4 tests / 0 errors.
  - Soft note: TDD red-then-green proof is captured in conversation log (Generator's claim on `handoff.md:58`) rather than git commit ordering. The contract allowed either form, so this satisfies the AC, but it is the weakest piece of evidence in the packet — see Feedback #1.
- [x] **AC-150-05** — `App.tsx` no longer routes top-level on `appShellStore.screen`.
  - Evidence: `git diff src/App.tsx` shows removal of `const screen = useAppShellStore((s) => s.screen);` and the `{screen === "home" ? <HomePage /> : <WorkspacePage />}` ternary; `<WorkspacePage />` is now the unconditional child of the root `<div>`. `HomePage` import also removed (now only imported by `LauncherPage`). Remaining `screen` references on lines 120 / 154 / 323 are the Cmd+, keyboard-shortcut handler, the Cmd+1..9 handler guard, and a comment — explicitly permitted by AC-150-05's "test seams may remain elsewhere".
- [x] **AC-150-06** — `window-lifecycle.ac141.test.tsx` count unchanged (5 + 5 todo).
  - Evidence: `git status src/__tests__/window-lifecycle.ac141.test.tsx` clean (no diff). `git log --oneline -1` returns Sprint 149's commit `660c7be`. `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` → 5 passed | 5 todo (10).

## Verification Plan Outcomes (replayed by evaluator)

| Check | Outcome | Evidence |
|---|---|---|
| `pnpm vitest run` | PASS | 149 files / 2248 passed + 5 todo (24.34s) |
| `pnpm tsc --noEmit` | PASS | exit 0, no output |
| `pnpm lint` | PASS | exit 0, no errors |
| `cargo build --manifest-path src-tauri/Cargo.toml` | PASS | finished dev profile |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS | 291 passed; 0 failed; 2 ignored |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher` | PASS | 4 passed; 0 failed |
| `cargo clippy --all-targets --all-features -- -D warnings` | PASS | exit 0 |
| Static `tauri.conf.json` window inspection | PASS | both entries match contract |
| `git diff src/__tests__/window-lifecycle.ac141.test.tsx` | empty | file untouched |
| Skip-grep on touched files | empty | no `it.skip / it.todo / xit / describe.skip / this.skip()` |
| `App.tsx` top-level `screen` routing | removed | only test seams remain |

## Feedback for Generator

1. **TDD evidence form (process gap, not code defect)**:
   - Current: handoff.md cites the red-state failure (`Error: Failed to resolve import "@lib/window-label" ...`) but the proof "lives in the conversation log"; no commit yet exists, and no patch / failing-output snapshot is persisted in `docs/sprints/sprint-150/`.
   - Expected: a durable artifact that survives outside the conversation — either (a) two commits ordered "test red → code green" pushed before evaluation, or (b) a captured `pnpm vitest run` log of the failing state checked into `docs/sprints/sprint-150/tdd-evidence/` (or a similar path), referenced from `handoff.md`.
   - Suggestion: for Sprint 151 onward, when the orchestrator commits Sprint 150's work, split into two commits — first the test file (red against `main`), then the production code (green). For this sprint, retro-fit by capturing the pre-routing failure output into `docs/sprints/sprint-150/tdd-red-evidence.txt` on commit time.

2. **`LauncherShell` and `<App />` boot duplication (acceptable for Sprint 150, must close in Sprint 151)**:
   - Current: `AppRouter.LauncherShell` re-runs `loadConnections / loadGroups / initEventListeners / loadPersistedFavorites / loadPersistedMru`, and `App.tsx`'s workspace branch does the same. Both windows boot independent stores.
   - Expected: post-Sprint 151, only one window owns the IPC fetch; the other observes via the bridge.
   - Suggestion: Sprint 151's bridge work should explicitly retire one of these two boot paths (probably the workspace one, since the launcher is the entry surface) so the workspace doesn't fire `connectToDatabase` listeners twice.

3. **Cosmetic: `LauncherShell` toast / quick-open / shortcut-cheatsheet duplication**:
   - Current: `AppRouter.tsx:94–104` mounts `<QuickOpen />`, `<ShortcutCheatsheet />`, `<QueryLog />`, `<Toaster />` alongside `LauncherPage`, mirroring `App.tsx:333–340`. Generator flagged this as an assumption.
   - Expected: a future sprint may want only a launcher-appropriate subset (e.g. no `QueryLog` in the launcher).
   - Suggestion: when Sprint 154 wires real lifecycle, audit which global affordances actually make sense in the launcher (Cmd+P quick-open over an empty connection list is questionable) and trim. Out of scope for Sprint 150.

4. **`workspace.maximizable: true` is an unspecified default — re-confirm with design**:
   - Current: handoff.md notes the contract didn't pin `maximizable` for the workspace; Generator chose `true`.
   - Expected: alignment with the design bar.
   - Suggestion: either confirm with the design owner or document the choice in ADR 0012 when it lands in Sprint 155 so the precedent is recorded.

## Handoff Evidence Packet

- **Sprint outcome**: PASS, all 6 ACs satisfied, all 7 required checks green.
- **Test counts**: 2248 passed + 5 todo (Sprint 149 baseline 2244 + 4 new from `window-bootstrap.test.tsx`).
- **Skip count delta**: 0 (no new skips/todos introduced; existing 5 todos preserved per AC-150-06).
- **Rust commands surface**: 7 new commands registered in `lib.rs:63–69`: `launcher_show / launcher_hide / launcher_focus / workspace_show / workspace_hide / workspace_focus / app_exit`.
- **Files changed (10 total)**:
  - `src-tauri/tauri.conf.json` (modified)
  - `src-tauri/Cargo.toml` (modified — added `tauri = { version = "2", features = ["test"] }` to `[dev-dependencies]`)
  - `src-tauri/src/lib.rs` (modified — `pub mod launcher;` + 7 command registrations)
  - `src-tauri/src/launcher.rs` (new — 168 LOC, 7 commands + 4 unit tests)
  - `src/main.tsx` (modified — root mount swap)
  - `src/App.tsx` (modified — top-level page routing removed)
  - `src/AppRouter.tsx` (new — boot dispatcher)
  - `src/lib/window-label.ts` (new — label resolver shim)
  - `src/pages/LauncherPage.tsx` (new — launcher shell)
  - `src/__tests__/window-bootstrap.test.tsx` (new — 4 TDD-first cases)
- **Untouched**: `src/__tests__/window-lifecycle.ac141.test.tsx` — clean diff verified.
- **Pre-existing failure (NOT a regression)**: `tests/mongo_integration.rs::test_mongo_adapter_connect_ping_list_disconnect_happy_path` requires a live MongoDB; verified pre-existing by Generator via `git stash`. Out of scope.

## Exit Criteria Status

- Open P1/P2 findings: **0**.
- All 7 required checks passing: **yes**.
- Per-AC evidence linked: **yes** (above).
- No new `it.skip` / `it.todo`: **yes** (skip-grep empty on the four touched frontend files).
- `window-lifecycle.ac141.test.tsx` untouched: **yes** (`git diff` empty; `pnpm vitest run` shows 5 passing + 5 todo, matching Sprint 149).

**Sprint 150 is cleared for orchestrator commit. Proceed to Sprint 151 (Cross-Window State Bridge).**

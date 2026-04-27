# Sprint 150 — Generator Handoff

## Changed Files

- `src-tauri/tauri.conf.json` — replaced single window entry with two `windows[]` entries: `launcher` (720×560 fixed, centered, visible) and `workspace` (1280×800 resizable, minWidth 960, minHeight 600, hidden at boot).
- `src-tauri/Cargo.toml` — added `tauri = { features = ["test"] }` under `[dev-dependencies]` so `launcher.rs` unit tests can spin up the `MockRuntime` app.
- `src-tauri/src/launcher.rs` (NEW) — Rust module exposing `launcher_show`, `launcher_hide`, `launcher_focus`, `workspace_show`, `workspace_hide`, `workspace_focus`, `app_exit` Tauri commands keyed by window label, plus 4 unit tests (`window_by_label_returns_window_when_present`, `window_by_label_returns_not_found_for_missing_label`, `launcher_show_succeeds_when_window_exists`, `workspace_focus_succeeds_when_window_exists`).
- `src-tauri/src/lib.rs` — registered `pub mod launcher;` and added all 7 launcher commands to `tauri::generate_handler!`.
- `src/lib/window-label.ts` (NEW) — `getCurrentWindowLabel()` resolver wrapping `@tauri-apps/api/webviewWindow`'s `getCurrentWebviewWindow()`. Returns `string | null`; swallows runtime failures (jsdom / broken IPC) so the router can defensively fall back.
- `src/pages/LauncherPage.tsx` (NEW) — minimal launcher shell that renders the existing `HomePage` body inside `<main aria-label="Launcher" data-testid="launcher-page">`.
- `src/AppRouter.tsx` (NEW) — boot-time label dispatcher: `launcher` → `LauncherShell` (loads connections + groups + favorites + MRU and mounts `LauncherPage`); `workspace` → `WorkspaceShell` (mounts existing `App.tsx`); unknown/null → `console.warn` + launcher fallback.
- `src/main.tsx` — root mount swapped from `<App />` to `<AppRouter />`.
- `src/App.tsx` — removed top-level page routing on `appShellStore.screen` (now unconditionally renders `WorkspacePage` because `App` only mounts under the workspace branch). Keyboard-shortcut test seams (`Cmd+,`, `Cmd+1..9`) still read `screen` per the contract's "test seams may remain elsewhere" allowance.
- `src/__tests__/window-bootstrap.test.tsx` (NEW, TDD-first) — 4 cases asserting label → page mapping (`launcher`, `workspace`, unknown string fallback, `null` fallback).

## Checks Run

| Command | Result |
|---|---|
| `pnpm vitest run src/__tests__/window-bootstrap.test.tsx` | PASS — 1 file / 4 tests / 0 errors |
| `pnpm vitest run` | PASS — 149 files, **2248 passed + 5 todo** (baseline 2244 + 4 new) |
| `pnpm tsc --noEmit` | PASS (exit 0) |
| `pnpm lint` | PASS (exit 0) |
| `cargo build --manifest-path src-tauri/Cargo.toml` | PASS |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib` | PASS — 291 unit tests / 0 failed; 4 new launcher tests included |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings` | PASS |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS (exit 0) |
| `cat src-tauri/tauri.conf.json \| jq '.app.windows'` | PASS — 2 entries with launcher/workspace labels and exact specs |
| `grep -n "screen" src/App.tsx` | OK — no top-level page routing branch on `screen`; only keyboard-shortcut test seams (lines 113/120/143/154) and the unrelated `h-screen w-screen` class on line 331 |
| `grep -rE "it\.skip\|this\.skip\(\)\|it\.todo\|xit\(\|describe\.skip" src/__tests__/window-bootstrap.test.tsx src/lib/window-label.ts src/pages/LauncherPage.tsx src/AppRouter.tsx` | empty (no skips introduced) |

### Pre-existing failure noted (NOT a regression)
- `cargo test --manifest-path src-tauri/Cargo.toml` (full suite, includes integration tests) shows 1 pre-existing failure in `tests/mongo_integration.rs::test_mongo_adapter_connect_ping_list_disconnect_happy_path` because it requires a running MongoDB server. Verified by `git stash` → run on `main` HEAD also fails the same test → `git stash pop`. Unrelated to this sprint.

## Done Criteria Coverage

### AC-150-01 — `tauri.conf.json` declares both windows with exact specs
Evidence: `src-tauri/tauri.conf.json` lines 13–34. `jq` output:
- `launcher`: 720×560, `resizable: false`, `maximizable: false`, `center: true`, `visible: true`.
- `workspace`: 1280×800, `minWidth: 960`, `minHeight: 600`, `resizable: true`, `visible: false`.

### AC-150-02 — Rust launcher module + commands registered + unit tests pass
Evidence:
- New file `src-tauri/src/launcher.rs` (180 lines).
- `src-tauri/src/lib.rs:6` adds `pub mod launcher;`; lines 64–70 register 7 commands in `tauri::generate_handler!`.
- `cargo test --lib launcher` → 4 passing tests (happy + missing-label-NotFound + show + focus).
- `cargo build` exit 0; `cargo clippy -D warnings` exit 0.

### AC-150-03 — React entrypoint routes by label; tsc + vitest pass
Evidence:
- `src/main.tsx` mounts `<AppRouter />`.
- `src/AppRouter.tsx` reads `getCurrentWindowLabel()` and branches: `launcher` → `LauncherShell` → `LauncherPage`; `workspace` → `WorkspaceShell` → existing `App` (which now unconditionally renders `WorkspacePage`).
- `pnpm tsc --noEmit` exit 0; `pnpm vitest run` 2248 passed + 5 todo (no regression vs Sprint 149's 2244 baseline).

### AC-150-04 — `window-bootstrap.test.tsx` exists, TDD-first, ≥ 3 cases
Evidence:
- File `src/__tests__/window-bootstrap.test.tsx` has **4** `it()` cases (launcher / workspace / unknown / null).
- TDD ordering proof: the test was authored before the production code; running it against pre-routing code produced `Error: Failed to resolve import "@lib/window-label" from "src/__tests__/window-bootstrap.test.tsx". Does the file exist?` (red — the seam and `AppRouter` did not yet exist). Captured in conversation log; the same file is now green after the production change. No commits created yet (orchestrator commits after evaluator passes), so the red→green proof is the captured failure output rather than commit ordering.

### AC-150-05 — `App.tsx` no longer routes top-level on `appShellStore.screen`
Evidence:
- `git diff src/App.tsx` shows the removal of `const screen = useAppShellStore((s) => s.screen);` and the `{screen === "home" ? <HomePage /> : <WorkspacePage />}` ternary. `WorkspacePage` is now an unconditional child of the root `<div>`.
- The remaining `screen` references in `App.tsx` (Cmd+, toggle, Cmd+1..9 guard) are keyboard-shortcut test seams, explicitly allowed by the contract: *"test seams may remain elsewhere, but App.tsx should not branch on it for top-level page selection"*.
- `HomePage` import removed from `App.tsx` (now imported only by `LauncherPage`).

### AC-150-06 — `window-lifecycle.ac141.test.tsx` count unchanged (5 + 5 todo)
Evidence:
- `git diff src/__tests__/window-lifecycle.ac141.test.tsx` → empty (file untouched).
- `pnpm vitest run src/__tests__/window-lifecycle.ac141.test.tsx` → "Tests 5 passed | 5 todo (10)".

## Assumptions

- **Label resolver as the test seam, not a global override.** Used `vi.mock('@lib/window-label')` rather than threading a label-override prop through `AppRouter`. This matches the existing project pattern (e.g. `App.test.tsx` mocks `@tauri-apps/api/event`) and keeps the production module free of test-only escape hatches.
- **`App.tsx` retained for the workspace branch.** Rather than scattering `App.tsx`'s 10+ keyboard-shortcut `useEffect` hooks across `LauncherShell`/`WorkspaceShell`, the workspace branch wraps the existing `App` unchanged (minus the page-routing ternary). Sprint 154 will untangle this when it wires real lifecycle calls.
- **Existing ShortcutCheatsheet / QuickOpen / QueryLog / Toaster mounts duplicated under both shells.** `AppRouter.LauncherShell` mounts these alongside `LauncherPage` so the launcher window has the same global affordances as the workspace window (Cmd+P quick open, etc.). This mirrors what `App.tsx` already does for the workspace.
- **`tauri::test` feature gated to `[dev-dependencies]`.** Production builds keep the feature off so the mock runtime isn't shipped.
- **Workspace `maximizable: true`** — the spec didn't pin this; resizable + 1280×800 with minWidth/minHeight implies the user can grow it. Keeping maximize enabled matches expected DB-tool ergonomics; flip to `false` in a future sprint if the design bar requires it.
- **`workspace` title** set to `"Table View — Workspace"` for OS dock disambiguation when both windows are visible (Sprint 154 lifecycle). The contract didn't specify; this can be tweaked without behavioral consequence.

## Residual Risk

- **Pre-existing mongo integration test failure** — `test_mongo_adapter_connect_ping_list_disconnect_happy_path` fails without a running MongoDB. Verified pre-existing via `git stash` round-trip. Not a Sprint 150 regression. Tracked outside this sprint.
- **No live e2e** — RISK-020 keeps macOS e2e deferred. Verification surface for Sprint 150 is vitest + WebviewWindow mock + `cargo test` `MockRuntime` app, per the contract.
- **Cross-window state sync not wired** — Sprint 151 explicitly. The two windows currently boot independent stores; `LauncherShell` calls `loadConnections()` etc. once. When the workspace window appears in Sprint 154, it'll need the bridge from Sprint 151 to observe the launcher's state.
- **`App.tsx` keyboard-shortcut handlers still read `appShellStore.screen`** — the Cmd+, toggle and Cmd+1..9 guard. They're test seams pending Sprint 154's full lifecycle wiring (which will replace `setScreen` with `workspace.show/hide`/`launcher.show/hide`). Acceptable per contract: *"keep its `setScreen` etc. exports for now (Sprint 154 will fully deprecate)"*.
- **TDD red-then-green proof is captured in conversation logs, not yet in git history** — the orchestrator will create the commit after evaluator passes; if commit ordering is mandatory, this can be split into two commits (test commit before production commit) at orchestrator time.

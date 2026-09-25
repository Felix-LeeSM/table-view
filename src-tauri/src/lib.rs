#![deny(unsafe_code)]
// #1368 — block new `.unwrap()` in production paths. `-D warnings` (CI + local
// clippy gate) turns this into a hard error; `allow-unwrap-in-tests = true`
// (clippy.toml) keeps test-code unwraps legal. Existing production violations
// are either fixed or carry a scoped `#[allow(clippy::unwrap_used)]` + reason.
#![warn(clippy::unwrap_used)]

pub mod commands;
pub mod diagnostics;
pub mod events;
pub mod launcher;
pub mod state;
pub mod storage;

// #1769 — the bodies of `db` / `error` / `models` live in the `table-view-core`
// path crate. Re-exporting them at the crate root here keeps every command,
// state module and integration test that uses `crate::db::…` /
// `table_view_lib::models::…` compiling unchanged. Only `storage` gets its own
// shim module above — two boot glue files reference `crate::commands::` back,
// so it could not move down into core.
pub use table_view_core::{db, error, models};

use commands::connection::AppState;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::Manager;
// `Emitter` (the `.emit()` trait method) is only exercised by the macOS-only
// menu dispatch fns below; scope the import to macOS so the Linux build's
// `-D unused-imports` clippy gate stays clean.
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tracing::info;

/// Process-wide `Instant` captured at the very top of `run()`.
/// Every later "Tauri startup overhead" measurement (notably
/// `rust:first-ipc` in `commands::connection::get_session_id`) reads this
/// to compute its delta. Using `OnceLock` keeps the API allocation-free
/// after the first set and thread-safe without a mutex; subsequent
/// invocations of `run()` (which `tauri` does not actually do, but we are
/// defensive) keep the original `Instant`.
pub static BOOT_T0: OnceLock<Instant> = OnceLock::new();

/// Phase-breakdown helper. Emits a single
/// structured `info!` line on `target: "boot"` so the measurement
/// protocol can grep deterministically for per-segment deltas
/// without depending on log line ordering. The protocol lives at
/// `docs/archives/incidents/boot-windows/2026-04-30-cold-boot-tracing-instrumentation/memory.md`.
///
/// Each call updates `cursor` to `now`, so the next call's delta is
/// "wall-clock time since the previous phase mark" rather than "since
/// `rust:entry`". This lets us attribute self-time to each phase even
/// when phases run sequentially on the same thread.
///
/// The instrumentation is permanent (not feature-gated). It is cheap by
/// construction — one `Instant::now()`, one `Duration::as_secs_f64()`,
/// and one `info!` formatter call per phase, well under 100µs of total
/// added overhead per cold boot. `rust:entry` and `rust:first-ipc` follow
/// the same precedent.
fn record_phase(cursor: &mut Instant, phase: &'static str) {
    let now = Instant::now();
    let delta_ms = now.duration_since(*cursor).as_secs_f64() * 1000.0;
    info!(target: "boot", "phase={} delta_ms={:.3}", phase, delta_ms);
    *cursor = now;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // `rust:entry` is the first observable timestamp on the
    // Rust side. Capture it BEFORE the subscriber init so the "Tauri
    // startup overhead" delta honestly includes subscriber bootstrap;
    // we won't print until the subscriber is alive a few microseconds
    // later.
    let entry = Instant::now();
    let _ = BOOT_T0.set(entry);

    // Without an explicit subscriber, every `tracing::info!` is dropped on
    // the floor. Default to RUST_LOG semantics ("info" minimum); honor an env
    // override so debugging-heavy sessions can opt into "debug"/"trace"
    // without a recompile. `try_init` so a re-entry (e.g. an integration test
    // that already installed a subscriber) is a no-op.
    //
    // #1564 — compose TWO fmt layers on a shared `EnvFilter`: the stdout
    // layer keeps `cargo tauri dev` output, and the file layer tees the same
    // lines to a rotating file under `diagnostics::log_dir()`. Packaged
    // builds have no console (macOS `.app` from Finder → /dev/null; Windows
    // `windows_subsystem = "windows"`), so the file is the only place
    // `key_migration failed` / build+run failures / callback warnings survive
    // for a post-hoc bug report. No remote telemetry — logs stay local
    // (ADR 0036). The `dirs`-based path lets init stay here on the pre-builder
    // critical path instead of waiting for `app.path()`.
    use tracing_subscriber::prelude::*;
    // #1620 F2 — hold the writer's `WorkerGuard` in a local (not a `static`
    // `OnceLock`) that lives for `run()`'s whole body. Dropping it flushes the
    // non-blocking writer's backlog and shuts the worker thread down; keeping it
    // in scope keeps logging alive for the process lifetime (`run()` blocks in
    // `.run()` below), while a local lets the two fatal `process::exit(1)` paths
    // explicitly `drop` it first so their last line reaches the file sink (a
    // `static` guard would never drop, losing that line).
    let mut log_guard: Option<tracing_appender::non_blocking::WorkerGuard> = None;
    let file_layer = match diagnostics::file_writer(&diagnostics::log_dir()) {
        Ok((writer, guard)) => {
            log_guard = Some(guard);
            Some(
                tracing_subscriber::fmt::layer()
                    .with_ansi(false)
                    .with_target(true)
                    .with_writer(writer),
            )
        }
        Err(e) => {
            eprintln!("[table-view] file log sink unavailable, stdout only: {e}");
            None
        }
    };
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with(tracing_subscriber::fmt::layer().with_target(true))
        .with(file_layer)
        .try_init();

    // #1565 — route panics through `tracing` so they reach the file sink
    // above. MUST run AFTER `try_init`: the default handler only writes to
    // stderr, which a Finder-launched macOS `.app` (→ /dev/null) or Windows'
    // `windows_subsystem = "windows"` discards, so a panic in one of the
    // detached boot tasks spawned below (`tauri::async_runtime::spawn`, no
    // join) would otherwise vanish with no trace. The hook chains the prior
    // handler, so `cargo tauri dev` still prints the panic to stderr.
    diagnostics::install_panic_hook();

    // #2154 — pick the process-wide rustls crypto provider here, before any
    // adapter exists. rustls is compiled with both provider features on, so
    // `ClientConfig::builder()` panics until a default is installed, and the
    // Oracle, Redis and Search(reqwest) transports all resolve that default
    // rather than naming a provider. Installing it on the first Oracle dial
    // instead would let connection order decide the Redis/Search crypto
    // backend. See `db::tls::install_rustls_crypto_provider`.
    db::tls::install_rustls_crypto_provider();

    // `info!` (NOT `debug!`) so the message survives a release build's
    // default log filter; `target: "boot"` so the protocol script can grep
    // for the literal token regardless of binary name.
    info!(target: "boot", "rust:entry t={:?}", BOOT_T0.get());

    // Phase breakdown. The `rust:entry → rust:first-ipc` segment measured
    // 414ms median in the debug baseline (~96% of the user-perceived blank
    // window). We slice it into named phases so the operator's release-mode
    // rebaseline can attribute self-time to each segment WITHOUT requiring
    // `cargo flamegraph` (which needs sudo on macOS) or Instruments.app. The
    // spec's AC-175-02-02 explicitly accepts a `tracing`-instrumented run
    // with named-segment deltas as the lightest-weight option.
    //
    // `cursor` is the moving "previous phase end" timestamp. Each
    // `record_phase` call emits one `info!` line tagged with the phase
    // name and the wall-clock delta from the prior phase, then advances
    // the cursor. The final phase that we measure synchronously ends at
    // `before-builder-run` — everything after `.run()` (window creation,
    // WKWebView spawn, bundle parse, first-IPC service) is implicitly the
    // residual `rust:first-ipc - before-builder-run` delta the operator
    // computes from the last phase mark and the `rust:first-ipc` line.
    let mut cursor = entry;
    record_phase(&mut cursor, "subscriber-init");

    // Builder chain ordering. Tauri resolves `State<T>` and plugin lookups at
    // runtime, so only the following hard constraints apply — everything
    // else (plugin order, the position of `manage(AppState)` relative to
    // `invoke_handler`, the order of `on_window_event` / `setup` /
    // `on_page_load` registrations) is reader-friendly grouping, not
    // load-bearing:
    //   1. Every `.manage(...)` call must complete before the FIRST IPC
    //      handler invocation (not before `invoke_handler` registration).
    //      Today we register `AppState` before `build()`, which is
    //      sufficient — handlers cannot fire until the event loop runs.
    //   2. The `setup` callback runs once during `build()`. Anything it
    //      reads via `app.state::<T>()` must already be `.manage`-d (it is
    //      — see `app-state-new` phase above).
    //   3. `generate_context!()` is a compile-time macro; its source-order
    //      position is irrelevant.
    // Reordering for the sake of refactoring is therefore safe so long as
    // (1) and (2) hold. The current order matches the phase-instrumentation
    // narrative and should only change when that narrative changes.
    let builder = tauri::Builder::default();
    record_phase(&mut cursor, "builder-default");

    let builder = builder.plugin(tauri_plugin_shell::init());
    record_phase(&mut cursor, "plugin-shell-init");

    let builder = builder.plugin(tauri_plugin_dialog::init());
    record_phase(&mut cursor, "plugin-dialog-init");

    // #1400 — auto-update. The updater plugin exposes the `check` /
    // `downloadAndInstall` IPC used by the launcher's boot-time check; the
    // process plugin exposes `relaunch` to restart into the freshly
    // installed bundle. Both are pure IPC surfaces — no setup work runs on
    // the cold-boot critical path.
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    record_phase(&mut cursor, "plugin-updater-init");

    let builder = builder.plugin(tauri_plugin_process::init());
    record_phase(&mut cursor, "plugin-process-init");

    // Q3 — single-instance plugin. The plugin's
    // `setup` (see tauri-plugin-single-instance 2.4.2) runs on every
    // launch: if a sibling process already owns the Unix socket / named
    // pipe, the 2nd process exits immediately and the live process's
    // callback fires with the 2nd process's args + cwd. Our callback
    // forwards to `commands::single_instance::handle_second_instance_inner`,
    // which re-foregrounds the launcher window (unminimize + show +
    // set_focus). The inner function is exercised under MockRuntime in
    // `tests/single_instance_2nd_launch.rs` — real-process spawn is
    // covered by the e2e scenario (AC-362-02 live).
    //
    // Cost: the plugin's setup performs one socket-connect attempt
    // (sub-millisecond on a clean boot when no sibling exists, then
    // bind+listen), well under the AC-362-03 50ms cold-boot regression
    // budget. Trace markers `phase=plugin-single-instance-init` lock the
    // measurement in.
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Err(e) = commands::single_instance::handle_second_instance_inner(app) {
            tracing::warn!(
                target: "boot",
                "single-instance 2nd-launch callback failed: {e}"
            );
        }
    }));
    record_phase(&mut cursor, "plugin-single-instance-init");

    let builder = builder.manage(AppState::new());
    // 2026-05-17 — `EventVersionRegistry` is managed as a process singleton
    // too, so the cross-window event dispatcher can be injected from the
    // commands. Call sites such as `persist_setting` receive it as `State`.
    let builder = builder.manage(events::EventVersionRegistry::default());
    // Issue #1443 — chunked grid-export sessions (begin/chunk/finish/abort).
    let builder = builder.manage(commands::export::ExportSessionRegistry::default());
    record_phase(&mut cursor, "app-state-new");

    let builder = commands::registry::register_all(builder);
    record_phase(&mut cursor, "invoke-handler-register");

    // Safety net + launcher-close intercept.
    //
    // 1. Workspace destroyed: if the OS closes a workspace window before
    //    the JS close-requested handler could prevent it, ensure the
    //    launcher is visible so the user isn't left without any window.
    //
    // 2. Q13 (strategy line 773) — Launcher CloseRequested:
    //    when the user clicks the launcher's close button (X), intercept
    //    the OS-level close, `prevent_close()` the event, and hide the
    //    launcher via `handle_launcher_close_request`. This keeps the
    //    process alive (and any open `workspace-{conn_id}` windows
    //    untouched) so the launcher can be resurfaced via the macOS dock
    //    icon (RunEvent::Reopen) or a 2nd-launch single-instance
    //    callback. Without this intercept, launcher X would destroy the
    //    launcher window — Tauri's default — and the JS-side
    //    `registerLauncherCloseHandler` would race the destroy event,
    //    sometimes triggering exit before the hide could land.
    let builder = builder.on_window_event(|window, event| {
        match event {
            tauri::WindowEvent::Destroyed
                if window.label().starts_with("workspace-") || window.label() == "workspace" =>
            {
                // 2026-05-16 — the per-conn label `workspace-{conn_id}`
                // matches here too. The UX the user asked for: "once every
                // connection window is closed, focus gathers on the
                // connections window". While another workspace is still
                // alive the launcher stays hidden.
                launcher::handle_workspace_destroyed_safety_net(
                    window.app_handle(),
                    window.label(),
                );
            }
            tauri::WindowEvent::CloseRequested { api, .. } if window.label() == "launcher" => {
                // Prevent the OS-level close — we want the launcher to
                // hide, not destroy. The helper handles the hide call
                // and tolerates the rare "launcher already gone" race.
                api.prevent_close();
                if let Err(e) = launcher::handle_launcher_close_request(window.app_handle()) {
                    tracing::warn!(
                        target: "launcher",
                        "launcher close-request handler returned error: {e}"
                    );
                }
            }
            tauri::WindowEvent::CloseRequested { api, .. }
                if window.label().starts_with("workspace-") || window.label() == "workspace" =>
            {
                // #1101 — unsaved-changes guard. Don't let the OS destroy a
                // workspace window outright (that silently discarded pending
                // grid edits / uncommitted SQL). Prevent the close and hand
                // the decision to the window's JS, which checks dirty tabs
                // and either confirms-then-destroys (`workspace_close`) or
                // aborts. The macOS menu Cmd+W routes here too via
                // `win.close()`. Mirrors the launcher intercept above.
                api.prevent_close();
                if let Err(e) =
                    launcher::emit_workspace_close_request(window, window.label())
                {
                    // Emit failed — destroy so the user isn't trapped in an
                    // un-closeable window (worse than losing the guard once).
                    tracing::warn!(
                        target: "window",
                        "window:close-requested emit failed (label={}): {e}; destroying to avoid trapping the user",
                        window.label()
                    );
                    let _ = window.destroy();
                }
            }
            _ => {}
        }
    });
    record_phase(&mut cursor, "window-event-register");

    // Sub-instrumentation. The earlier phase breakdown showed Builder-internal
    // phases sum to ~15ms / ~1% of `rust:entry → rust:first-ipc` (1567ms median
    // in release-mode operator data). The remaining ~1552ms residual is in
    // the `.run()` interior — window creation, WKWebView spawn, bundle
    // delivery, JS parse, first IPC. Spec AC-175-02-02 forbids a
    // shrinkage claim without profile evidence, so we add two more hooks
    // to slice that residual:
    //
    // - `setup` fires once after Tauri's event loop is alive and managed
    //   state is wired. The delta `rust:entry → rust:setup-done` captures
    //   "process up to first event-loop tick" — i.e. window creation +
    //   WKWebView process spawn (web + GPU + network) before any JS runs.
    //
    // - `on_page_load` fires per-window for both `Started` (URL committed,
    //   parse beginning) and `Finished` (DOMContentLoaded). Per-window
    //   deltas attribute bundle delivery + parse separately for the
    //   `launcher` and (eagerly-created) `workspace` windows. If the
    //   `workspace` window contributes meaningfully even though it is
    //   `visible: false`, lazy-creating it from `workspace_show` becomes
    //   the next shrinkage target.
    //
    // The hooks themselves are cheap (one `Instant::elapsed` + one
    // `info!` per fire). Both stay permanent — boot instrumentation persists
    // in production builds so a later re-baseline can read the same emission
    // shape.
    // `app` is only read by the macOS-only `install_macos_menu` call below, so
    // the `not(macos)` build sees an unused param; `_app` keeps it usable where
    // it is needed while satisfying `-D unused-variables` elsewhere.
    let builder = builder.setup(|_app| {
        // #2184 — hand storage the real user data directory. Until this runs,
        // `app_data_dir()` refuses to resolve one: that refusal is what keeps every
        // test binary and every future entry point off the user's real store, and
        // the price is that the app has to ask. So this must come FIRST in `setup`
        // — `boot_wire_master_key` below and every IPC handler resolve through it.
        //
        // `?` rather than a logged warning, deliberately. If storage has no
        // directory the app must not continue into a launcher showing an empty
        // connection list: that silent-empty state is indistinguishable from the
        // data loss #2183 reported. The error leaves `setup`, so the
        // `builder.build()` / `builder.run(context)` arms further down log it,
        // print it, and exit 1.
        storage::init_production_data_dir()?;

        if let Some(t0) = BOOT_T0.get() {
            let delta_ms = t0.elapsed().as_secs_f64() * 1000.0;
            info!(target: "boot", "rust:setup-done delta_ms={:.3}", delta_ms);
        }

        // #1103 / Q22 — wire the OS-keyring master-key migration.
        // Runs BEFORE the SQLite pool spawns below (documented ordering: the
        // key resolves as a boot-time step ahead of SQLite migration) and
        // before any IPC handler can fire, so every storage secret path reads
        // the keyring-sourced key rather than a plaintext disk `.key`. On a
        // fresh install the key is born in the keyring; an existing plaintext
        // `.key` is imported into the keyring, verified, then retired; a
        // headless Linux / locked keychain falls back to the disk key
        // explicitly (ADR 0040). A boot that finds a healthy keyring *and* a
        // leftover disk `.key` retires that exposed key and re-encrypts
        // `connections.json` under a fresh one (#1814), reporting it via
        // `rekeyed_after_disk_exposure`. A key-lost fatal outcome logs and skips
        // seeding, so the decrypt path refuses (safe mode) instead of
        // orphaning ciphertext.
        match storage::boot_wire_master_key() {
            Ok(outcome) => info!(
                target: "boot",
                "key_migration wired: source={:?} fallback_to_disk={} rekeyed_after_disk_exposure={}",
                outcome.source, outcome.fallback_to_disk, outcome.rekeyed_after_disk_exposure
            ),
            Err(e) => tracing::error!(
                target: "boot",
                "key_migration failed to wire master key: {e}"
            ),
        }

        // Boot mismatch metric. Compares the
        // 4 dual-write domains (connections / favorites / mru / settings)
        // between file/LS SOT and SQLite mirror. The result is logged
        // (info on match, warn on drift) and the `mismatch_metric::counter`
        // atomic is bumped on drift. The metric is observation-only; it does
        // NOT itself recover drift. (#1092 — the `storage::reconcile` path is
        // not wired at boot and would replay stale/absent file SOT for the
        // SQLite-only domains; those persist_* commands now propagate write
        // failures to the IPC boundary instead of relying on reconcile.)
        //
        // Spawned as a detached task so a slow metric computation cannot
        // block the launcher's first paint. Best-effort: pool init failure
        // logs and bails.
        tauri::async_runtime::spawn(async {
            match commands::sqlite_pool::get_or_init_pool().await {
                Ok(pool) => {
                    if let Err(e) = storage::mismatch_metric::measure_all(&pool).await {
                        tracing::warn!(
                            target: "mismatch_metric",
                            "boot mismatch metric returned an error: {}",
                            e
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!(
                        target: "mismatch_metric",
                        "skipped boot mismatch metric — pool init failed: {}",
                        e
                    );
                }
            }
        });

        // F.5 — boot-time history retention vacuum. Reads the
        // `settings.query_history_retention_days` row and calls
        // `boot_vacuum_old_history(pool, days)`. Detached task — it never
        // blocks the user's first paint. On failure it only emits a
        // `tracing::warn`, never a toast. `tests/history_retention_31d.rs`
        // owns the e2e check of this wiring: it seeds a 30-day + 1-second row,
        // then asserts that row is gone after the vacuum while a 29-day row
        // survives.
        tauri::async_runtime::spawn(async {
            storage::history_retention_boot::boot_history_retention_vacuum().await;
        });

        // Boot-time `query_history.tab_id` invariant audit. Only
        // sidebar-prefetch may carry a NULL tab_id, so one or more rows
        // matching `tab_id IS NULL AND source != 'sidebar-prefetch'` means a
        // frontend caller regressed and elided tab_id. Q10 zero-telemetry —
        // one `tracing::error!` line, nothing user-visible. Detached task.
        tauri::async_runtime::spawn(async {
            storage::history_audit::boot_audit_history_tab_id_null().await;
        });

        // Boot-time legacy file cleanup. The `.legacy.json` 30-day retention
        // policy (strategy F.1 line 862) — files older than 30 days are
        // deleted silently. Nothing user-visible, no toast. Detached task —
        // it never blocks first paint.
        tauri::async_runtime::spawn(async {
            storage::legacy_cleanup::boot_legacy_file_cleanup().await;
        });

        // macOS-only native application menu (2026-05-01).
        //
        // macOS keeps the app process alive after every window has been
        // closed; the dock icon stays lit and the user expects File > New
        // Connection (Cmd+N) to bring the launcher back. The webview-side
        // keydown handler in `App.tsx` only fires when a webview has focus,
        // so it cannot serve this scenario. We register a native NSMenu
        // here and bridge the click into the existing `new-connection`
        // DOM event flow via a Tauri event.
        //
        // Windows/Linux take their menu from the per-window decoration
        // bar; reproducing that there would be a UI regression because
        // (a) the launcher is a 720×560 fixed window where a menu bar
        // would consume disproportionate vertical space, and (b) those
        // OSes terminate the app on last-window-close, so the "no window
        // open" scenario this menu fixes never arises. cfg-gated to
        // macOS.
        #[cfg(target_os = "macos")]
        {
            install_macos_menu(_app)?;
        }

        Ok(())
    });
    record_phase(&mut cursor, "setup-register");

    let builder = builder.on_page_load(|webview, payload| {
        if let Some(t0) = BOOT_T0.get() {
            let delta_ms = t0.elapsed().as_secs_f64() * 1000.0;
            info!(
                target: "boot",
                "rust:page-load label={} event={:?} delta_ms={:.3}",
                webview.label(),
                payload.event(),
                delta_ms
            );
        }
    });
    record_phase(&mut cursor, "page-load-register");

    let context = tauri::generate_context!();
    record_phase(&mut cursor, "generate-context");

    // Final mark before handing off to Tauri's run loop. Everything past
    // this point — window creation, WKWebView spawn, bundle parse, first
    // IPC service — is captured by the existing `rust:first-ipc` line in
    // `commands::connection::get_session_id`. The implied "builder-run →
    // rust:first-ipc" residual is `rust:first-ipc.delta_ms` minus the sum
    // of all phases above; the operator computes it offline from the
    // `[boot] phase=…` lines plus the `rust:first-ipc` line.
    record_phase(&mut cursor, "before-builder-run");

    // macOS picks up the dock-icon-clicked reopen path (and the menu's
    // Cmd+N restore path) by replacing the simpler `builder.run(context)`
    // with a `build` + `run(|handle, event| ...)` pair. The callback
    // observes `RunEvent::Reopen { has_visible_windows, .. }` and, when
    // every window has been closed (`has_visible_windows == false`),
    // brings the launcher back via the same lazy-build path the menu
    // event uses. Other OSes terminate the process when the last window
    // closes, so the original `.run(context)` is preserved there.
    #[cfg(target_os = "macos")]
    {
        let app = match builder.build(context) {
            Ok(app) => app,
            Err(e) => {
                tracing::error!(target: "boot", "failed to build Tauri application: {e}");
                eprintln!("[table-view] Failed to start: {e}");
                // #1620 F2 — flush the error line to the file sink before the
                // hard exit; `process::exit` would otherwise skip the guard's
                // drop and lose it.
                drop(log_guard.take());
                std::process::exit(1);
            }
        };

        app.run(|handle, event| {
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = event
            {
                if !has_visible_windows {
                    let h = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(e) = launcher::launcher_show(h).await {
                            tracing::warn!(
                                target: "menu",
                                "dock-reopen launcher_show failed: {}",
                                e
                            );
                        }
                    });
                }
            }
        });
    }

    #[cfg(not(target_os = "macos"))]
    if let Err(e) = builder.run(context) {
        tracing::error!(target: "boot", "failed to run Tauri application: {e}");
        eprintln!("[table-view] Failed to run: {e}");
        // #1620 F2 — flush the error line before the hard exit (see above).
        drop(log_guard.take());
        std::process::exit(1);
    }
}

/// macOS native menu installer (2026-05-01).
///
/// Builds an NSMenu with the macOS-standard layout — App / File / Edit /
/// View / Window — and registers a click handler that re-opens the
/// launcher and forwards `new-connection` to the frontend's existing DOM
/// event listener (`HomePage.tsx` / `Sidebar.tsx`).
///
/// `PredefinedMenuItem` is used wherever possible (Quit/Hide/Cut/Copy/
/// Paste/Minimize/etc.) so the items pick up macOS's native localized
/// titles and accelerators. The only custom item is `new_connection`,
/// keyed by id so `on_menu_event` can identify it.
#[cfg(target_os = "macos")]
fn install_macos_menu<R: tauri::Runtime>(
    app: &mut tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};

    let new_connection = MenuItemBuilder::with_id("new_connection", "New Connection…")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;

    // 2026-05-16 — Cmd+W is served by our own item.
    // `PredefinedMenuItem::close_window` goes through Tauri's generic close
    // route (the close-requested lifecycle plus the JS bindings), and that
    // route is the same listener-trap / silent no-op path as the earlier close
    // regression. Our own dispatcher reads the focused window's label directly
    // and branches — close the workspace, hide the launcher — which matches
    // the desired UX exactly.
    let close_focused_window = MenuItemBuilder::with_id("close_focused_window", "Close Window")
        .accelerator("CmdOrCtrl+W")
        .build(app)?;

    let app_submenu = SubmenuBuilder::new(app, "Table View")
        .item(&PredefinedMenuItem::about(
            app,
            Some("About Table View"),
            None,
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()?;

    let file_submenu = SubmenuBuilder::new(app, "File")
        .item(&new_connection)
        .separator()
        .item(&close_focused_window)
        .build()?;

    let edit_submenu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let window_submenu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        // Reuse the same item instance as the File menu, to avoid
        // `PredefinedMenuItem::close_window` going through the same close
        // lifecycle as the silent no-op path of the earlier regression.
        .item(&close_focused_window)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(|handle, event| {
        let id = event.id().0.clone();
        let handle = handle.clone();
        tauri::async_runtime::spawn(async move {
            match id.as_str() {
                "new_connection" => handle_menu_new_connection(handle).await,
                "close_focused_window" => handle_menu_close_focused(handle).await,
                _ => {}
            }
        });
    });

    Ok(())
}

/// Find the currently focused window's label, if any. Tauri 2.x exposes
/// `is_focused()` per webview; we iterate the registered windows looking for
/// the one the OS considers active. Returns `None` when nothing is focused
/// (e.g. user clicked away from the app entirely).
#[cfg(target_os = "macos")]
fn focused_window_label<R: tauri::Runtime>(handle: &tauri::AppHandle<R>) -> Option<String> {
    handle
        .webview_windows()
        .iter()
        .find_map(|(label, w)| match w.is_focused() {
            Ok(true) => Some(label.clone()),
            _ => None,
        })
}

/// Cmd+N dispatch (2026-05-16).
///
/// User journey:
///   1. A workspace is focused → open a raw query tab inside that workspace
///      (the "write a new query" signal).
///   2. The launcher is focused (visible) → the existing behaviour, which
///      emits the new-connection modal.
///   3. Every window is hidden (the user: "when all the windows are closed")
///      → show the launcher only, do not emit the modal. The user has to
///      press the + button to get the modal.
#[cfg(target_os = "macos")]
async fn handle_menu_new_connection<R: tauri::Runtime>(handle: tauri::AppHandle<R>) {
    let focused = focused_window_label(&handle);

    // (1) A workspace is focused → send the raw query tab signal to it.
    if let Some(label) = focused.as_ref() {
        if label.starts_with("workspace-") || label == "workspace" {
            if let Some(win) = handle.get_webview_window(label) {
                if let Err(e) = win.emit("menu:new-query-tab", ()) {
                    tracing::warn!(
                        target: "menu",
                        "menu:new-query-tab emit failed (label={label}): {e}"
                    );
                }
            }
            return;
        }
    }

    // (2) + (3) The launcher path. Branches on the launcher's visibility.
    let launcher_visible = handle
        .get_webview_window("launcher")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if let Err(e) = launcher::launcher_show(handle.clone()).await {
        tracing::warn!(target: "menu", "launcher_show failed: {e}");
        return;
    }

    if launcher_visible {
        // (2) The user is already looking at the launcher — emit the modal.
        if let Some(launcher) = handle.get_webview_window("launcher") {
            let _ = launcher.set_focus();
            if let Err(e) = launcher.emit("menu:new-connection", ()) {
                tracing::warn!(target: "menu", "menu:new-connection emit failed: {e}");
            }
        }
    } else {
        // (3) Every window is hidden → surface the launcher only. The modal
        // opens only on a follow-up user action (the + button), which avoids
        // popping a modal the user never asked for.
        tracing::info!(
            target: "menu",
            "Cmd+N with no visible window: surfacing launcher without modal emit"
        );
        if let Some(launcher) = handle.get_webview_window("launcher") {
            let _ = launcher.set_focus();
        }
    }
}

/// Cmd+W dispatch (2026-05-16).
///
/// User journey:
///   1. A workspace is focused → `Window::close()` on the backend, which
///      bypasses the silent no-op path of the JS API.
///   2. The launcher is focused → hide (the launcher-close = hide UX).
///   3. Nothing focused → no-op (the user clicked outside the app).
#[cfg(target_os = "macos")]
async fn handle_menu_close_focused<R: tauri::Runtime>(handle: tauri::AppHandle<R>) {
    let Some(label) = focused_window_label(&handle) else {
        tracing::warn!(target: "menu", "Cmd+W with no focused window");
        return;
    };
    let Some(win) = handle.get_webview_window(&label) else {
        tracing::warn!(target: "menu", "Cmd+W: focused window vanished (label={label})");
        return;
    };

    if label.starts_with("workspace-") || label == "workspace" {
        // #1101 — route through the close-requested lifecycle (`close()`,
        // NOT `destroy()`) so the workspace `CloseRequested` intercept in
        // `on_window_event` runs the unsaved-changes guard before anything
        // is destroyed. `destroy()` would skip that intercept and discard
        // pending edits.
        if let Err(e) = win.close() {
            tracing::warn!(target: "menu", "Cmd+W workspace.close failed (label={label}): {e}");
        } else {
            tracing::info!(target: "menu", "Cmd+W requested close for workspace label={label}");
        }
    } else if label == "launcher" {
        if let Err(e) = win.hide() {
            tracing::warn!(target: "menu", "Cmd+W launcher.hide failed: {e}");
        } else {
            tracing::info!(target: "menu", "Cmd+W hid launcher");
        }
    }
}

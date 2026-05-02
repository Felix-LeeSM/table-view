pub mod commands;
pub mod db;
pub mod error;
pub mod launcher;
pub mod models;
pub mod storage;

use commands::connection::AppState;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::{Emitter, Manager};
use tracing::info;

/// Sprint 175 — process-wide `Instant` captured at the very top of `run()`.
/// Every later "Tauri startup overhead" measurement (notably
/// `rust:first-ipc` in `commands::connection::get_session_id`) reads this
/// to compute its delta. Using `OnceLock` keeps the API allocation-free
/// after the first set and thread-safe without a mutex; subsequent
/// invocations of `run()` (which `tauri` does not actually do, but we are
/// defensive) keep the original `Instant`.
pub static BOOT_T0: OnceLock<Instant> = OnceLock::new();

/// Sprint 175 Sprint 2 — phase-breakdown helper. Emits a single
/// structured `info!` line on `target: "boot"` so the measurement
/// protocol (and `scripts/measure-startup.sh` once it learns the
/// `phase=` token) can grep deterministically for per-segment deltas
/// without depending on log line ordering.
///
/// Each call updates `cursor` to `now`, so the next call's delta is
/// "wall-clock time since the previous phase mark" rather than "since
/// `rust:entry`". This lets us attribute self-time to each phase even
/// when phases run sequentially on the same thread.
///
/// The instrumentation is permanent (not feature-gated). It is cheap by
/// construction — one `Instant::now()`, one `Duration::as_secs_f64()`,
/// and one `info!` formatter call per phase, well under 100µs of total
/// added overhead per cold boot. Sprint 1 set this same precedent for
/// `rust:entry` and `rust:first-ipc`.
fn record_phase(cursor: &mut Instant, phase: &'static str) {
    let now = Instant::now();
    let delta_ms = now.duration_since(*cursor).as_secs_f64() * 1000.0;
    info!(target: "boot", "phase={} delta_ms={:.3}", phase, delta_ms);
    *cursor = now;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Sprint 175 — `rust:entry` is the first observable timestamp on the
    // Rust side. Capture it BEFORE the subscriber init so the "Tauri
    // startup overhead" delta honestly includes subscriber bootstrap;
    // we won't print until the subscriber is alive a few microseconds
    // later.
    let entry = Instant::now();
    let _ = BOOT_T0.set(entry);

    // Without an explicit subscriber, every `tracing::info!` is dropped
    // on the floor. Default to RUST_LOG semantics ("info" minimum); honor
    // an env override so debugging-heavy sessions can opt into "debug" or
    // "trace" without a recompile. `try_init` so a re-entry (e.g. an
    // integration test that already installed a subscriber) is a no-op.
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(true)
        .try_init();

    // `info!` (NOT `debug!`) so the message survives a release build's
    // default log filter; `target: "boot"` so the protocol script can grep
    // for the literal token regardless of binary name.
    info!(target: "boot", "rust:entry t={:?}", BOOT_T0.get());

    // Sprint 175 Sprint 2 — phase breakdown. The `rust:entry → rust:first-ipc`
    // segment was 414ms median in the Sprint 1 debug baseline (~96% of the
    // user-perceived blank window). We slice it into named phases so the
    // operator's release-mode rebaseline can attribute self-time to each
    // segment WITHOUT requiring `cargo flamegraph` (which needs sudo on
    // macOS) or Instruments.app. The spec's AC-175-02-02 explicitly accepts
    // a `tracing`-instrumented run with named-segment deltas as the
    // lightest-weight option.
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

    let builder = tauri::Builder::default();
    record_phase(&mut cursor, "builder-default");

    let builder = builder.plugin(tauri_plugin_shell::init());
    record_phase(&mut cursor, "plugin-shell-init");

    let builder = builder.plugin(tauri_plugin_dialog::init());
    record_phase(&mut cursor, "plugin-dialog-init");

    let builder = builder.manage(AppState::new());
    record_phase(&mut cursor, "app-state-new");

    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::connection::list_connections,
        commands::connection::get_session_id,
        commands::connection::save_connection,
        commands::connection::delete_connection,
        commands::connection::test_connection,
        commands::connection::connect,
        commands::connection::disconnect,
        commands::connection::list_groups,
        commands::connection::save_group,
        commands::connection::delete_group,
        commands::connection::move_connection_to_group,
        commands::connection::export_connections,
        commands::connection::import_connections,
        commands::connection::export_connections_encrypted,
        commands::connection::import_connections_encrypted,
        commands::rdb::schema::list_schemas,
        commands::rdb::schema::list_tables,
        commands::rdb::schema::get_table_columns,
        commands::rdb::schema::list_schema_columns,
        commands::rdb::query::query_table_data,
        commands::rdb::schema::get_table_indexes,
        commands::rdb::schema::get_table_constraints,
        commands::rdb::ddl::drop_table,
        commands::rdb::ddl::rename_table,
        commands::rdb::ddl::alter_table,
        commands::rdb::ddl::create_index,
        commands::rdb::ddl::drop_index,
        commands::rdb::ddl::add_constraint,
        commands::rdb::ddl::drop_constraint,
        commands::rdb::schema::list_views,
        commands::rdb::schema::list_functions,
        commands::rdb::schema::get_view_definition,
        commands::rdb::schema::get_view_columns,
        commands::rdb::schema::get_function_source,
        commands::rdb::query::execute_query,
        commands::rdb::query::execute_query_batch,
        commands::rdb::query::cancel_query,
        commands::meta::list_databases,
        commands::meta::switch_active_db,
        commands::meta::verify_active_db,
        commands::document::browse::list_mongo_databases,
        commands::document::browse::list_mongo_collections,
        commands::document::browse::infer_collection_fields,
        commands::document::query::find_documents,
        commands::document::query::aggregate_documents,
        commands::document::mutate::insert_document,
        commands::document::mutate::update_document,
        commands::document::mutate::delete_document,
        commands::export::export_grid_rows,
        commands::export::write_text_file_export,
        commands::export::export_schema_dump,
        launcher::launcher_show,
        launcher::launcher_hide,
        launcher::launcher_focus,
        launcher::workspace_show,
        launcher::workspace_hide,
        launcher::workspace_focus,
        launcher::workspace_ensure,
        launcher::app_exit,
    ]);
    record_phase(&mut cursor, "invoke-handler-register");

    // Safety net: if the workspace window is destroyed (OS closed it
    // before the JS close-requested handler could prevent it), ensure
    // the launcher is visible so the user isn't left with no window.
    let builder = builder.on_window_event(|window, event| {
        if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "workspace" {
            if let Some(launcher) = window.app_handle().get_webview_window("launcher") {
                let _ = launcher.show();
            }
        }
    });
    record_phase(&mut cursor, "window-event-register");

    // Sprint 175 Sprint 2 — iteration 1.5 sub-instrumentation. The
    // iteration-1 phase breakdown showed Builder-internal phases sum to
    // ~15ms / ~1% of `rust:entry → rust:first-ipc` (1567ms median in
    // release-mode operator data). The remaining ~1552ms residual is in
    // the `.run()` interior — window creation, WKWebView spawn, bundle
    // delivery, JS parse, first IPC. Sprint 2 spec AC-175-02-02 forbids a
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
    //   the iteration-2 shrinkage target.
    //
    // The hooks themselves are cheap (one `Instant::elapsed` + one
    // `info!` per fire). Both stay permanent — Sprint 1 set the precedent
    // that boot instrumentation persists in production builds so future
    // sprints can re-baseline against the same emission shape.
    let builder = builder.setup(|app| {
        if let Some(t0) = BOOT_T0.get() {
            let delta_ms = t0.elapsed().as_secs_f64() * 1000.0;
            info!(target: "boot", "rust:setup-done delta_ms={:.3}", delta_ms);
        }

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
            install_macos_menu(app)?;
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
        let app = builder
            .build(context)
            .expect("error while building tauri application");

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
    builder
        .run(context)
        .expect("error while running tauri application");
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
        .item(&PredefinedMenuItem::close_window(app, None)?)
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
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_submenu)
        .item(&file_submenu)
        .item(&edit_submenu)
        .item(&window_submenu)
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(|handle, event| {
        if event.id().0 == "new_connection" {
            // Spawn so we can `.await` the launcher_show command without
            // blocking the menu-event dispatcher.
            let handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = launcher::launcher_show(handle.clone()).await {
                    tracing::warn!(
                        target: "menu",
                        "launcher_show failed before emit: {}",
                        e
                    );
                    return;
                }
                if let Some(launcher) = handle.get_webview_window("launcher") {
                    let _ = launcher.set_focus();
                    if let Err(e) = launcher.emit("menu:new-connection", ()) {
                        tracing::warn!(
                            target: "menu",
                            "menu:new-connection emit failed: {}",
                            e
                        );
                    }
                }
            });
        }
    });

    Ok(())
}

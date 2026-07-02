#![deny(unsafe_code)]

pub mod commands;
pub mod db;
pub mod error;
pub mod events;
pub mod launcher;
pub mod models;
pub mod state;
pub mod storage;

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
/// protocol (`memory/runbook/cold-boot/memory.md`) can grep
/// deterministically for per-segment deltas
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
    // narrative (Sprint 175) and should only change when that narrative
    // changes.
    let builder = tauri::Builder::default();
    record_phase(&mut cursor, "builder-default");

    let builder = builder.plugin(tauri_plugin_shell::init());
    record_phase(&mut cursor, "plugin-shell-init");

    let builder = builder.plugin(tauri_plugin_dialog::init());
    record_phase(&mut cursor, "plugin-dialog-init");

    // Sprint 362 (Phase 3, Q3) — single-instance plugin. The plugin's
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
    // Wave 9.5 회귀 7 (2026-05-17) — sprint-365 의 cross-window 이벤트 dispatcher
    // 가 commands 에서 inject 받을 수 있도록 `EventVersionRegistry` 도 process
    // singleton 으로 manage. 호출 site (`persist_setting` 등) 가 `State` 로 받음.
    let builder = builder.manage(events::EventVersionRegistry::default());
    record_phase(&mut cursor, "app-state-new");

    let builder = commands::registry::register_all(builder);
    record_phase(&mut cursor, "invoke-handler-register");

    // Safety net + sprint-363 launcher-close intercept.
    //
    // 1. Workspace destroyed: if the OS closes a workspace window before
    //    the JS close-requested handler could prevent it, ensure the
    //    launcher is visible so the user isn't left without any window.
    //
    // 2. Sprint 363 (Q13, strategy line 773) — Launcher CloseRequested:
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
                // Wave 9.5 회귀 1 (2026-05-16) — sprint-361 의 per-conn label
                // `workspace-{conn_id}` 도 매칭. 사용자 desired UX:
                // "모든 connection 창이 다 꺼지면 connections 창에 포커스가 몰리고".
                // 다른 workspace 가 살아있으면 launcher 는 hide 그대로 유지.
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
            _ => {}
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
    // `app` is only read by the macOS-only `install_macos_menu` call below, so
    // the `not(macos)` build sees an unused param; `_app` keeps it usable where
    // it is needed while satisfying `-D unused-variables` elsewhere.
    let builder = builder.setup(|_app| {
        if let Some(t0) = BOOT_T0.get() {
            let delta_ms = t0.elapsed().as_secs_f64() * 1000.0;
            info!(target: "boot", "rust:setup-done delta_ms={:.3}", delta_ms);
        }

        // Sprint 370 (Phase 4 W2→W3) — boot mismatch metric. Compares the
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

        // Sprint 373 (Phase 5 F.5) — boot-time history retention vacuum.
        // `settings.query_history_retention_days` row 를 read 해 sprint-371
        // 의 `boot_vacuum_old_history(pool, days)` 를 호출. detached task —
        // 사용자 first paint 블록 0. 실패 시 `tracing::warn` 만, toast 0.
        // 본 wiring 의 e2e 검증은 `tests/history_retention_31d.rs` 가
        // 30일 + 1초 row 시드 → vacuum 후 row 0 / 29일 row 유지로 책임.
        tauri::async_runtime::spawn(async {
            storage::history_retention_boot::boot_history_retention_vacuum().await;
        });

        // Sprint 375 (Phase 6 cleanup) — boot-time `query_history.tab_id`
        // invariant audit. sidebar-prefetch 만 NULL tab_id 를
        // 허용하므로, `tab_id IS NULL AND source != 'sidebar-prefetch'`
        // 인 row 가 1개 이상이면 frontend caller 가 tab_id 를 elide 한
        // 회귀가 있다. Q10 zero-telemetry — `tracing::error!` 한 줄만,
        // 사용자 visible surface 0. detached task.
        tauri::async_runtime::spawn(async {
            storage::history_audit::boot_audit_history_tab_id_null().await;
        });

        // Sprint 375 (Phase 6 cleanup) — boot-time legacy file cleanup.
        // W4 의 `.legacy.json` 30일 보관 정책 (strategy F.1 line 862) — 30일
        // 보다 오래된 파일을 silent delete. 사용자 visible 영향 0 (toast 없음).
        // detached task — first paint 블록 0.
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

    // Wave 9.5 회귀 5 (2026-05-16) — Cmd+W 를 우리 own item 으로 처리.
    // PredefinedMenuItem::close_window 는 Tauri 의 일반 close 경로 (close-requested
    // 라이프사이클 + JS bindings 의존) 를 거치는데, 그 path 가 sprint 회귀 4 의
    // listener trap / silent no-op 경로와 같다. 우리 own dispatcher 는 focused
    // window 의 라벨을 직접 확인 + workspace 는 destroy / launcher 는 hide 로
    // 분기 — desired UX 와 정확히 매칭.
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
        // Wave 9.5 회귀 5 — File 메뉴와 같은 item 인스턴스를 재사용.
        // PredefinedMenuItem::close_window 가 회귀 4 의 silent no-op path
        // 와 같은 close 라이프사이클을 거치는 회피 위함.
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

/// Wave 9.5 회귀 5 (2026-05-16) — Cmd+N dispatch.
///
/// User journey:
///   1. workspace 가 focused → 그 workspace 안에 raw query tab 열기
///      ("쿼리 새로 작성" 시그널, sprint-291 mental model)
///   2. launcher 가 focused (visible) → 기존 동작 (new connection modal emit)
///   3. 모든 창 hidden (사용자: "창 다 닫혀있을 때") → launcher show only,
///      modal emit 안 함. 사용자가 직접 + 버튼 눌러야 modal.
#[cfg(target_os = "macos")]
async fn handle_menu_new_connection<R: tauri::Runtime>(handle: tauri::AppHandle<R>) {
    let focused = focused_window_label(&handle);

    // (1) workspace focused → workspace 자체에 raw query tab signal
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

    // (2) + (3) launcher 경로. launcher 의 visibility 로 분기.
    let launcher_visible = handle
        .get_webview_window("launcher")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);

    if let Err(e) = launcher::launcher_show(handle.clone()).await {
        tracing::warn!(target: "menu", "launcher_show failed: {e}");
        return;
    }

    if launcher_visible {
        // (2) 사용자가 launcher 를 이미 보고 있는 상태 — modal 자동 emit.
        if let Some(launcher) = handle.get_webview_window("launcher") {
            let _ = launcher.set_focus();
            if let Err(e) = launcher.emit("menu:new-connection", ()) {
                tracing::warn!(target: "menu", "menu:new-connection emit failed: {e}");
            }
        }
    } else {
        // (3) 모든 창 hidden → launcher 만 surface. modal 은 사용자 후속
        // 행동 (+ 버튼) 으로만 열림 — 의도치 않은 modal 자동 노출 회피.
        tracing::info!(
            target: "menu",
            "Cmd+N with no visible window: surfacing launcher without modal emit"
        );
        if let Some(launcher) = handle.get_webview_window("launcher") {
            let _ = launcher.set_focus();
        }
    }
}

/// Wave 9.5 회귀 5 (2026-05-16) — Cmd+W dispatch.
///
/// User journey:
///   1. workspace focused → backend Window::destroy() (회귀 4 의 JS API
///      silent no-op path 우회).
///   2. launcher focused → hide (sprint-363 의 launcher-close = hide UX).
///   3. focused 없음 → no-op (user 가 app 밖 클릭한 상태).
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
        if let Err(e) = win.destroy() {
            tracing::warn!(target: "menu", "Cmd+W workspace.destroy failed (label={label}): {e}");
        } else {
            tracing::info!(target: "menu", "Cmd+W destroyed workspace label={label}");
        }
    } else if label == "launcher" {
        if let Err(e) = win.hide() {
            tracing::warn!(target: "menu", "Cmd+W launcher.hide failed: {e}");
        } else {
            tracing::info!(target: "menu", "Cmd+W hid launcher");
        }
    }
}

pub mod commands;
pub mod db;
pub mod error;
pub mod launcher;
pub mod models;
pub mod storage;

use commands::connection::AppState;
use std::sync::OnceLock;
use std::time::Instant;
use tauri::Manager;
use tracing::info;

/// Sprint 175 — process-wide `Instant` captured at the very top of `run()`.
/// Every later "Tauri startup overhead" measurement (notably
/// `rust:first-ipc` in `commands::connection::get_session_id`) reads this
/// to compute its delta. Using `OnceLock` keeps the API allocation-free
/// after the first set and thread-safe without a mutex; subsequent
/// invocations of `run()` (which `tauri` does not actually do, but we are
/// defensive) keep the original `Instant`.
pub static BOOT_T0: OnceLock<Instant> = OnceLock::new();

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Sprint 175 — `rust:entry` is the first observable timestamp on the
    // Rust side. Capture it BEFORE the subscriber init so the "Tauri
    // startup overhead" delta honestly includes subscriber bootstrap;
    // we won't print until the subscriber is alive a few microseconds
    // later.
    let _ = BOOT_T0.set(Instant::now());

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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
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
            launcher::launcher_show,
            launcher::launcher_hide,
            launcher::launcher_focus,
            launcher::workspace_show,
            launcher::workspace_hide,
            launcher::workspace_focus,
            launcher::workspace_ensure,
            launcher::app_exit,
        ])
        // Safety net: if the workspace window is destroyed (OS closed it
        // before the JS close-requested handler could prevent it), ensure
        // the launcher is visible so the user isn't left with no window.
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) && window.label() == "workspace" {
                if let Some(launcher) = window.app_handle().get_webview_window("launcher") {
                    let _ = launcher.show();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

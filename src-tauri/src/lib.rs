pub mod commands;
pub mod db;
pub mod error;
pub mod launcher;
pub mod models;
pub mod storage;

use commands::connection::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::connection::list_connections,
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

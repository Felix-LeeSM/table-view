pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod storage;

use commands::connection::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            commands::schema::list_schemas,
            commands::schema::list_tables,
            commands::schema::get_table_columns,
            commands::schema::query_table_data,
            commands::schema::get_table_indexes,
            commands::schema::get_table_constraints,
            commands::schema::drop_table,
            commands::schema::rename_table,
            commands::query::execute_query,
            commands::query::cancel_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

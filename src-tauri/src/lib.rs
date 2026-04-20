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
            commands::connection::export_connections,
            commands::connection::import_connections,
            commands::schema::list_schemas,
            commands::schema::list_tables,
            commands::schema::get_table_columns,
            commands::schema::query_table_data,
            commands::schema::get_table_indexes,
            commands::schema::get_table_constraints,
            commands::schema::drop_table,
            commands::schema::rename_table,
            commands::schema::alter_table,
            commands::schema::create_index,
            commands::schema::drop_index,
            commands::schema::add_constraint,
            commands::schema::drop_constraint,
            commands::schema::list_views,
            commands::schema::list_functions,
            commands::schema::get_view_definition,
            commands::schema::get_view_columns,
            commands::schema::get_function_source,
            commands::query::execute_query,
            commands::query::cancel_query,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

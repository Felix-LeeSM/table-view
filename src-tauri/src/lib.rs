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
            commands::document::browse::list_mongo_databases,
            commands::document::browse::list_mongo_collections,
            commands::document::browse::infer_collection_fields,
            commands::document::query::find_documents,
            commands::document::query::aggregate_documents,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

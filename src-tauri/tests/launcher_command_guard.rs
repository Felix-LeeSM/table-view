//! Issue #1584 — backend grep CI guard for the window-label command guard.
//!
//! Tauri v2 ACL does not gate app-defined commands, so the runtime
//! `guard::guard_not_launcher` (guard.rs) is the only thing stopping the
//! launcher webview from invoking destructive DB commands. This grep test
//! keeps that guard exhaustive: every `#[tauri::command]` in the backend must
//! be classified as either
//!   - GUARDED — a sensitive/destructive command whose body MUST call
//!     `guard_not_launcher`, or
//!   - LAUNCHER_ALLOWLIST — a command the launcher legitimately uses
//!     (connection CRUD/list, snapshot, persist_*, window lifecycle, sqlite
//!     file creation, updater) or a non-destructive read.
//!
//! A new command that is in neither set fails the build, forcing an explicit
//! security decision. A GUARDED command missing the guard call also fails.
//! Mirrors the AC-355-07 pattern in `guard_grep.rs`.

use std::fs;
use std::path::PathBuf;

/// Sensitive/destructive commands: destructive DDL, arbitrary/DML execution,
/// document/kv/search mutation, export/exfil + file import, process kill, and
/// DuckDB file-analytics register/execute/clear. Each MUST call
/// `guard_not_launcher(window.label())`.
const GUARDED: &[&str] = &[
    // DDL
    "add_column",
    "add_constraint",
    "alter_table",
    "create_index",
    "create_rdb_database",
    "create_table",
    "create_table_plan",
    "create_trigger",
    "drop_column",
    "drop_constraint",
    "drop_index",
    "drop_rdb_database",
    "drop_table",
    "drop_trigger",
    "rename_table",
    // Arbitrary / DML execution
    "execute_query",
    "execute_query_batch",
    "execute_query_dry_run",
    // Document mutation + schema
    "aggregate_documents", // pipeline stages `$out` / `$merge` write to a collection
    "bulk_write_documents",
    "create_collection",
    "create_mongo_index",
    "delete_document",
    "delete_many",
    "drop_collection",
    "drop_mongo_database",
    "drop_mongo_index",
    "insert_document",
    "insert_many_documents",
    "rename_collection",
    "run_mongo_command",
    "set_mongo_validator",
    "update_document",
    "update_many",
    // KV mutation
    "delete_kv_key",
    "execute_kv_command",
    "set_kv_string_value",
    "update_kv_ttl",
    // Search destructive
    "execute_search_delete_by_query",
    "plan_search_delete_by_query",
    // Export / exfil + file import
    "export_grid_abort",
    "export_grid_begin",
    "export_grid_chunk",
    "export_grid_finish",
    "export_grid_rows",
    "export_schema_dump",
    "preview_csv_import",
    "read_text_file_import",
    "write_text_file_export",
    // Destructive metadata
    "kill_server_activity",
    // DuckDB file analytics (fs access + arbitrary DuckDB execution)
    "duckdb_clear_file_analytics_sources",
    "duckdb_execute_file_analytics_query",
    "duckdb_register_file_analytics_source",
];

/// Commands the launcher legitimately uses, plus non-destructive reads/lifecycle
/// that carry no exfil/mutation risk. Explicitly exempt from the guard.
const LAUNCHER_ALLOWLIST: &[&str] = &[
    // Connection CRUD / list / lifecycle (the launcher IS the connection manager)
    "connect",
    "disconnect",
    "delete_connection",
    "delete_group",
    "export_connections",
    "export_connections_encrypted",
    "import_connections",
    "import_connections_encrypted",
    "list_connections",
    "list_groups",
    "move_connection_to_group",
    "save_connection",
    "save_group",
    "test_connection",
    "get_session_id",
    "create_sqlite_database_file",
    // Boot / snapshot / persistence of local app state
    "get_initial_app_state",
    "import_legacy_localstorage",
    "set_keyring_fallback_dismissed",
    "persist_connection",
    "persist_favorites",
    "persist_mru",
    "clear_mru",
    "persist_setting",
    "reset_setting",
    "get_setting",
    "list_favorites",
    "persist_snippets",
    "list_snippets",
    "persist_table_activity",
    "list_table_activity",
    "persist_workspace",
    "set_datagrid_prefs",
    "get_datagrid_prefs",
    "reset_datagrid_prefs",
    "set_group_collapsed",
    "get_meta_sentinel",
    "set_meta_sentinel",
    "add_history_entry",
    "list_history",
    "get_history_detail",
    "clear_history",
    // Query lifecycle (cancel/pid) — safe
    "cancel_query",
    "cancel_query_native",
    "get_query_server_pid",
    "release_tab_connection",
    // Window lifecycle + updater
    "launcher_show",
    "launcher_hide",
    "launcher_focus",
    "workspace_show",
    "workspace_hide",
    "workspace_focus",
    "workspace_ensure",
    "workspace_close",
    "app_exit",
    "updater_can_self_install",
    "open_workspace_window",
    // Session/db switch (non-destructive)
    "switch_active_db",
    "verify_active_db",
    "list_databases",
    "switch_kv_database",
    "current_kv_database",
    // Non-destructive reads (schema / catalog / data / monitoring)
    "list_schemas",
    "list_tables",
    "get_table_columns",
    "list_schema_columns",
    "query_table_data",
    "count_null_rows",
    "get_table_indexes",
    "get_table_constraints",
    "list_views",
    "list_functions",
    "get_view_definition",
    "get_view_columns",
    "get_function_source",
    "list_triggers",
    "get_trigger_source",
    "list_postgres_types",
    "list_postgres_extensions",
    "list_sqlite_capabilities",
    "pg_search_values",
    "explain_rdb_query",
    "explain_mongo_find",
    "collection_stats_rdb",
    "collection_stats_mongo",
    "server_info",
    "slow_queries",
    "list_database_users",
    "list_server_activity",
    "duckdb_preview_file_analytics_source",
    "duckdb_list_file_analytics_source_metadata",
    "list_kv_databases",
    "scan_kv_keys",
    "get_kv_value",
    "read_kv_stream",
    "list_search_catalog_summary",
    "get_search_index_mapping",
    "get_search_index_settings",
    "list_search_index_templates",
    "sample_search_documents",
    "get_search_index_field_stats",
    "execute_search_query",
    "list_mongo_databases",
    "list_mongo_collections",
    "infer_collection_fields",
    "list_mongo_indexes",
    "get_mongo_validator",
    "find_documents",
    "find_one_document",
    "count_documents",
    "estimated_document_count",
    "distinct_documents",
    "parse_sql_backend",
    // Diagnostics — reveal the local rotating log folder in the OS file
    // explorer (#1566). Non-destructive (opens a read-only support artifact,
    // no DB access / exfil) and invoked from the launcher's HomePage footer,
    // so it MUST be allow-listed — the guard is fail-closed for the launcher.
    "open_log_dir",
];

fn src_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src")
}

fn collect_rs_files(root: &PathBuf, acc: &mut Vec<PathBuf>) {
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                collect_rs_files(&path, acc);
            } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
                acc.push(path);
            }
        }
    }
}

/// One collected command: its handler name and the source block from its
/// `#[tauri::command]` attribute up to the next command (or end of file).
struct Command {
    name: String,
    block: String,
}

/// The leading Rust identifier of `text` (stops at `<`, `(`, whitespace, etc.),
/// so `open_workspace_window<R: Runtime>(` yields `open_workspace_window`.
fn leading_ident(text: &str) -> String {
    text.chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect()
}

/// Scan `src/commands/` and `src/launcher.rs` for every real `#[tauri::command]`
/// attribute (a line that is exactly the attribute — not the string appearing
/// inside a doc comment) and the handler that follows it.
fn collect_commands() -> Vec<Command> {
    let mut files = Vec::new();
    collect_rs_files(&src_dir().join("commands"), &mut files);
    files.push(src_dir().join("launcher.rs"));

    let mut commands = Vec::new();
    for path in &files {
        let content = match fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let lines: Vec<&str> = content.lines().collect();
        // `starts_with` (not exact `==`) so an argument-form attribute like
        // `#[tauri::command(rename_all = ...)]` is still counted, not silently
        // skipped. A doc comment mentioning the macro trims to `//! ...`, so it
        // never matches.
        let marker_lines: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.trim_start().starts_with("#[tauri::command"))
            .map(|(i, _)| i)
            .collect();

        for (idx, &line_no) in marker_lines.iter().enumerate() {
            // Handler name: first `fn ` within the few lines after the attribute
            // (skips any intervening attributes / generics on their own line).
            let mut name = String::new();
            for candidate in lines.iter().skip(line_no + 1).take(8) {
                if let Some(pos) = candidate.find("fn ") {
                    name = leading_ident(candidate[pos + 3..].trim_start());
                    break;
                }
            }
            if name.is_empty() {
                continue;
            }
            // Block used for the guard-presence check: this attribute up to the
            // next `#[tauri::command]` attribute (or end of file).
            let block_end = marker_lines.get(idx + 1).copied().unwrap_or(lines.len());
            let block = lines[line_no..block_end].join("\n");
            commands.push(Command { name, block });
        }
    }
    commands
}

#[test]
fn guard_helper_symbol_exists() {
    let path = src_dir().join("commands/guard.rs");
    let content = fs::read_to_string(&path).expect("commands/guard.rs must exist");
    assert!(
        content.contains("pub fn guard_not_launcher"),
        "guard.rs must define `pub fn guard_not_launcher` (issue #1584 window-label guard)"
    );
}

#[test]
fn every_command_is_classified_and_guarded() {
    let commands = collect_commands();
    assert!(
        commands.len() >= 150,
        "expected the full command surface (~165), collected {} — the collector likely broke",
        commands.len()
    );

    let guarded: std::collections::HashSet<&str> = GUARDED.iter().copied().collect();
    let allowed: std::collections::HashSet<&str> = LAUNCHER_ALLOWLIST.iter().copied().collect();

    // Partition must be disjoint.
    let overlap: Vec<&str> = GUARDED
        .iter()
        .copied()
        .filter(|c| allowed.contains(c))
        .collect();
    assert!(
        overlap.is_empty(),
        "commands must not be in both GUARDED and LAUNCHER_ALLOWLIST: {overlap:?}"
    );

    let mut failures: Vec<String> = Vec::new();
    for cmd in &commands {
        let in_guarded = guarded.contains(cmd.name.as_str());
        let in_allowed = allowed.contains(cmd.name.as_str());

        if !in_guarded && !in_allowed {
            failures.push(format!(
                "`{}` is an unclassified #[tauri::command] — add it to GUARDED \
                 (and call `guard_not_launcher(window.label())`) if it is \
                 sensitive/destructive, or to LAUNCHER_ALLOWLIST if the launcher \
                 legitimately needs it (issue #1584).",
                cmd.name
            ));
            continue;
        }

        if in_guarded && !cmd.block.contains("guard_not_launcher") {
            failures.push(format!(
                "`{}` is GUARDED but its handler does not call `guard_not_launcher` — \
                 add the injected `window: tauri::Window` param and \
                 `crate::commands::guard::guard_not_launcher(window.label())?` on the \
                 first line (issue #1584).",
                cmd.name
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "launcher command guard violations:\n  {}",
        failures.join("\n  ")
    );
}

#[test]
fn classification_lists_have_no_stale_entries() {
    let names: std::collections::HashSet<String> =
        collect_commands().into_iter().map(|c| c.name).collect();
    let mut stale: Vec<&str> = GUARDED
        .iter()
        .chain(LAUNCHER_ALLOWLIST.iter())
        .copied()
        .filter(|c| !names.contains(*c))
        .collect();
    stale.sort_unstable();
    assert!(
        stale.is_empty(),
        "GUARDED/LAUNCHER_ALLOWLIST reference commands that no longer exist \
         (remove them): {stale:?}"
    );
}

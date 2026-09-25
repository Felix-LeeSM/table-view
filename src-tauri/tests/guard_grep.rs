//! Written 2026-05-16 — AC-355-07 grep CI.
//!
//! Strategy 1222: "backend grep CI: when a `#[tauri::command]` function mutates
//! the A/C domain, `state.guard_legacy_import_done()?` must be on the first line
//! of the function."
//!
//! This grep checks three things:
//!
//!   1. The `guard::guard_legacy_import_done` symbol is findable in the src tree
//!      (fails if the helper itself disappears).
//!   2. The file-based A/C mutate handlers listed below still do not call the
//!      guard.
//!   3. The three scanned files (`import_legacy.rs`, `guard.rs`,
//!      `sqlite_pool.rs`) declare exactly one `#[tauri::command]`,
//!      `import_legacy_localstorage` — the transition IPC itself, which is
//!      exempt from the guard.

use std::fs;
use std::path::PathBuf;

/// Recursively collect every `.rs` file under the `src-tauri/src/commands/` tree.
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

fn commands_dir() -> PathBuf {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    PathBuf::from(manifest_dir).join("src/commands")
}

// AC-355-07: the helper symbol is exported from the src tree. This test breaks
// the moment the helper is removed or renamed — the foundation of the guard's
// grep CI rule.
#[test]
fn test_guard_helper_symbol_exists() {
    let path = commands_dir().join("guard.rs");
    let content = fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "commands/guard.rs 가 존재해야 함 (AC-355-07): {} — {}",
            path.display(),
            e
        )
    });
    assert!(
        content.contains("pub async fn guard_legacy_import_done"),
        "guard.rs 에 pub async fn guard_legacy_import_done 가 정의되어야 함"
    );
}

// AC-355-07 — the A/C mutate IPC list is defined at strategy line 1194–1216.
//
// The handlers checked here are the file-based half of that domain: they keep
// writing the file store instead of the SQLite one, so they must not call the
// guard. The assertion fails the moment one of them starts calling it.
#[test]
fn test_no_premature_guard_call_in_existing_mutate_ipc() {
    // Existing A/C mutate IPC (file-based) — these are expected NOT to call
    // the guard, per the invariant "zero regression in the existing file-based
    // connections.json / LS behavior" (contract Invariants).
    let existing_ac_mutate_handlers = [
        ("connection/crud.rs", "save_connection"),
        ("connection/crud.rs", "delete_connection"),
        ("connection/groups.rs", "save_group"),
        ("connection/groups.rs", "delete_group"),
        ("connection/groups.rs", "move_connection_to_group"),
    ];

    for (file, fn_name) in existing_ac_mutate_handlers {
        let path = commands_dir().join(file);
        let content = fs::read_to_string(&path).unwrap_or_else(|_| String::new());
        // Find the function body and verify it does NOT call guard yet.
        if let Some(start) = content.find(&format!("fn {}(", fn_name)) {
            // Naive: scan the next ~3000 bytes (function body) for the symbol.
            let end = (start + 3000).min(content.len());
            let body = &content[start..end];
            assert!(
                !body.contains("guard_legacy_import_done"),
                "{}::{} must NOT call guard_legacy_import_done in sprint-355 \
                 (file-based domain stays file-based until sprint-358)",
                file,
                fn_name
            );
        }
    }
}

// AC-355-07 invariant: collect every #[tauri::command] in commands/ tree.
// The scanned files declare exactly one #[tauri::command],
// `import_legacy_localstorage`. Adding any other mutate IPC to them fails this
// test.
#[test]
fn test_only_one_new_tauri_command_in_sprint_355() {
    let mut files = Vec::new();
    collect_rs_files(&commands_dir(), &mut files);

    let mut found_new_in_355: Vec<String> = Vec::new();
    for path in &files {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // Scan only these files and treat their #[tauri::command] decorators
        // as the new ones.
        if name == "import_legacy.rs" || name == "guard.rs" || name == "sqlite_pool.rs" {
            let content = fs::read_to_string(path).unwrap();
            for (idx, line) in content.lines().enumerate() {
                if line.trim().starts_with("#[tauri::command]") {
                    // Look for the next `pub async fn ...(` or `pub fn ...(`.
                    let after: String = content
                        .lines()
                        .skip(idx + 1)
                        .take(5)
                        .collect::<Vec<_>>()
                        .join("\n");
                    if let Some(fn_start) = after.find("fn ") {
                        let rest = &after[fn_start + 3..];
                        if let Some(paren) = rest.find('(') {
                            found_new_in_355.push(rest[..paren].trim().to_string());
                        }
                    }
                }
            }
        }
    }

    assert_eq!(
        found_new_in_355,
        vec!["import_legacy_localstorage".to_string()],
        "sprint-355 must add exactly ONE new #[tauri::command]; got {:?}",
        found_new_in_355
    );
}

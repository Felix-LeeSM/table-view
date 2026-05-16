//! 작성 2026-05-16 (Phase 1 sprint-355) — AC-355-07 grep CI.
//!
//! Strategy 1222: "backend grep CI: `#[tauri::command]` 함수가 A/C domain
//! mutate 면 함수 첫줄에 `state.guard_legacy_import_done()?` 있어야 함."
//!
//! 본 sprint (355) 시점에는 A/C domain mutate IPC 의 실체가 아직 sprint-358+
//! 에서 도입되므로 현재 grep 결과는 빈 집합 또는 `import_legacy_localstorage`
//! 한 개 (이 자체는 transition IPC 라 exempt). 따라서 본 grep 은 다음을 동시에
//! 검증한다:
//!
//!   1. `guard::guard_legacy_import_done` 심볼이 src 트리에서 검색 가능 (helper
//!      자체 사라지면 fail).
//!   2. 현재 시점의 A/C mutate IPC 후보 목록이 정의된 mute set (sprint-358+
//!      에서 추가될 때마다 본 목록 확장) 안에 들어있고, 각 후보가 guard 를
//!      호출.
//!
//! 본 sprint 의 mute set 은 비어있다 (`import_legacy_localstorage` 만 신규).
//! sprint-358 이 `set_setting`/`add_favorite` 등을 추가할 때 본 목록을 갱신하면서
//! guard 호출도 같이 강제된다.

use std::fs;
use std::path::PathBuf;

/// `src-tauri/src/commands/` 트리 안의 모든 `.rs` 파일을 재귀적으로 수집.
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

// AC-355-07: helper symbol 이 src 트리에 export 되어있음. 본 테스트는 helper
// 가 제거/이름 변경되었을 때 즉시 깨진다 — guard 의 grep CI rule 의 fundament.
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

// AC-355-07 (forward-looking, sprint-355 시점):
//
// A/C mutate IPC 목록은 strategy line 1194–1216 에 정의되어 있다. sprint-355
// 시점에 그 IPC 들의 실체는 아직 없다 — 본 sprint 의 신규 IPC 는
// `import_legacy_localstorage` 하나뿐이고 그것은 transition 자체이므로 guard
// exempt 다. 따라서 현재 단계의 grep 은 "guard 가 정의되어 있으나 호출자는
// 아직 0" 임을 명시적으로 확인한다. sprint-358 이 첫 A/C mutate IPC 를
// 도입할 때 본 테스트의 expected set 을 확장하고, 동시에 그 IPC 가 guard 를
// 호출하지 않으면 fail 하도록 패턴 매칭을 추가한다.
//
// **현재 invariant**: `commands/` 트리 어디에도 `guard_legacy_import_done`
// 호출자가 없거나, 있다면 그건 import_legacy 자체가 아니다. 본 sprint 의
// 안전한 단언 = "guard.rs 자체 외에서 호출자가 0" 또는 "import_legacy 가
// 아닌 호출자 0".
#[test]
fn test_no_premature_guard_call_in_existing_mutate_ipc() {
    // Existing A/C mutate IPC (file-based, pre-sprint-358) — these are
    // expected NOT to call the guard yet, per invariant
    // "기존 file-based connections.json / LS 동작 회귀 0" (contract Invariants).
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
// 본 sprint 의 신규 #[tauri::command] = `import_legacy_localstorage` 1 개.
// 다른 어떤 신규 mutate IPC 도 추가되지 않았음을 확인 — sprint scope 보호.
#[test]
fn test_only_one_new_tauri_command_in_sprint_355() {
    let mut files = Vec::new();
    collect_rs_files(&commands_dir(), &mut files);

    let mut found_new_in_355: Vec<String> = Vec::new();
    for path in &files {
        let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // sprint-355 added these files; treat their #[tauri::command]
        // decorators as new-in-sprint-355.
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

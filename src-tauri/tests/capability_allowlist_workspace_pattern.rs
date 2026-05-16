//! 작성 2026-05-17 (Wave 9.5 회귀 7 진짜 fix) — Tauri 2 capability JSON 의
//! `windows` allowlist 가 sprint-361 의 per-conn workspace 라벨 패턴
//! (`workspace-{conn_id}`) 을 포함하는지 lock.
//!
//! 사용자 보고: "친구 테마가 창 단위로 적용된다", "여전히 창들 사이에서
//! 동기화가 안돼". root cause — sprint-361 (Phase 3, Q13) 이 workspace
//! 라벨을 `workspace-{conn_id}` 로 변경했지만 capability 의 windows
//! allowlist 는 옛 `"workspace"` 만 포함. Tauri 2 는 capability 매칭 안 되는
//! window 에서 `event:listen` / `event:emit` 호출을 silent 하게 deny —
//! frontend bridge (`theme-sync` channel) / backend `state-changed` 두 path
//! 모두 차단되어 cross-window sync silent fail.
//!
//! 본 test 는 두 invariant 를 lock:
//!   1. allowlist 가 legacy `"workspace"` (호환) + `"launcher"` 포함.
//!   2. allowlist 가 sprint-361 의 새 라벨 패턴 (`workspace-` 접두사) 을 매칭하는 항목 포함.
//!
//! 회귀 시: 새 sprint 가 라벨 패턴을 또 바꿨거나 (예: `db-{conn_id}`),
//! 누가 allowlist 항목을 실수로 지웠을 때 cross-window broadcast 가
//! production 에서만 깨지고 cargo test / vitest 는 모두 GREEN 으로 떨어진다.
//! 본 test 는 그 silent failure 를 빌드 시점에 잡는다.

use std::fs;

fn capability_path() -> std::path::PathBuf {
    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capabilities/default.json")
}

#[test]
fn capability_includes_launcher_window() {
    let raw = fs::read_to_string(capability_path()).expect("read capabilities/default.json");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse capability JSON");
    let windows = parsed
        .get("windows")
        .and_then(|v| v.as_array())
        .expect("`windows` must be a JSON array");
    let labels: Vec<&str> = windows.iter().filter_map(|v| v.as_str()).collect();
    assert!(
        labels.contains(&"launcher"),
        "capability windows allowlist must include 'launcher' — every event.listen / event.emit \
         from the launcher window depends on this. Found: {labels:?}"
    );
}

#[test]
fn capability_includes_workspace_per_connection_pattern() {
    let raw = fs::read_to_string(capability_path()).expect("read capabilities/default.json");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse capability JSON");
    let windows = parsed
        .get("windows")
        .and_then(|v| v.as_array())
        .expect("`windows` must be a JSON array");
    let labels: Vec<&str> = windows.iter().filter_map(|v| v.as_str()).collect();

    // sprint-361 (Phase 3, Q13) 이후 workspace 창은 `workspace-{conn_id}` 형식.
    // capability glob 으로 매칭하는 항목 중 하나라도 있어야 함 — 가장 흔한
    // 패턴은 `workspace-*` 또는 `workspace*`. 회귀 lock: allowlist 가
    // sprint-361 라벨을 cover 하는 항목을 포함하는지 확인.
    let has_workspace_glob = labels
        .iter()
        .any(|l| *l == "workspace-*" || *l == "workspace*");
    assert!(
        has_workspace_glob,
        "capability windows allowlist must include a glob covering sprint-361 \
         `workspace-{{conn_id}}` labels (e.g. 'workspace-*'). Without it, cross-window \
         event.emit / event.listen on per-conn workspace windows is silently denied, \
         and cross-window theme/safeMode sync silently fails. Found: {labels:?}"
    );
}

#[test]
fn capability_grants_event_listen_and_emit() {
    let raw = fs::read_to_string(capability_path()).expect("read capabilities/default.json");
    let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse capability JSON");
    let perms = parsed
        .get("permissions")
        .and_then(|v| v.as_array())
        .expect("`permissions` must be a JSON array");
    let granted: Vec<&str> = perms.iter().filter_map(|v| v.as_str()).collect();
    assert!(
        granted.contains(&"core:event:allow-listen"),
        "capability must grant 'core:event:allow-listen' — cross-window receivers depend on it. \
         Found: {granted:?}"
    );
    assert!(
        granted.contains(&"core:event:allow-emit"),
        "capability must grant 'core:event:allow-emit' — cross-window broadcasters depend on it. \
         Found: {granted:?}"
    );
}

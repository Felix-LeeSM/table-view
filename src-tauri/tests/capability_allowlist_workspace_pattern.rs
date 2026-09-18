//! Written 2026-05-17 — locks that the `windows` allowlist of the Tauri 2
//! capability JSON covers the per-conn workspace label pattern
//! (`workspace-{conn_id}`).
//!
//! User reports: "a friend's theme applies per window", "the windows still do
//! not sync with each other". Root cause — the workspace label changed to
//! `workspace-{conn_id}` (Q13) while the capability's windows allowlist still
//! held only the old `"workspace"`. Tauri 2 silently denies `event:listen` /
//! `event:emit` calls from a window that matches no capability, so both paths —
//! the frontend bridge (`theme-sync` channel) and the backend `state-changed` —
//! were blocked and cross-window sync failed silently.
//!
//! This test locks two invariants:
//!   1. The allowlist contains `"launcher"`, next to the legacy `"workspace"`
//!      kept for compatibility.
//!   2. The allowlist contains an entry matching the `workspace-` prefix label
//!      pattern.
//!
//! On regression: if the label pattern changes again (say to `db-{conn_id}`), or
//! somebody deletes an allowlist entry by accident, cross-window broadcast
//! breaks in production only, while cargo test / vitest both come out GREEN.
//! This test catches that silent failure at build time.

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

    // Since Q13 a workspace window carries a `workspace-{conn_id}` label.
    // At least one entry must match it through a capability glob — the common
    // patterns are `workspace-*` or `workspace*`. Regression lock: check that
    // the allowlist holds an entry covering that label.
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

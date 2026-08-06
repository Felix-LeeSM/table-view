//! 앱 쪽 `storage` shim (#1769).
//!
//! 저장소 본체는 `table_view_core::storage` 로 내려갔다. 여기 남는 두 모듈은
//! boot 글루라서 `crate::commands::` 를 역참조한다 — core 로 내리려면 trait
//! 주입으로 방향을 뒤집어야 하고, 그 값어치가 없다고 판단해 앱에 남겼다.
//!
//! glob re-export 덕에 `crate::storage::local::…` 같은 기존 경로와
//! `table_view_lib::storage::history_audit::…` 를 쓰는 통합 테스트가 그대로
//! 산다.

pub use table_view_core::storage::*;

pub mod history_audit;
pub mod history_retention_boot;

#[cfg(test)]
mod tests {
    /// #2184 — `table-view-core` honors `TABLE_VIEW_TEST_DATA_DIR` when
    /// `feature = "testing"` is on, which is how release *test* builds isolate
    /// themselves. The #1454 property that a shipped binary can never be
    /// redirected therefore rests on one fact: that feature reaches this crate
    /// through `[dev-dependencies]` only, so resolver v2 keeps it out of
    /// `cargo build --release` / `cargo tauri build`.
    ///
    /// Moving the `features = ["testing"]` list onto the `[dependencies]` entry
    /// would arm the override in the shipped app and reopen #1454, silently — the
    /// app would still build and still pass every test. Nothing but this
    /// assertion notices. It reads the manifest rather than trusting the comment
    /// there, and the same edit would also drag `db::testing`'s stub adapters
    /// into the release binary.
    ///
    /// Live check of the same fact:
    /// `cargo tree --manifest-path src-tauri/Cargo.toml -e features -i table-view-core --edges normal`
    #[test]
    fn app_manifest_never_enables_core_testing_feature_in_normal_deps() {
        let manifest = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"),
        )
        .expect("src-tauri/Cargo.toml must be readable");

        let mut section = String::new();
        let mut offenders = Vec::new();
        for line in manifest.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                section = trimmed.trim_matches(['[', ']']).to_string();
                continue;
            }
            if trimmed.starts_with('#') || !trimmed.starts_with("table-view-core") {
                continue;
            }
            if trimmed.contains("\"testing\"") && section != "dev-dependencies" {
                offenders.push(format!("[{section}] {trimmed}"));
            }
        }

        assert!(
            offenders.is_empty(),
            "the core `testing` feature must stay a dev-dependency: it switches on the \
             TABLE_VIEW_TEST_DATA_DIR override, so enabling it for a normal build ships a \
             binary an attacker can redirect (#1454, #2184). Found: {offenders:?}"
        );
    }
}

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

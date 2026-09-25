//! Shared test helpers for `commands/**` `mod tests` blocks. Unifies
//! `state_with` / `rdb_default` / `document_default`, which had been
//! duplicated word-for-word across
//! commands/{rdb,document}/{schema,query,ddl,browse,mutate}.rs. Compiled only
//! under `cfg(test)` and exposed as `pub(crate)` — no effect on production
//! builds.

use std::sync::Arc;

use crate::commands::connection::AppState;
use crate::db::testing::{StubDocumentAdapter, StubRdbAdapter};
use crate::db::ActiveAdapter;

/// Build an `AppState` with a single named active connection. Every _inner
/// handler test builds its fixture this way.
pub(crate) async fn state_with(id: &str, active: ActiveAdapter) -> AppState {
    let state = AppState::new();
    {
        let mut conns = state.active_connections.lock().await;
        conns.insert(id.to_string(), Arc::new(active));
    }
    state
}

/// Default RDB stub — trait method calls yield `Unsupported` or a sentinel
/// (overridable per test). This helper exists to lighten the fixture burden
/// when a scenario line only checks "which paradigm is it".
pub(crate) fn rdb_default() -> ActiveAdapter {
    ActiveAdapter::Rdb(Box::new(StubRdbAdapter::default()))
}

/// Default Document stub — sibling of `rdb_default`.
pub(crate) fn document_default() -> ActiveAdapter {
    ActiveAdapter::Document(Box::new(StubDocumentAdapter::default()))
}

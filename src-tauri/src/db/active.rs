//! Runtime-dispatched adapter handle. `ActiveAdapter` is the variant the
//! `commands/*` layer holds per active connection; `as_rdb()` /
//! `as_document()` / etc. resolve a typed reference or surface
//! `AppError::Unsupported` when the caller's paradigm does not match.
//!
//! Hoisted out of `db/mod.rs` (Sprint 213, P5 step 2). The public surface
//! is unchanged — `crate::db::ActiveAdapter` is preserved via `pub use`.

use crate::error::AppError;
use crate::models::DatabaseType;

use super::traits::{DbAdapter, DocumentAdapter, KvAdapter, RdbAdapter, SearchAdapter};

/// Runtime-dispatched adapter handle stored per active connection.
///
/// Wraps one of the paradigm-specific traits. Accessors return a typed
/// reference or a paradigm-mismatch error so that RDB-only commands can
/// reject document/search/kv connections cleanly.
pub enum ActiveAdapter {
    Rdb(Box<dyn RdbAdapter>),
    Document(Box<dyn DocumentAdapter>),
    Search(Box<dyn SearchAdapter>),
    Kv(Box<dyn KvAdapter>),
}

impl ActiveAdapter {
    pub fn kind(&self) -> DatabaseType {
        self.lifecycle().kind()
    }

    pub fn lifecycle(&self) -> &dyn DbAdapter {
        match self {
            ActiveAdapter::Rdb(a) => a.as_ref(),
            ActiveAdapter::Document(a) => a.as_ref(),
            ActiveAdapter::Search(a) => a.as_ref(),
            ActiveAdapter::Kv(a) => a.as_ref(),
        }
    }

    pub fn as_rdb(&self) -> Result<&dyn RdbAdapter, AppError> {
        match self {
            ActiveAdapter::Rdb(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a relational (RDB) connection".into(),
            )),
        }
    }

    pub fn as_document(&self) -> Result<&dyn DocumentAdapter, AppError> {
        match self {
            ActiveAdapter::Document(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a document (MongoDB) connection".into(),
            )),
        }
    }

    pub fn as_search(&self) -> Result<&dyn SearchAdapter, AppError> {
        match self {
            ActiveAdapter::Search(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a search connection".into(),
            )),
        }
    }

    pub fn as_kv(&self) -> Result<&dyn KvAdapter, AppError> {
        match self {
            ActiveAdapter::Kv(a) => Ok(a.as_ref()),
            _ => Err(AppError::Unsupported(
                "Operation requires a key-value connection".into(),
            )),
        }
    }
}

#[cfg(test)]
mod tests {
    // 작성 이유: ActiveAdapter 의 paradigm 분기는 모든 RDB / Document / Search /
    // Kv 명령의 진입 게이트다. as_rdb / as_document / as_search / as_kv 가
    // mismatch 시 정확히 Unsupported 를 반환해야 frontend 의 UX (toast 메시지)
    // 와 보안 (paradigm 누설 방지) 이 보장된다. 기존엔 테스트 0건이라 회귀
    // 시 silently 통과 가능. (2026-05-07)
    use super::*;
    use crate::db::{MongoAdapter, PostgresAdapter};

    // SearchAdapter / KvAdapter 는 marker trait 라 별도 stub 으로 만족시킨다.
    struct StubSearchAdapter;
    impl DbAdapter for StubSearchAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Postgresql
        }
        fn connect<'a>(
            &'a self,
            _config: &'a crate::models::ConnectionConfig,
        ) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl SearchAdapter for StubSearchAdapter {}

    struct StubKvAdapter;
    impl DbAdapter for StubKvAdapter {
        fn kind(&self) -> DatabaseType {
            DatabaseType::Mongodb
        }
        fn connect<'a>(
            &'a self,
            _config: &'a crate::models::ConnectionConfig,
        ) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn disconnect<'a>(&'a self) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
        fn ping<'a>(&'a self) -> super::super::types::BoxFuture<'a, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }
    impl KvAdapter for StubKvAdapter {}

    fn rdb_active() -> ActiveAdapter {
        ActiveAdapter::Rdb(Box::new(PostgresAdapter::new()))
    }
    fn document_active() -> ActiveAdapter {
        ActiveAdapter::Document(Box::new(MongoAdapter::new()))
    }
    fn search_active() -> ActiveAdapter {
        ActiveAdapter::Search(Box::new(StubSearchAdapter))
    }
    fn kv_active() -> ActiveAdapter {
        ActiveAdapter::Kv(Box::new(StubKvAdapter))
    }

    // ── kind() ───────────────────────────────────────────────────────────
    #[test]
    fn kind_rdb_returns_postgresql() {
        assert!(matches!(rdb_active().kind(), DatabaseType::Postgresql));
    }

    #[test]
    fn kind_document_returns_mongodb() {
        assert!(matches!(document_active().kind(), DatabaseType::Mongodb));
    }

    // ── lifecycle() — DbAdapter handle 노출 ──────────────────────────────
    #[test]
    fn lifecycle_rdb_returns_dbadapter_with_matching_kind() {
        let active = rdb_active();
        assert!(matches!(
            active.lifecycle().kind(),
            DatabaseType::Postgresql
        ));
    }

    #[test]
    fn lifecycle_document_returns_dbadapter_with_matching_kind() {
        let active = document_active();
        assert!(matches!(active.lifecycle().kind(), DatabaseType::Mongodb));
    }

    // ── as_rdb() ─────────────────────────────────────────────────────────
    #[test]
    fn as_rdb_on_rdb_variant_returns_ok() {
        let active = rdb_active();
        assert!(active.as_rdb().is_ok());
    }

    #[test]
    fn as_rdb_on_document_returns_unsupported() {
        let active = document_active();
        match active.as_rdb() {
            Err(AppError::Unsupported(msg)) => {
                assert!(
                    msg.contains("relational"),
                    "메시지에 'relational' 키워드 필요: {msg}"
                );
            }
            Err(other) => panic!("Expected Unsupported, got AppError: {:?}", other),
            Ok(_) => panic!("Expected Unsupported error, got Ok adapter handle"),
        }
    }

    #[test]
    fn as_rdb_on_search_returns_unsupported() {
        assert!(matches!(
            search_active().as_rdb(),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn as_rdb_on_kv_returns_unsupported() {
        assert!(matches!(
            kv_active().as_rdb(),
            Err(AppError::Unsupported(_))
        ));
    }

    // ── as_document() ────────────────────────────────────────────────────
    #[test]
    fn as_document_on_document_variant_returns_ok() {
        let active = document_active();
        assert!(active.as_document().is_ok());
    }

    #[test]
    fn as_document_on_rdb_returns_unsupported() {
        let active = rdb_active();
        match active.as_document() {
            Err(AppError::Unsupported(msg)) => {
                assert!(
                    msg.contains("document") || msg.contains("MongoDB"),
                    "메시지에 'document' / 'MongoDB' 키워드 필요: {msg}"
                );
            }
            Err(other) => panic!("Expected Unsupported, got AppError: {:?}", other),
            Ok(_) => panic!("Expected Unsupported error, got Ok adapter handle"),
        }
    }

    #[test]
    fn as_document_on_search_returns_unsupported() {
        assert!(matches!(
            search_active().as_document(),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn as_document_on_kv_returns_unsupported() {
        assert!(matches!(
            kv_active().as_document(),
            Err(AppError::Unsupported(_))
        ));
    }

    // ── as_search() ──────────────────────────────────────────────────────
    #[test]
    fn as_search_on_search_variant_returns_ok() {
        let active = search_active();
        assert!(active.as_search().is_ok());
    }

    #[test]
    fn as_search_on_rdb_returns_unsupported() {
        assert!(matches!(
            rdb_active().as_search(),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn as_search_on_document_returns_unsupported() {
        assert!(matches!(
            document_active().as_search(),
            Err(AppError::Unsupported(_))
        ));
    }

    // ── as_kv() ──────────────────────────────────────────────────────────
    #[test]
    fn as_kv_on_kv_variant_returns_ok() {
        let active = kv_active();
        assert!(active.as_kv().is_ok());
    }

    #[test]
    fn as_kv_on_rdb_returns_unsupported() {
        assert!(matches!(
            rdb_active().as_kv(),
            Err(AppError::Unsupported(_))
        ));
    }

    #[test]
    fn as_kv_on_document_returns_unsupported() {
        assert!(matches!(
            document_active().as_kv(),
            Err(AppError::Unsupported(_))
        ));
    }
}

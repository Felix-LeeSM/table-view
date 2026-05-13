//! MySQL adapter — Sprint 279 (Phase 17, skeleton).
//!
//! 진입 모듈. PG (`db/postgres.rs`) 와 동일한 entry pattern:
//! - `connection` — `MysqlAdapter` struct + `MySqlPool` lifecycle.
//! - 후속 sub-file (`schema` / `queries` / `mutations`) 는 Phase 17 의
//!   다음 sprint 에서 합류.
//!
//! 현재 외부 surface = `MysqlAdapter` 구조체 + DbAdapter trait impl 4
//! method (kind/connect/disconnect/ping). RdbAdapter trait impl 은
//! Sprint 280 (list_namespaces / list_tables / get_columns 등) 에서
//! wire-up. 그 sprint 가 끝나기 전엔 `make_adapter` factory 가 여전히
//! `AppError::Unsupported` 를 반환하므로 사용자 surface 변화 0.

mod connection;

pub use connection::MysqlAdapter;

use std::future::Future;
use std::pin::Pin;

use crate::error::AppError;
use crate::models::{ConnectionConfig, DatabaseType};

use super::DbAdapter;

impl DbAdapter for MysqlAdapter {
    fn kind(&self) -> DatabaseType {
        DatabaseType::Mysql
    }

    fn connect<'a>(
        &'a self,
        config: &'a ConnectionConfig,
    ) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.connect_pool(config).await })
    }

    fn disconnect<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { self.disconnect_pool().await })
    }

    fn ping<'a>(&'a self) -> Pin<Box<dyn Future<Output = Result<(), AppError>> + Send + 'a>> {
        Box::pin(async move { MysqlAdapter::ping(self).await })
    }
}

#[cfg(test)]
mod tests {
    //! 작성 이유 (2026-05-13, Sprint 279): DbAdapter trait 의 sync method
    //! (`kind`) 를 paradigm tag 회귀 가드로 검증. `connect`/`disconnect`/
    //! `ping` 의 async path 는 inherent method tests (`connection.rs`)
    //! 에서 이미 검증됨.
    use super::*;

    #[test]
    fn kind_returns_mysql_paradigm() {
        let a = MysqlAdapter::new();
        assert!(matches!(a.kind(), DatabaseType::Mysql));
    }
}

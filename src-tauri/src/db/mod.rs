pub mod postgres;

#[allow(dead_code)]
use crate::error::AppError;
#[allow(dead_code)]
use crate::models::ConnectionConfig;

#[allow(dead_code)]
pub trait DbAdapter: Send + Sync {
    fn connect(
        &self,
        config: &ConnectionConfig,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + '_>>;
    fn disconnect(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + '_>>;
    fn ping(
        &self,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<(), AppError>> + Send + '_>>;
}

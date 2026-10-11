//! Host-key pin store for SSH tunnels (issue #1064, ADR 0052 Q4).
//!
//! One row per jump host in `state.db` (`ssh_host_key_pins`, migration 0006):
//! the fingerprint the client saw on first contact. The tunnel connect path
//! reads the pin before dialing; a mismatch hard-fails and the only recovery
//! is `delete_pin` — an explicit user decision, never an automatic re-pin.
//! Pins are machine-local trust state and are excluded from export envelopes.

use crate::error::AppError;

/// The stored fingerprint for a jump host, if one was pinned.
pub async fn get_pin(host: &str, port: u16) -> Result<Option<String>, AppError> {
    let pool = super::local::open_pool().await?;
    let row: Option<(String,)> =
        sqlx::query_as("SELECT fingerprint FROM ssh_host_key_pins WHERE host = ? AND port = ?")
            .bind(host)
            .bind(i64::from(port))
            .fetch_optional(&pool)
            .await?;
    Ok(row.map(|(fingerprint,)| fingerprint))
}

/// Record (first contact) or replace (explicit re-confirm) the pin for a jump
/// host. The tunnel path only ever calls this for an *unknown* host; the
/// mismatch path must route the user through `delete_pin` first.
pub async fn upsert_pin(host: &str, port: u16, fingerprint: &str) -> Result<(), AppError> {
    let pool = super::local::open_pool().await?;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    sqlx::query(
        "INSERT INTO ssh_host_key_pins (host, port, fingerprint, pinned_at) VALUES (?, ?, ?, ?) \
         ON CONFLICT(host, port) DO UPDATE SET fingerprint = excluded.fingerprint, \
         pinned_at = excluded.pinned_at",
    )
    .bind(host)
    .bind(i64::from(port))
    .bind(fingerprint)
    .bind(now)
    .execute(&pool)
    .await?;
    Ok(())
}

/// Drop the pin for a jump host. This is the "delete the pin, re-confirm"
/// recovery step after a host-key mismatch — the next connect records the
/// then-presented key as a fresh first contact.
pub async fn delete_pin(host: &str, port: u16) -> Result<(), AppError> {
    let pool = super::local::open_pool().await?;
    sqlx::query("DELETE FROM ssh_host_key_pins WHERE host = ? AND port = ?")
        .bind(host)
        .bind(i64::from(port))
        .execute(&pool)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;

    use super::*;
    use crate::storage::local;
    use serial_test::serial;
    use tempfile::TempDir;

    async fn pool_setup() -> (TempDir, SqlitePool) {
        let dir = TempDir::new().unwrap();
        std::env::set_var("TABLE_VIEW_TEST_DATA_DIR", dir.path());
        let pool = local::open_pool().await.unwrap();
        (dir, pool)
    }

    fn pool_cleanup() {
        std::env::remove_var("TABLE_VIEW_TEST_DATA_DIR");
    }

    #[tokio::test]
    #[serial]
    async fn unknown_host_has_no_pin() {
        let (_dir, _pool) = pool_setup().await;
        assert_eq!(get_pin("bastion.example", 22).await.unwrap(), None);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn upsert_then_get_round_trips_and_replaces() {
        let (_dir, _pool) = pool_setup().await;

        upsert_pin("bastion.example", 22, "SHA256:first")
            .await
            .unwrap();
        assert_eq!(
            get_pin("bastion.example", 22).await.unwrap(),
            Some("SHA256:first".into())
        );

        // The only writer allowed to replace a pin is an explicit re-confirm;
        // the store itself just records what it is told.
        upsert_pin("bastion.example", 22, "SHA256:second")
            .await
            .unwrap();
        assert_eq!(
            get_pin("bastion.example", 22).await.unwrap(),
            Some("SHA256:second".into())
        );

        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn pins_are_scoped_by_port() {
        let (_dir, _pool) = pool_setup().await;
        upsert_pin("bastion.example", 22, "SHA256:a").await.unwrap();
        assert_eq!(get_pin("bastion.example", 2222).await.unwrap(), None);
        pool_cleanup();
    }

    #[tokio::test]
    #[serial]
    async fn delete_pin_removes_the_row() {
        let (_dir, _pool) = pool_setup().await;
        upsert_pin("bastion.example", 22, "SHA256:a").await.unwrap();
        delete_pin("bastion.example", 22).await.unwrap();
        assert_eq!(get_pin("bastion.example", 22).await.unwrap(), None);
        pool_cleanup();
    }
}

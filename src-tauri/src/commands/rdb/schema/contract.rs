macro_rules! with_rdb_schema_contract {
    (
        $state:expr,
        $connection_id:expr,
        $expected_database:expr,
        |$adapter:ident| $dispatch:expr
    ) => {{
        async {
            let connections = $state.active_connections.lock().await;
            let active = connections
                .get($connection_id)
                .ok_or_else(|| not_connected($connection_id))?;
            let $adapter = active.as_rdb()?;
            ensure_expected_db($adapter, $expected_database).await?;
            $dispatch.await
        }
    }};
}
